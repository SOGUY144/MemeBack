import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';

import { registerSocketHandlers, type IO } from '@/server/socket';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

async function main() {
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
      process.env.ANTHROPIC_API_KEY
        ? '  AI: เปิดใช้งาน'
        : '  AI: ปิดอยู่ (ไม่มี ANTHROPIC_API_KEY) — ทุกคำตอบจะใช้ฉากสำรอง\n',
    );
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
