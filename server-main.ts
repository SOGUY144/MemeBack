/**
 * The real server — Next's request handler, the HTTP server, and Socket.IO
 * wired together. Split out of server.ts specifically so it can be loaded
 * via a *dynamic* `import()` from there, after env loading and the database
 * readiness check both succeed — a static import here would pull in
 * `@/server/socket` → `@/lib/db` (which constructs `new PrismaClient()` at
 * module scope) before that validation ever runs, exactly the ordering bug
 * server.ts's bootstrap exists to prevent.
 */
import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';

import { registerSocketHandlers, type IO } from '@/server/socket';

export async function startServer() {
  const dev = process.env.NODE_ENV !== 'production';
  const hostname = process.env.HOST ?? '0.0.0.0';
  const port = Number(process.env.PORT ?? 3000);

  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[next] request failed:', err);
      res.statusCode = 500;
      res.end('internal error');
    });
  });

  // Registered *before* Socket.IO attaches: engine.io snapshots the existing
  // upgrade listeners when it attaches and replays non-Socket.IO upgrades to
  // them. Register this afterwards and dev HMR loses its websocket.
  const upgradeHandler = app.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => {
    upgradeHandler(req, socket, head).catch((err: unknown) => {
      console.error('[next] upgrade failed:', err);
      socket.destroy();
    });
  });

  const io: IO = new Server(server, {
    // students upload their encoded meme over the socket; a 5s GIF at 480×270
    // lands well under this, but the default 1MB would clip the busy ones.
    maxHttpBufferSize: 8 * 1024 * 1024,
    cors: { origin: true },
  });

  registerSocketHandlers(io);

  server.listen(port, hostname, () => {
    const shown = hostname === '0.0.0.0' ? 'localhost' : hostname;
    console.log(`\n  MemeBack พร้อมแล้ว → http://${shown}:${port}`);
    console.log(
      process.env.OPENAI_API_KEY
        ? '  AI: เปิดใช้งาน'
        : '  AI: ปิดอยู่ (ไม่มี OPENAI_API_KEY) — ทุกคำตอบจะใช้ฉากสำรอง\n',
    );
  });
}
