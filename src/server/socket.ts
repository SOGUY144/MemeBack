import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Server, Socket } from 'socket.io';

import { prisma } from '@/lib/db';
import { SceneSpec } from '@/lib/ai/scene-schema';
import { analyzeAnswer, generateDistractors } from '@/server/ai';
import { suggestPromotions } from '@/server/promotion';
import { AUTHOR_BONUS, authorEarnedBonus, guessPoints, verdictPoints } from '@/server/scoring';
import {
  canTransition,
  type ClientToServer,
  type GenerationStatus,
  type GuessCard,
  type Phase,
  type PlayerView,
  type RoomState,
  type ScoreRow,
  type ServerToClient,
} from '@/lib/realtime/events';

export type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient> & {
  data: { roomCode?: string; playerId?: string; isTeacher?: boolean };
};

const MEME_DIR = path.join(process.cwd(), 'public', 'memes');
const GUESS_DURATION_MS = 30_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1

// ---------------------------------------------------------------------------
// per-room runtime state (rebuilt from the DB on demand, never the source of truth)
// ---------------------------------------------------------------------------

type Runtime = {
  generation: Map<string, GenerationStatus>;
  guessOrder: string[];
  guessIndex: number;
  guessOpenedAt: number;
  choices: Map<string, string[]>;
  pendingAnalyses: number;
};

const runtimes = new Map<string, Runtime>();

function runtime(code: string): Runtime {
  let r = runtimes.get(code);
  if (!r) {
    r = {
      generation: new Map(),
      guessOrder: [],
      guessIndex: 0,
      guessOpenedAt: 0,
      choices: new Map(),
      pendingAnalyses: 0,
    };
    runtimes.set(code, r);
  }
  return r;
}

export function newRoomCode(): string {
  let out = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}

export function newTeacherKey(): string {
  return randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------------
// broadcasting
// ---------------------------------------------------------------------------

const roomChannel = (code: string) => `room:${code}`;
const playerChannel = (playerId: string) => `player:${playerId}`;
const teacherChannel = (code: string) => `teacher:${code}`;

async function currentQuestion(roomId: string) {
  return prisma.question.findFirst({ where: { roomId }, orderBy: { createdAt: 'desc' } });
}

async function buildRoomState(io: IO, code: string): Promise<RoomState | null> {
  const room = await prisma.room.findUnique({
    where: { code },
    include: { players: { orderBy: { nickname: 'asc' } } },
  });
  if (!room) return null;

  const question = await currentQuestion(room.id);
  const answeredCount = question
    ? await prisma.answer.count({ where: { questionId: question.id } })
    : 0;

  const online = new Set<string>();
  for (const [id, socket] of io.sockets.sockets) {
    void id;
    const pid = (socket as Sock).data.playerId;
    if (pid) online.add(pid);
  }

  const players: PlayerView[] = room.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    online: online.has(p.id),
  }));

  return {
    code: room.code,
    phase: room.phase as Phase,
    players,
    question: question
      ? {
          id: question.id,
          prompt: question.prompt,
          subject: question.subject,
          choicesReady: Array.isArray(question.distractors)
            ? (question.distractors as unknown[]).length === 3
            : false,
        }
      : null,
    answeredCount,
    playerCount: room.players.length,
  };
}

async function pushRoomState(io: IO, code: string) {
  const state = await buildRoomState(io, code);
  if (state) io.to(roomChannel(code)).emit('room:state', state);
}

function pushGenerationStatus(io: IO, code: string) {
  const rows = [...runtime(code).generation.values()].sort((a, b) =>
    a.nickname.localeCompare(b.nickname),
  );
  io.to(teacherChannel(code)).emit('generation:status', { rows });
}

async function pushScoreboard(io: IO, code: string) {
  const room = await prisma.room.findUnique({ where: { code }, include: { players: true } });
  if (!room) return;
  const rows: ScoreRow[] = [...room.players]
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
    .map((p, i) => ({ playerId: p.id, nickname: p.nickname, score: p.score, rank: i + 1 }));
  io.to(roomChannel(code)).emit('scoreboard', { rows });
}

function parseSpec(value: unknown): SceneSpec | null {
  if (!value) return null;
  const parsed = SceneSpec.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// generation pipeline
// ---------------------------------------------------------------------------

async function runAnalysis(io: IO, code: string, answerId: string) {
  const rt = runtime(code);
  rt.pendingAnalyses++;

  try {
    const answer = await prisma.answer.findUnique({
      where: { id: answerId },
      include: { player: true, question: true },
    });
    if (!answer) return;

    const status: GenerationStatus = {
      answerId,
      playerId: answer.playerId,
      nickname: answer.player.nickname,
      stage: 'analyzing',
      verdict: null,
      promoted: false,
      hasFile: false,
      rawText: answer.rawText,
    };
    rt.generation.set(answerId, status);
    pushGenerationStatus(io, code);
    io.to(playerChannel(answer.playerId)).emit('meme:progress', { answerId, stage: 'analyzing' });

    const { spec } = await analyzeAnswer({
      targetConcept: answer.question.targetConcept,
      conceptHint: answer.question.conceptHint,
      subject: answer.question.subject,
      studentAnswer: answer.rawText,
    });

    await prisma.$transaction([
      prisma.answer.update({
        where: { id: answerId },
        data: { analysis: spec as object, verdict: spec.verdict },
      }),
      prisma.player.update({
        where: { id: answer.playerId },
        data: { score: { increment: verdictPoints(spec.verdict) } },
      }),
    ]);

    status.stage = spec.verdict === 'off_topic' ? 'done' : 'composing';
    status.verdict = spec.verdict;
    rt.generation.set(answerId, status);
    pushGenerationStatus(io, code);

    io.to(playerChannel(answer.playerId)).emit('meme:mine', {
      answerId,
      memeUrl: null,
      scene: spec.scene,
      verdict: spec.verdict,
      conceptNote: spec.concept_note,
      misconception: spec.misconception,
      understood: spec.understood,
    });
  } catch (err) {
    console.error('[generation] analysis crashed:', err);
    const status = rt.generation.get(answerId);
    if (status) {
      status.stage = 'failed';
      pushGenerationStatus(io, code);
    }
  } finally {
    rt.pendingAnalyses--;
    await pushRoomState(io, code);
  }
}

async function applyAutoPromotions(io: IO, code: string) {
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return;
  const question = await currentQuestion(room.id);
  if (!question) return;

  const answers = await prisma.answer.findMany({ where: { questionId: question.id } });
  const picked = new Set(
    suggestPromotions(
      answers.map((a) => ({
        answerId: a.id,
        verdict: (a.verdict as GenerationStatus['verdict']) ?? null,
        spec: parseSpec(a.analysis),
      })),
    ),
  );

  await prisma.$transaction(
    answers.map((a) =>
      prisma.answer.update({ where: { id: a.id }, data: { promoted: picked.has(a.id) } }),
    ),
  );

  const rt = runtime(code);
  for (const a of answers) {
    const s = rt.generation.get(a.id);
    if (s) s.promoted = picked.has(a.id);
  }
  pushGenerationStatus(io, code);
}

async function openGuessRound(io: IO, code: string, index: number) {
  const rt = runtime(code);
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return;
  const question = await currentQuestion(room.id);
  if (!question) return;

  const answerId = rt.guessOrder[index];
  if (!answerId) {
    io.to(roomChannel(code)).emit('guess:card', null);
    return;
  }

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { player: true },
  });
  const spec = answer ? parseSpec(answer.analysis) : null;
  if (!answer || !spec) {
    io.to(roomChannel(code)).emit('guess:card', null);
    return;
  }

  const distractors = Array.isArray(question.distractors)
    ? (question.distractors as string[])
    : [];
  let choices = rt.choices.get(answerId);
  if (!choices) {
    choices = shuffle([question.targetConcept, ...distractors]);
    rt.choices.set(answerId, choices);
  }

  rt.guessIndex = index;
  rt.guessOpenedAt = Date.now();

  const card: GuessCard = {
    answerId,
    memeUrl: answer.memeUrl,
    scene: spec.scene,
    choices,
    authorNickname: answer.player.nickname,
    index,
    total: rt.guessOrder.length,
    openedAt: rt.guessOpenedAt,
    durationMs: GUESS_DURATION_MS,
  };
  io.to(roomChannel(code)).emit('guess:card', card);
  await pushTally(io, code, answerId);
}

async function pushTally(io: IO, code: string, answerId: string) {
  const guesses = await prisma.guess.findMany({ where: { answerId } });
  const counts: Record<string, number> = {};
  for (const g of guesses) counts[g.choice] = (counts[g.choice] ?? 0) + 1;
  io.to(roomChannel(code)).emit('guess:tally', { answerId, counts, voted: guesses.length });
}

async function revealCurrent(io: IO, code: string) {
  const rt = runtime(code);
  const answerId = rt.guessOrder[rt.guessIndex];
  if (!answerId) return;

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { player: true, question: true, guesses: true },
  });
  if (!answer) return;
  const spec = parseSpec(answer.analysis);

  const correctVotes = answer.guesses.filter((g) => g.correct).length;
  if (authorEarnedBonus(correctVotes, answer.guesses.length)) {
    await prisma.player.update({
      where: { id: answer.playerId },
      data: { score: { increment: AUTHOR_BONUS } },
    });
  }

  const tally: Record<string, number> = {};
  for (const g of answer.guesses) tally[g.choice] = (tally[g.choice] ?? 0) + 1;

  io.to(roomChannel(code)).emit('reveal:answer', {
    answerId,
    rawText: answer.rawText,
    verdict: (answer.verdict as GenerationStatus['verdict']) ?? 'partial',
    correctChoice: answer.question.targetConcept,
    teachingPoint: spec?.teaching_point ?? '',
    conceptNote: spec?.concept_note ?? '',
    misconception: spec?.misconception ?? null,
    author: answer.player.nickname,
    tally,
  });
  await pushRoomState(io, code);
  await pushScoreboard(io, code);
}

// ---------------------------------------------------------------------------
// phase machine
// ---------------------------------------------------------------------------

async function enterPhase(io: IO, code: string, phase: Phase) {
  const rt = runtime(code);

  if (phase === 'ANSWERING') {
    rt.generation.clear();
    rt.guessOrder = [];
    rt.guessIndex = 0;
    rt.choices.clear();
    io.to(roomChannel(code)).emit('guess:card', null);
  }

  if (phase === 'PERSONAL_REVEAL') {
    await applyAutoPromotions(io, code);
  }

  if (phase === 'CLASS_GUESS') {
    if (rt.guessOrder.length === 0) {
      const room = await prisma.room.findUnique({ where: { code } });
      const question = room ? await currentQuestion(room.id) : null;
      if (question) {
        const promoted = await prisma.answer.findMany({
          where: { questionId: question.id, promoted: true },
          orderBy: { createdAt: 'asc' },
        });
        rt.guessOrder = promoted.filter((a) => parseSpec(a.analysis)).map((a) => a.id);
      }
      rt.guessIndex = 0;
    }
    await openGuessRound(io, code, rt.guessIndex);
  }

  if (phase === 'REVEAL') {
    await revealCurrent(io, code);
  }

  if (phase === 'SCOREBOARD') {
    await pushScoreboard(io, code);
  }
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

export function registerSocketHandlers(io: IO) {
  io.on('connection', (raw) => {
    const socket = raw as Sock;

    socket.on('room:join', async (p, ack) => {
      try {
        const code = String(p?.code ?? '').trim().toUpperCase();
        const room = await prisma.room.findUnique({ where: { code } });
        if (!room) return ack?.({ ok: false, error: 'ไม่พบห้องรหัสนี้' });

        socket.data.roomCode = code;
        socket.join(roomChannel(code));

        // --- projector: read-only, never becomes a Player ---
        if (p.asScreen) {
          ack?.({ ok: true, playerId: null, isTeacher: false });
          const state = await buildRoomState(io, code);
          if (state) socket.emit('room:state', state);
          return;
        }

        // --- teacher ---
        if (p.teacherKey) {
          if (p.teacherKey !== room.teacherKey) {
            return ack?.({ ok: false, error: 'กุญแจครูไม่ถูกต้อง' });
          }
          socket.data.isTeacher = true;
          socket.join(teacherChannel(code));
          ack?.({ ok: true, playerId: null, isTeacher: true });
          const state = await buildRoomState(io, code);
          if (state) socket.emit('room:state', state);
          pushGenerationStatus(io, code);
          return;
        }

        // --- student, possibly reconnecting ---
        let player = p.playerId
          ? await prisma.player.findFirst({ where: { id: p.playerId, roomId: room.id } })
          : null;

        if (!player) {
          const nickname = String(p?.nickname ?? '').trim().slice(0, 20);
          if (!nickname) return ack?.({ ok: false, error: 'ใส่ชื่อเล่นก่อนนะ' });
          if (room.phase !== 'LOBBY' && room.phase !== 'ANSWERING') {
            return ack?.({ ok: false, error: 'ห้องนี้เริ่มไปแล้ว เข้าร่วมไม่ได้' });
          }
          player = await prisma.player.create({
            data: { roomId: room.id, nickname, socketId: socket.id },
          });
        } else {
          await prisma.player.update({ where: { id: player.id }, data: { socketId: socket.id } });
        }

        socket.data.playerId = player.id;
        socket.join(playerChannel(player.id));
        ack?.({ ok: true, playerId: player.id, isTeacher: false });

        await pushRoomState(io, code);

        // hand a reconnecting student their meme back
        const question = await currentQuestion(room.id);
        if (question) {
          const mine = await prisma.answer.findFirst({
            where: { questionId: question.id, playerId: player.id },
          });
          const spec = mine ? parseSpec(mine.analysis) : null;
          if (mine && spec) {
            socket.emit('meme:mine', {
              answerId: mine.id,
              memeUrl: mine.memeUrl,
              scene: spec.scene,
              verdict: spec.verdict,
              conceptNote: spec.concept_note,
              misconception: spec.misconception,
              understood: spec.understood,
            });
          }
        }
      } catch (err) {
        console.error('[socket] room:join failed:', err);
        ack?.({ ok: false, error: 'เข้าห้องไม่สำเร็จ' });
      }
    });

    socket.on('teacher:question', async (p, ack) => {
      const code = socket.data.roomCode;
      if (!code || !socket.data.isTeacher) return ack?.({ ok: false, error: 'ไม่มีสิทธิ์' });
      try {
        const room = await prisma.room.findUnique({ where: { code } });
        if (!room) return ack?.({ ok: false, error: 'ไม่พบห้อง' });

        const prompt = String(p.prompt ?? '').trim();
        const targetConcept = String(p.targetConcept ?? '').trim();
        if (!prompt || !targetConcept) {
          return ack?.({ ok: false, error: 'ต้องมีทั้งคำถามและหลักการเป้าหมาย' });
        }

        const subject = (p.subject ?? 'science').trim() || 'science';
        const question = await prisma.question.create({
          data: {
            roomId: room.id,
            prompt,
            targetConcept,
            conceptHint: p.conceptHint?.trim() || null,
            subject,
            distractors: [],
          },
        });
        ack?.({ ok: true, questionId: question.id });
        await pushRoomState(io, code);

        // fire-and-forget: guessing only needs these by CLASS_GUESS
        generateDistractors(targetConcept, subject)
          .then(async (distractors) => {
            await prisma.question.update({ where: { id: question.id }, data: { distractors } });
            await pushRoomState(io, code);
          })
          .catch((err) => console.error('[ai] distractors failed:', err));
      } catch (err) {
        console.error('[socket] teacher:question failed:', err);
        ack?.({ ok: false, error: 'สร้างคำถามไม่สำเร็จ' });
      }
    });

    socket.on('answer:submit', async (p, ack) => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!code || !playerId) return ack?.({ ok: false, error: 'ยังไม่ได้เข้าห้อง' });
      try {
        const room = await prisma.room.findUnique({ where: { code } });
        if (!room) return ack?.({ ok: false, error: 'ไม่พบห้อง' });
        if (room.phase !== 'ANSWERING') return ack?.({ ok: false, error: 'ยังไม่ถึงเวลาตอบ' });

        const text = String(p.text ?? '').trim().slice(0, 600);
        if (!text) return ack?.({ ok: false, error: 'พิมพ์คำตอบก่อนนะ' });

        const question = await prisma.question.findFirst({
          where: { id: p.questionId, roomId: room.id },
        });
        if (!question) return ack?.({ ok: false, error: 'ไม่พบคำถามนี้' });

        const existing = await prisma.answer.findFirst({
          where: { questionId: question.id, playerId },
        });
        const answer = existing
          ? await prisma.answer.update({
              where: { id: existing.id },
              data: { rawText: text, analysis: undefined, verdict: null, memeUrl: null },
            })
          : await prisma.answer.create({
              data: { questionId: question.id, playerId, rawText: text },
            });

        ack?.({ ok: true, answerId: answer.id });
        await pushRoomState(io, code);
        void runAnalysis(io, code, answer.id);
      } catch (err) {
        console.error('[socket] answer:submit failed:', err);
        ack?.({ ok: false, error: 'ส่งคำตอบไม่สำเร็จ' });
      }
    });

    socket.on('meme:upload', async (p, ack) => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!code || !playerId) return ack?.({ ok: false, error: 'ยังไม่ได้เข้าห้อง' });
      try {
        const answer = await prisma.answer.findUnique({
          where: { id: p.answerId },
          include: { question: true },
        });
        if (!answer || answer.playerId !== playerId) {
          return ack?.({ ok: false, error: 'ไม่ใช่มีมของคุณ' });
        }

        const ext = p.mime === 'video/mp4' ? 'mp4' : 'gif';
        const bytes = Buffer.from(p.bytes);
        if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) {
          return ack?.({ ok: false, error: 'ไฟล์มีมมีขนาดไม่ถูกต้อง' });
        }

        await mkdir(MEME_DIR, { recursive: true });
        await writeFile(path.join(MEME_DIR, `${answer.id}.${ext}`), bytes);
        const memeUrl = `/memes/${answer.id}.${ext}`;
        await prisma.answer.update({ where: { id: answer.id }, data: { memeUrl } });

        const rt = runtime(code);
        const status = rt.generation.get(answer.id);
        if (status) {
          status.stage = 'done';
          status.hasFile = true;
          pushGenerationStatus(io, code);
        }

        const spec = parseSpec(answer.analysis);
        if (spec) {
          io.to(roomChannel(code)).emit('meme:ready', {
            answerId: answer.id,
            memeUrl,
            scene: spec.scene,
            verdict: spec.verdict,
            conceptNote: spec.concept_note,
            misconception: spec.misconception,
            understood: spec.understood,
          });
        }
        ack?.({ ok: true, memeUrl });
      } catch (err) {
        console.error('[socket] meme:upload failed:', err);
        ack?.({ ok: false, error: 'อัปโหลดมีมไม่สำเร็จ' });
      }
    });

    socket.on('guess:submit', async (p, ack) => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!code || !playerId) return ack?.({ ok: false, error: 'ยังไม่ได้เข้าห้อง' });
      try {
        const room = await prisma.room.findUnique({ where: { code } });
        if (!room || room.phase !== 'CLASS_GUESS') {
          return ack?.({ ok: false, error: 'ยังไม่ถึงเวลาทาย' });
        }
        const rt = runtime(code);
        if (rt.guessOrder[rt.guessIndex] !== p.answerId) {
          return ack?.({ ok: false, error: 'มีมนี้ไม่ได้อยู่บนจอแล้ว' });
        }

        const answer = await prisma.answer.findUnique({
          where: { id: p.answerId },
          include: { question: true },
        });
        if (!answer) return ack?.({ ok: false, error: 'ไม่พบมีมนี้' });
        if (answer.playerId === playerId) {
          return ack?.({ ok: false, error: 'มีมของตัวเอง ทายไม่ได้นะ' });
        }

        const already = await prisma.guess.findUnique({
          where: { answerId_playerId: { answerId: p.answerId, playerId } },
        });
        if (already) return ack?.({ ok: false, error: 'ทายไปแล้ว' });

        const correct = p.choice === answer.question.targetConcept;
        const points = correct ? guessPoints(Date.now() - rt.guessOpenedAt) : 0;

        await prisma.$transaction([
          prisma.guess.create({
            data: { answerId: p.answerId, playerId, choice: String(p.choice).slice(0, 120), correct },
          }),
          prisma.player.update({
            where: { id: playerId },
            data: { score: { increment: points } },
          }),
        ]);

        ack?.({ ok: true, correct, points });
        await pushTally(io, code, p.answerId);
      } catch (err) {
        console.error('[socket] guess:submit failed:', err);
        ack?.({ ok: false, error: 'ส่งคำทายไม่สำเร็จ' });
      }
    });

    socket.on('teacher:promote', async (p) => {
      const code = socket.data.roomCode;
      if (!code || !socket.data.isTeacher) return;
      try {
        await prisma.answer.update({ where: { id: p.answerId }, data: { promoted: Boolean(p.on) } });
        const rt = runtime(code);
        const status = rt.generation.get(p.answerId);
        if (status) status.promoted = Boolean(p.on);
        rt.guessOrder = [];
        pushGenerationStatus(io, code);
      } catch (err) {
        console.error('[socket] teacher:promote failed:', err);
      }
    });

    socket.on('teacher:guess-next', async (p) => {
      const code = socket.data.roomCode;
      if (!code || !socket.data.isTeacher) return;
      const rt = runtime(code);
      const next = p?.index ?? rt.guessIndex + 1;
      if (next < 0 || next >= rt.guessOrder.length) return;
      await prisma.room.update({ where: { code }, data: { phase: 'CLASS_GUESS' } });
      await openGuessRound(io, code, next);
      await pushRoomState(io, code);
    });

    socket.on('teacher:phase', async (p, ack) => {
      const code = socket.data.roomCode;
      // Phase changes are teacher-only. A player socket asking for one is
      // rejected here, not hidden in the UI.
      if (!code || !socket.data.isTeacher) {
        ack?.({ ok: false, error: 'ไม่มีสิทธิ์เปลี่ยนสถานะห้อง' });
        return;
      }
      try {
        const room = await prisma.room.findUnique({ where: { code } });
        if (!room) return ack?.({ ok: false, error: 'ไม่พบห้อง' });

        const from = room.phase as Phase;
        const to = p.phase;
        if (!canTransition(from, to)) {
          ack?.({ ok: false, error: `เปลี่ยนจาก ${from} ไป ${to} ไม่ได้` });
          return;
        }

        await prisma.room.update({ where: { code }, data: { phase: to } });
        await enterPhase(io, code, to);
        await pushRoomState(io, code);
        ack?.({ ok: true });
      } catch (err) {
        console.error('[socket] teacher:phase failed:', err);
        ack?.({ ok: false, error: 'เปลี่ยนสถานะไม่สำเร็จ' });
      }
    });

    socket.on('disconnect', async () => {
      const code = socket.data.roomCode;
      if (code) await pushRoomState(io, code).catch(() => {});
    });
  });
}
