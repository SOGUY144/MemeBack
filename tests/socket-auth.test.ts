import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClientToServer, Phase, ServerToClient } from '@/lib/realtime/events';

/**
 * The one guarantee that cannot be checked by reading the UI: a student's socket
 * is refused when it asks for something only the teacher may do. Hiding the
 * button proves nothing, so this drives the real handlers over a real socket.
 *
 * Runs against a throwaway copy of prisma/dev.db — the schema is already in
 * there, and copying is faster and more predictable than shelling out to
 * `prisma db push`. DATABASE_URL has to be set before anything imports the
 * Prisma client, which is why the imports below are dynamic.
 */
const dir = mkdtempSync(path.join(tmpdir(), 'memeback-test-'));
const dbFile = path.join(dir, 'test.db');
copyFileSync(path.join(process.cwd(), 'prisma', 'dev.db'), dbFile);
process.env.DATABASE_URL = `file:${dbFile}`;

const { prisma } = await import('@/lib/db');
const { registerSocketHandlers } = await import('@/server/socket');

const TEACHER_KEY = 'test-teacher-key';
const CODE = 'TST001';

let httpServer: HttpServer;
let ioServer: Server;
let url: string;
const clients: ClientSocket[] = [];

function client(): ClientSocket<ServerToClient, ClientToServer> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  return socket as ClientSocket<ServerToClient, ClientToServer>;
}

/** socket.io's emit-with-ack, as a promise, so the tests read top to bottom. */
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
type PhaseAck = { ok: boolean; error?: string };

beforeAll(async () => {
  await prisma.room.deleteMany({ where: { code: CODE } });
  const room = await prisma.room.create({
    data: { code: CODE, teacherKey: TEACHER_KEY, phase: 'LOBBY' },
  });
  await prisma.question.create({
    data: {
      roomId: room.id,
      prompt: 'ทดสอบ',
      targetConcept: "Newton's Third Law",
      subject: 'science',
      distractors: [],
    },
  });

  httpServer = createServer();
  ioServer = new Server(httpServer);
  registerSocketHandlers(ioServer as never);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  // Every disconnect fires a handler that pushes room state, and those are still
  // in flight here. Tearing the Prisma client down underneath them makes the
  // engine log a failure that has nothing to do with the tests.
  await new Promise((resolve) => setTimeout(resolve, 150));
  // io.close() takes the http server it was attached to down with it.
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('teacher-only events', () => {
  it('refuses a phase change from a student socket', async () => {
    const student = client();
    await joined(student);
    const join = await ask<JoinAck>(student, 'room:join', { code: CODE, nickname: 'นักเรียน' });
    expect(join.ok).toBe(true);

    const res = await ask<PhaseAck>(student, 'teacher:phase', { phase: 'ANSWERING' as Phase });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();

    const room = await prisma.room.findUnique({ where: { code: CODE } });
    expect(room?.phase).toBe('LOBBY');
  });

  it('refuses a phase change from the projector socket', async () => {
    const screen = client();
    await joined(screen);
    await ask<JoinAck>(screen, 'room:join', { code: CODE, asScreen: true });

    const res = await ask<PhaseAck>(screen, 'teacher:phase', { phase: 'ANSWERING' as Phase });
    expect(res.ok).toBe(false);

    const room = await prisma.room.findUnique({ where: { code: CODE } });
    expect(room?.phase).toBe('LOBBY');
  });

  it('rejects a wrong teacher key outright', async () => {
    const faker = client();
    await joined(faker);
    const join = await ask<JoinAck>(faker, 'room:join', { code: CODE, teacherKey: 'wrong' });
    expect(join.ok).toBe(false);
  });

  it('lets the real teacher through, and still checks the edge is legal', async () => {
    const teacher = client();
    await joined(teacher);
    const join = await ask<JoinAck>(teacher, 'room:join', { code: CODE, teacherKey: TEACHER_KEY });
    expect(join).toMatchObject({ ok: true, isTeacher: true });

    // LOBBY → CLASS_GUESS is not an edge, so even the teacher is refused
    const illegal = await ask<PhaseAck>(teacher, 'teacher:phase', { phase: 'CLASS_GUESS' as Phase });
    expect(illegal.ok).toBe(false);

    const legal = await ask<PhaseAck>(teacher, 'teacher:phase', { phase: 'ANSWERING' as Phase });
    expect(legal.ok).toBe(true);

    const room = await prisma.room.findUnique({ where: { code: CODE } });
    expect(room?.phase).toBe('ANSWERING');
  });

  it('refuses promotion changes from a student socket', async () => {
    const student = client();
    await joined(student);
    await ask<JoinAck>(student, 'room:join', { code: CODE, nickname: 'อีกคน' });

    const res = await ask<PhaseAck>(student, 'teacher:promote', { answerId: 'whatever', on: true });
    expect(res.ok).toBe(false);
  });
});

describe('joining', () => {
  it('gives a duplicate nickname a suffix instead of turning the student away', async () => {
    const a = client();
    await joined(a);
    const first = await ask<JoinAck>(a, 'room:join', { code: CODE, nickname: 'ปาล์ม' });
    expect(first.ok).toBe(true);

    const b = client();
    await joined(b);
    const second = await ask<JoinAck>(b, 'room:join', { code: CODE, nickname: 'ปาล์ม' });
    expect(second.ok).toBe(true);

    const room = await prisma.room.findUnique({
      where: { code: CODE },
      include: { players: true },
    });
    const names = room!.players.map((p) => p.nickname).filter((n) => n.startsWith('ปาล์ม'));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('lets a latecomer in after the room has moved past ANSWERING', async () => {
    await prisma.room.update({ where: { code: CODE }, data: { phase: 'CLASS_GUESS' } });

    const late = client();
    await joined(late);
    const res = await ask<JoinAck>(late, 'room:join', { code: CODE, nickname: 'มาสาย' });
    expect(res.ok).toBe(true);
  });

  it('still refuses a room code that does not exist', async () => {
    const lost = client();
    await joined(lost);
    const res = await ask<JoinAck>(lost, 'room:join', { code: 'NOPE99', nickname: 'ใครก็ไม่รู้' });
    expect(res.ok).toBe(false);
  });
});
