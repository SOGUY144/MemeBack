import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Server, Socket } from 'socket.io';

import { prisma } from '@/lib/db';
import { SceneSpec } from '@/lib/ai/scene-schema';
import { analyzeAnswer, generateDistractors } from '@/server/ai';
import { suggestPromotions } from '@/server/promotion';
import type { Verdict } from '@/lib/meme/vocab';
import { AUTHOR_BONUS, authorEarnedBonus, guessPoints, verdictPoints } from '@/server/scoring';
import {
  canTransition,
  type ClientToServer,
  type GenerationStatus,
  type GuessCard,
  type Phase,
  type PlayerView,
  type RevealPayload,
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
  /** Authors already paid the crowd bonus, so re-revealing a meme cannot pay twice. */
  bonusPaid: Set<string>;
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
      bonusPaid: new Set(),
      pendingAnalyses: 0,
    };
    runtimes.set(code, r);
  }
  return r;
}

/**
 * Two students called "ปาล์ม" made the reveal ambiguous — nobody could tell whose
 * meme was on screen, and the scoreboard showed the same name twice. The second
 * one becomes "ปาล์ม 2" rather than being turned away, because a phone in a
 * classroom is a bad place to argue about names.
 */
async function uniqueNickname(roomId: string, wanted: string): Promise<string> {
  const taken = new Set(
    (await prisma.player.findMany({ where: { roomId }, select: { nickname: true } })).map(
      (p) => p.nickname,
    ),
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 100; n++) {
    const suffix = ` ${n}`;
    const candidate = `${wanted.slice(0, 20 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return wanted;
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
  const answers = question
    ? await prisma.answer.findMany({
        where: { questionId: question.id },
        select: { id: true, verdict: true },
      })
    : [];

  // How many answers the AI has finished reading. The stored verdict alone is
  // not enough: a resubmitted answer deliberately keeps its previous verdict
  // until the new analysis lands, so the live stage is what says "done".
  const rt = runtime(code);
  const analyzedCount = answers.filter((a) => {
    const live = rt.generation.get(a.id);
    return live ? live.stage !== 'analyzing' : a.verdict !== null;
  }).length;

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
    answeredCount: answers.length,
    analyzedCount,
    playerCount: room.players.length,
  };
}

async function pushRoomState(io: IO, code: string) {
  const state = await buildRoomState(io, code);
  if (state) io.to(roomChannel(code)).emit('room:state', state);
}

/**
 * The teacher's per-student list is built from the database, with the transient
 * `stage` merged in from memory. Building it the other way round meant a server
 * restart — or a teacher opening the panel late — showed an empty class.
 */
async function pushGenerationStatus(io: IO, code: string) {
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return;
  const question = await currentQuestion(room.id);

  const rt = runtime(code);
  const rows: GenerationStatus[] = question
    ? (
        await prisma.answer.findMany({
          where: { questionId: question.id },
          include: { player: true },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => {
        const live = rt.generation.get(a.id);
        return {
          answerId: a.id,
          playerId: a.playerId,
          nickname: a.player.nickname,
          stage: live?.stage ?? (a.analysis ? 'done' : 'analyzing'),
          verdict: (a.verdict as GenerationStatus['verdict']) ?? null,
          promoted: a.promoted,
          hasFile: Boolean(a.memeUrl),
          rawText: a.rawText,
        };
      })
    : [];

  rows.sort((a, b) => a.nickname.localeCompare(b.nickname));
  io.to(teacherChannel(code)).emit('generation:status', { rows });
}

async function scoreboardRows(code: string): Promise<ScoreRow[]> {
  const room = await prisma.room.findUnique({ where: { code }, include: { players: true } });
  if (!room) return [];
  return [...room.players]
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
    .map((p, i) => ({ playerId: p.id, nickname: p.nickname, score: p.score, rank: i + 1 }));
}

async function pushScoreboard(io: IO, code: string) {
  io.to(roomChannel(code)).emit('scoreboard', { rows: await scoreboardRows(code) });
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

/**
 * Only the newest question is ever reachable — `currentQuestion()` orders by
 * `createdAt desc` — so once the teacher asks a new one, every meme file from
 * the room's earlier rounds is unreachable weight. Without this `public/memes/`
 * grew for the whole life of the server. Best-effort on purpose: a failed
 * unlink must never stop the lesson.
 */
async function cleanupOldMemes(roomId: string, keepQuestionId: string) {
  try {
    const stale = await prisma.answer.findMany({
      where: { question: { roomId, id: { not: keepQuestionId } }, memeUrl: { not: null } },
      select: { id: true },
    });
    if (!stale.length) return;

    await Promise.all(
      stale.flatMap((a) =>
        ['gif', 'mp4'].map((ext) => rm(path.join(MEME_DIR, `${a.id}.${ext}`), { force: true })),
      ),
    );
    // The row outlives the file, so drop the URL too rather than leave a 404
    // behind for anything that reads the answer later.
    await prisma.answer.updateMany({
      where: { id: { in: stale.map((a) => a.id) } },
      data: { memeUrl: null },
    });
  } catch (err) {
    console.error('[cleanup] removing old meme files failed:', err);
  }
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
    await pushGenerationStatus(io, code);
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
        // Award the *difference*, not the full amount: a student who edits and
        // resubmits gets re-analysed, and paying out again each time turned a
        // rewrite into a way to farm points.
        data: {
          score: {
            increment:
              verdictPoints(spec.verdict) - verdictPoints(answer.verdict as Verdict | null),
          },
        },
      }),
    ]);

    status.stage = spec.verdict === 'off_topic' ? 'done' : 'composing';
    status.verdict = spec.verdict;
    rt.generation.set(answerId, status);
    await pushGenerationStatus(io, code);

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
      await pushGenerationStatus(io, code);
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
  await pushGenerationStatus(io, code);
}

/**
 * The order memes go up on the projector. Held in memory for speed but always
 * recoverable from the `promoted` flags, so a server restart mid-round does not
 * strand the class on a blank screen.
 */
async function ensureGuessOrder(code: string, questionId: string) {
  const rt = runtime(code);
  if (rt.guessOrder.length) return rt.guessOrder;

  const promoted = await prisma.answer.findMany({
    where: { questionId, promoted: true },
    orderBy: { createdAt: 'asc' },
  });
  rt.guessOrder = promoted.filter((a) => parseSpec(a.analysis)).map((a) => a.id);
  return rt.guessOrder;
}

/** Builds the card for a round without broadcasting, so a reconnecting device
 *  can be caught up with exactly what the room is looking at. */
async function buildGuessCard(code: string, index: number): Promise<GuessCard | null> {
  const rt = runtime(code);
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return null;
  const question = await currentQuestion(room.id);
  if (!question) return null;

  await ensureGuessOrder(code, question.id);

  const answerId = rt.guessOrder[index];
  if (!answerId) return null;

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { player: true },
  });
  const spec = answer ? parseSpec(answer.analysis) : null;
  if (!answer || !spec) return null;

  const distractors = Array.isArray(question.distractors)
    ? (question.distractors as string[])
    : [];
  let choices = rt.choices.get(answerId);
  if (!choices) {
    choices = shuffle([question.targetConcept, ...distractors]);
    rt.choices.set(answerId, choices);
  }

  return {
    answerId,
    memeUrl: answer.memeUrl,
    scene: spec.scene,
    choices,
    authorNickname: answer.player.nickname,
    authorPlayerId: answer.playerId,
    index,
    total: rt.guessOrder.length,
    // Set when the round opened, not when this card was built — a reconnecting
    // device must see the same countdown as everyone else.
    openedAt: rt.guessOpenedAt,
    durationMs: GUESS_DURATION_MS,
  };
}

async function openGuessRound(io: IO, code: string, index: number) {
  const rt = runtime(code);
  rt.guessIndex = index;
  rt.guessOpenedAt = Date.now();

  const card = await buildGuessCard(code, index);
  io.to(roomChannel(code)).emit('guess:card', card);
  if (card) await pushTally(io, code, card.answerId);
}

/**
 * A device that reloads — or walks in late — mid-round would otherwise sit on a
 * blank screen until the teacher moved on, because `guess:card`, `reveal:answer`
 * and `scoreboard` are each emitted only at the moment their phase opens. Now
 * that joining is allowed in every phase, a latecomer hits this constantly.
 *
 * Emission order matters: the clients clear their reveal state when a card
 * arrives, so the card has to go out before the reveal that belongs to it.
 */
async function catchUpOnPhase(socket: Sock, code: string, phase: Phase) {
  if (phase === 'CLASS_GUESS' || phase === 'REVEAL') {
    const rt = runtime(code);
    const card = await buildGuessCard(code, rt.guessIndex);
    if (card) {
      socket.emit('guess:card', card);
      const guesses = await prisma.guess.findMany({ where: { answerId: card.answerId } });
      const counts: Record<string, number> = {};
      for (const g of guesses) counts[g.choice] = (counts[g.choice] ?? 0) + 1;
      socket.emit('guess:tally', { answerId: card.answerId, counts, voted: guesses.length });
    }
  }

  if (phase === 'REVEAL') {
    const payload = await buildRevealPayload(code);
    if (payload) socket.emit('reveal:answer', payload);
  }

  if (phase === 'REVEAL' || phase === 'SCOREBOARD') {
    socket.emit('scoreboard', { rows: await scoreboardRows(code) });
  }
}

async function pushTally(io: IO, code: string, answerId: string) {
  const guesses = await prisma.guess.findMany({ where: { answerId } });
  const counts: Record<string, number> = {};
  for (const g of guesses) counts[g.choice] = (counts[g.choice] ?? 0) + 1;
  io.to(roomChannel(code)).emit('guess:tally', { answerId, counts, voted: guesses.length });
}

/** Rebuilt on demand and free of side effects, so a device arriving in the
 *  middle of REVEAL can be handed the same payload without re-paying anyone. */
async function buildRevealPayload(code: string): Promise<RevealPayload | null> {
  const rt = runtime(code);
  const answerId = rt.guessOrder[rt.guessIndex];
  if (!answerId) return null;

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { player: true, question: true, guesses: true },
  });
  if (!answer) return null;
  const spec = parseSpec(answer.analysis);

  const tally: Record<string, number> = {};
  for (const g of answer.guesses) tally[g.choice] = (tally[g.choice] ?? 0) + 1;

  return {
    answerId,
    rawText: answer.rawText,
    verdict: (answer.verdict as GenerationStatus['verdict']) ?? 'partial',
    correctChoice: answer.question.targetConcept,
    teachingPoint: spec?.teaching_point ?? '',
    conceptNote: spec?.concept_note ?? '',
    misconception: spec?.misconception ?? null,
    author: answer.player.nickname,
    tally,
  };
}

async function revealCurrent(io: IO, code: string) {
  const rt = runtime(code);
  const answerId = rt.guessOrder[rt.guessIndex];
  if (!answerId) return;

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { guesses: true },
  });
  if (!answer) return;

  // The author bonus is paid here and nowhere else, guarded by `bonusPaid` so
  // re-entering REVEAL for the same meme cannot pay it twice.
  const correctVotes = answer.guesses.filter((g) => g.correct).length;
  if (authorEarnedBonus(correctVotes, answer.guesses.length) && !rt.bonusPaid.has(answerId)) {
    rt.bonusPaid.add(answerId);
    await prisma.player.update({
      where: { id: answer.playerId },
      data: { score: { increment: AUTHOR_BONUS } },
    });
  }

  const payload = await buildRevealPayload(code);
  if (payload) io.to(roomChannel(code)).emit('reveal:answer', payload);
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
    rt.bonusPaid.clear();
    io.to(roomChannel(code)).emit('guess:card', null);
  }

  if (phase === 'PERSONAL_REVEAL') {
    await applyAutoPromotions(io, code);
  }

  if (phase === 'CLASS_GUESS') {
    if (rt.guessOrder.length === 0) {
      const room = await prisma.room.findUnique({ where: { code } });
      const question = room ? await currentQuestion(room.id) : null;
      if (question) await ensureGuessOrder(code, question.id);
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
          await catchUpOnPhase(socket, code, room.phase as Phase);
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
          await pushGenerationStatus(io, code);
          // A teacher who reloads during REVEAL used to lose the teaching point
          // and the "next meme" counter for the rest of the round.
          await catchUpOnPhase(socket, code, room.phase as Phase);
          return;
        }

        // --- student, possibly reconnecting ---
        let player = p.playerId
          ? await prisma.player.findFirst({ where: { id: p.playerId, roomId: room.id } })
          : null;

        if (!player) {
          const nickname = String(p?.nickname ?? '').trim().slice(0, 20);
          if (!nickname) return ack?.({ ok: false, error: 'ใส่ชื่อเล่นก่อนนะ' });
          // Joining stays open in every phase. Someone always walks in late, and
          // a phone whose battery died or whose browser storage was cleared comes
          // back as a brand new player — turning either of those away costs them
          // the rest of the lesson. A latecomer with no answer of their own just
          // watches, and joins in from the next guessing round.
          player = await prisma.player.create({
            data: { roomId: room.id, nickname: await uniqueNickname(room.id, nickname), socketId: socket.id },
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
          if (mine) socket.emit('answer:mine', { answerId: mine.id, rawText: mine.rawText });
          await catchUpOnPhase(socket, code, room.phase as Phase);
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
        void cleanupOldMemes(room.id, question.id);

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

        const text = String(p.text ?? '').trim().slice(0, 600);
        if (!text) return ack?.({ ok: false, error: 'พิมพ์คำตอบก่อนนะ' });

        const question = await prisma.question.findFirst({
          where: { id: p.questionId, roomId: room.id },
        });
        if (!question) return ack?.({ ok: false, error: 'ไม่พบคำถามนี้' });

        const existing = await prisma.answer.findFirst({
          where: { questionId: question.id, playerId },
        });

        // Answering is normally open only during ANSWERING. The exception is an
        // answer the AI called `off_topic`: that student is told to write it
        // again, so the door has to stay open long enough for them to do it —
        // through GENERATING and PERSONAL_REVEAL, which is when they actually
        // read the message. Any other answer is final once the phase moves on.
        const retryingOffTopic = existing?.verdict === 'off_topic';
        const canSubmitNow =
          room.phase === 'ANSWERING' ||
          (retryingOffTopic && (room.phase === 'GENERATING' || room.phase === 'PERSONAL_REVEAL'));
        if (!canSubmitNow) return ack?.({ ok: false, error: 'ยังไม่ถึงเวลาตอบ' });

        const answer = existing
          ? await prisma.answer.update({
              where: { id: existing.id },
              // The previous verdict and analysis stay until the new ones land:
              // clearing them would make the re-analysis look like a first
              // analysis and pay out the verdict points a second time.
              data: { rawText: text, memeUrl: null },
            })
          : await prisma.answer.create({
              data: { questionId: question.id, playerId, rawText: text },
            });

        ack?.({ ok: true, answerId: answer.id });
        await pushRoomState(io, code);
        // A retry landing after PERSONAL_REVEAL opened is deliberately not
        // auto-promoted: re-running the picker would overwrite whatever the
        // teacher had already chosen by hand. The new verdict appears in their
        // list, and they can put it on the projector themselves.
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
        // A re-submitted answer can land in the other format; drop the stale twin
        // so /memes never keeps a file nothing points at.
        await rm(path.join(MEME_DIR, `${answer.id}.${ext === 'gif' ? 'mp4' : 'gif'}`), {
          force: true,
        });
        const memeUrl = `/memes/${answer.id}.${ext}`;
        await prisma.answer.update({ where: { id: answer.id }, data: { memeUrl } });

        const rt = runtime(code);
        const status = rt.generation.get(answer.id);
        if (status) {
          status.stage = 'done';
          status.hasFile = true;
          await pushGenerationStatus(io, code);
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

    socket.on('teacher:promote', async (p, ack) => {
      const code = socket.data.roomCode;
      if (!code || !socket.data.isTeacher) return ack?.({ ok: false, error: 'ไม่มีสิทธิ์' });
      try {
        const room = await prisma.room.findUnique({ where: { code } });
        if (!room) return ack?.({ ok: false, error: 'ไม่พบห้อง' });

        // Once guessing has started the running order is locked. Changing it here
        // used to blank `guessOrder`, and every `guess:submit` after that was
        // rejected with "this meme is not on screen" while the meme was still on
        // screen. Refusing outright beats silently diverging from the projector.
        if (room.phase === 'CLASS_GUESS' || room.phase === 'REVEAL') {
          return ack?.({ ok: false, error: 'รอบทายเริ่มแล้ว เปลี่ยนมีมบนจอตอนนี้ไม่ได้' });
        }

        await prisma.answer.update({ where: { id: p.answerId }, data: { promoted: Boolean(p.on) } });
        const rt = runtime(code);
        const status = rt.generation.get(p.answerId);
        if (status) status.promoted = Boolean(p.on);
        // Safe here: no round is open, so it will be rebuilt from `promoted`.
        rt.guessOrder = [];
        await pushGenerationStatus(io, code);
        ack?.({ ok: true });
      } catch (err) {
        console.error('[socket] teacher:promote failed:', err);
        ack?.({ ok: false, error: 'เปลี่ยนมีมบนจอไม่สำเร็จ' });
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

    socket.on('teacher:reanalyze', async (p, ack) => {
      const code = socket.data.roomCode;
      if (!code || !socket.data.isTeacher) return ack?.({ ok: false, error: 'ไม่มีสิทธิ์' });
      try {
        // Scoped through the question's room so a teacher cannot reach into
        // another room's answers by guessing an id.
        const answer = await prisma.answer.findUnique({
          where: { id: p.answerId },
          include: { question: { include: { room: true } } },
        });
        if (!answer || answer.question.room.code !== code) {
          return ack?.({ ok: false, error: 'ไม่พบคำตอบนี้' });
        }
        ack?.({ ok: true });
        void runAnalysis(io, code, answer.id);
      } catch (err) {
        console.error('[socket] teacher:reanalyze failed:', err);
        ack?.({ ok: false, error: 'สั่งวิเคราะห์ใหม่ไม่สำเร็จ' });
      }
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
