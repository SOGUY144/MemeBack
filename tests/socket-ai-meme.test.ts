import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ClientToServer, ServerToClient } from '@/lib/realtime/events';

/**
 * Covers the production-readiness audit of teacher:generate-ai-meme /
 * teacher:edit-dialogue: authorization + room isolation, the idempotency
 * lock against duplicate paid requests, failure recovery (never stuck), and
 * the per-room generation cap. Runs the real handlers over a real socket,
 * same harness as socket-auth.test.ts — the one thing reading the UI code
 * cannot prove.
 *
 * image-gen.ts is mocked at the module level: this suite must never call the
 * live, billed OpenAI image API. That boundary is exercised manually
 * instead — see tests/image-gen.test.ts's file doc for where it actually is.
 */
const mocks = vi.hoisted(() => ({
  generateMemeImage: vi.fn(),
  recompositeDialogue: vi.fn(),
}));

vi.mock('@/server/image-gen', () => ({
  generateMemeImage: mocks.generateMemeImage,
  recompositeDialogue: mocks.recompositeDialogue,
  imageGenAvailable: () => true,
}));

const dir = mkdtempSync(path.join(tmpdir(), 'memeback-test-'));
const dbFile = path.join(dir, 'test.db');
copyFileSync(path.join(process.cwd(), 'prisma', 'dev.db'), dbFile);
process.env.DATABASE_URL = `file:${dbFile}`;

const { prisma } = await import('@/lib/db');
const { registerSocketHandlers, AI_GENERATION_CAP } = await import('@/server/socket');

let httpServer: HttpServer;
let ioServer: Server;
let url: string;
const clients: ClientSocket[] = [];

function client(): ClientSocket<ServerToClient, ClientToServer> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  return socket as ClientSocket<ServerToClient, ClientToServer>;
}

function ask<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 4000);
    (socket as unknown as { emit: (e: string, p: unknown, cb: (r: T) => void) => void }).emit(
      event,
      payload,
      (res: T) => {
        clearTimeout(timer);
        resolve(res);
      },
    );
  });
}

const joined = (socket: ClientSocket) =>
  new Promise<void>((resolve) => socket.on('connect', () => resolve()));

type JoinAck = { ok: true; playerId: string | null; isTeacher: boolean } | { ok: false; error: string };
type GenAck = { ok: true; memeUrl: string } | { ok: false; error: string };

/** A SceneSpec-shaped object real enough for parseSpec (server/socket.ts) to
 *  accept — this is what an already-analyzed, already-promoted answer looks
 *  like in the DB by the time a teacher could click "สร้างเป็นมีม AI". */
function validAnalysis() {
  return {
    understood: true,
    verdict: 'correct',
    concept_note: 'ตอบถูก',
    misconception: null,
    teaching_point: 'สอนได้',
    matched_meme: null,
    dialogue: [],
    scene: {
      setting: 'street',
      meme_format: 'impact_caption',
      actors: [{ id: 'A', label: 'a', sprite: 'person_a', x: 0.5 }],
      beats: [{ actor: 'A', clip: 'kick', target: null, duration_ms: 500 }],
      caption: 'สั้นๆ',
    },
  };
}

async function makeRoom(code: string, teacherKey: string) {
  await prisma.room.deleteMany({ where: { code } });
  const room = await prisma.room.create({ data: { code, teacherKey, phase: 'ANSWERING' } });
  const question = await prisma.question.create({
    data: {
      roomId: room.id,
      prompt: 'ทดสอบ',
      targetConcept: "Newton's Third Law",
      subject: 'science',
      distractors: [],
    },
  });
  return { room, question };
}

/** Creates a Player + Answer already analyzed (and optionally promoted) —
 *  bypasses answer:submit/runAnalysis entirely so this suite never triggers
 *  the real OpenAI text-analysis or Giphy search calls either. */
async function makeAnswer(roomId: string, questionId: string, opts: { promoted?: boolean } = {}) {
  const player = await prisma.player.create({ data: { roomId, nickname: `p-${Date.now()}-${Math.random()}` } });
  const answer = await prisma.answer.create({
    data: {
      questionId,
      playerId: player.id,
      rawText: 'คำตอบทดสอบ',
      analysis: validAnalysis(),
      verdict: 'correct',
      promoted: opts.promoted ?? false,
    },
  });
  return { player, answer };
}

async function teacherSocket(code: string, teacherKey: string) {
  const socket = client();
  await joined(socket);
  const res = await ask<JoinAck>(socket, 'room:join', { code, teacherKey });
  expect(res.ok).toBe(true);
  return socket;
}

const CODE_A = 'AIT001';
const KEY_A = 'teacher-key-a';
const CODE_B = 'AIT002';
const KEY_B = 'teacher-key-b';

let roomA: Awaited<ReturnType<typeof makeRoom>>;
let roomB: Awaited<ReturnType<typeof makeRoom>>;

beforeAll(async () => {
  httpServer = createServer();
  ioServer = new Server(httpServer);
  registerSocketHandlers(ioServer as never);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

  roomA = await makeRoom(CODE_A, KEY_A);
  roomB = await makeRoom(CODE_B, KEY_B);
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  await prisma.room.deleteMany({ where: { code: { in: [CODE_A, CODE_B] } } });
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('teacher:generate-ai-meme — authorization and room isolation', () => {
  it('refuses a student socket outright', async () => {
    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: true });
    const student = client();
    await joined(student);
    await ask<JoinAck>(student, 'room:join', { code: CODE_A, nickname: 'นักเรียน' });

    const res = await ask<GenAck>(student, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(res.ok).toBe(false);
    expect(mocks.generateMemeImage).not.toHaveBeenCalled();
  });

  it("refuses an answerId belonging to a different room, even for that room's own teacher", async () => {
    mocks.generateMemeImage.mockClear();
    const { answer } = await makeAnswer(roomB.room.id, roomB.question.id, { promoted: true });

    const teacherA = await teacherSocket(CODE_A, KEY_A);
    const res = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(res.ok).toBe(false);
    expect(mocks.generateMemeImage).not.toHaveBeenCalled();
  });

  it('refuses an answer that has not been promoted', async () => {
    mocks.generateMemeImage.mockClear();
    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: false });

    const teacherA = await teacherSocket(CODE_A, KEY_A);
    const res = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ขึ้นจอ/);
    expect(mocks.generateMemeImage).not.toHaveBeenCalled();
  });
});

describe('teacher:generate-ai-meme — idempotency (no duplicate paid requests)', () => {
  it('a second call for the same answer while one is in flight is rejected, not queued', async () => {
    mocks.generateMemeImage.mockClear();
    let resolveGeneration!: (url: string) => void;
    mocks.generateMemeImage.mockImplementation(
      () => new Promise<string>((resolve) => (resolveGeneration = resolve)),
    );

    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: true });
    const teacherA = await teacherSocket(CODE_A, KEY_A);

    const first = ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    // Give the first handler's synchronous lock-acquire a tick to run before
    // firing the second — the lock itself does not need this, but it keeps
    // the test deterministic about which call is "first" without racing the
    // assertion on `toHaveBeenCalledTimes` below.
    await new Promise((r) => setTimeout(r, 10));
    const second = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/กำลังสร้าง/);
    expect(mocks.generateMemeImage).toHaveBeenCalledTimes(1);

    resolveGeneration('/memes/fake-ai.png');
    const firstRes = await first;
    expect(firstRes.ok).toBe(true);
  });

  it('the lock releases after completion — a later call is allowed and calls the generator again', async () => {
    mocks.generateMemeImage.mockClear();
    mocks.generateMemeImage.mockResolvedValue('/memes/fake-ai-2.png');

    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: true });
    const teacherA = await teacherSocket(CODE_A, KEY_A);

    const res = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(res.ok).toBe(true);
    expect(mocks.generateMemeImage).toHaveBeenCalledTimes(1);
  });
});

describe('teacher:generate-ai-meme — failure handling', () => {
  it('a failed generation returns a fixed, generic error — never the raw internal reason', async () => {
    mocks.generateMemeImage.mockClear();
    mocks.generateMemeImage.mockRejectedValueOnce(
      new Error('OpenAI moderation_blocked: sk-secret-leaking-detail'),
    );

    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: true });
    const teacherA = await teacherSocket(CODE_A, KEY_A);

    const res = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/sk-secret/);
      expect(res.error).not.toMatch(/moderation_blocked/);
    }
  });

  it('is not left stuck — a follow-up call after a failure is accepted and tried again', async () => {
    mocks.generateMemeImage.mockClear();
    mocks.generateMemeImage.mockResolvedValueOnce(null); // image-gen.ts's own "could not generate" case
    mocks.generateMemeImage.mockResolvedValueOnce('/memes/fake-ai-retry.png');

    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: true });
    const teacherA = await teacherSocket(CODE_A, KEY_A);

    const failed = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(failed.ok).toBe(false);

    const retried = await ask<GenAck>(teacherA, 'teacher:generate-ai-meme', { answerId: answer.id });
    expect(retried.ok).toBe(true);
    expect(mocks.generateMemeImage).toHaveBeenCalledTimes(2);
  });
});

describe('teacher:generate-ai-meme — per-room rate cap', () => {
  it(`refuses generation beyond AI_GENERATION_CAP (${AI_GENERATION_CAP}) for one room`, async () => {
    const CAP_CODE = 'AIT003';
    const CAP_KEY = 'teacher-key-cap';
    const { room, question } = await makeRoom(CAP_CODE, CAP_KEY);

    mocks.generateMemeImage.mockClear();
    mocks.generateMemeImage.mockResolvedValue('/memes/fake-ai-cap.png');

    const teacher = await teacherSocket(CAP_CODE, CAP_KEY);

    for (let i = 0; i < AI_GENERATION_CAP; i++) {
      const { answer } = await makeAnswer(room.id, question.id, { promoted: true });
      const res = await ask<GenAck>(teacher, 'teacher:generate-ai-meme', { answerId: answer.id });
      expect(res.ok).toBe(true);
    }
    expect(mocks.generateMemeImage).toHaveBeenCalledTimes(AI_GENERATION_CAP);

    const { answer: oneTooMany } = await makeAnswer(room.id, question.id, { promoted: true });
    const overCap = await ask<GenAck>(teacher, 'teacher:generate-ai-meme', {
      answerId: oneTooMany.id,
    });
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.error).toMatch(new RegExp(String(AI_GENERATION_CAP)));
    // The cap must reject before ever calling the (paid) generator again.
    expect(mocks.generateMemeImage).toHaveBeenCalledTimes(AI_GENERATION_CAP);

    await prisma.room.deleteMany({ where: { code: CAP_CODE } });
  }, 20_000);
});

describe('teacher:edit-dialogue — authorization and room isolation', () => {
  it('refuses a student socket', async () => {
    mocks.recompositeDialogue.mockClear();
    const { answer } = await makeAnswer(roomA.room.id, roomA.question.id, { promoted: true });
    const student = client();
    await joined(student);
    await ask<JoinAck>(student, 'room:join', { code: CODE_A, nickname: 'อีกคน' });

    const res = await ask<GenAck>(student, 'teacher:edit-dialogue', {
      answerId: answer.id,
      dialogue: [{ speaker: 'A', line: 'B' }],
    });
    expect(res.ok).toBe(false);
    expect(mocks.recompositeDialogue).not.toHaveBeenCalled();
  });

  it("refuses an answerId belonging to a different room", async () => {
    mocks.recompositeDialogue.mockClear();
    const { answer } = await makeAnswer(roomB.room.id, roomB.question.id, { promoted: true });

    const teacherA = await teacherSocket(CODE_A, KEY_A);
    const res = await ask<GenAck>(teacherA, 'teacher:edit-dialogue', {
      answerId: answer.id,
      dialogue: [{ speaker: 'A', line: 'B' }],
    });
    expect(res.ok).toBe(false);
    expect(mocks.recompositeDialogue).not.toHaveBeenCalled();
  });
});
