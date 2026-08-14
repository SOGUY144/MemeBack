import { NextResponse } from 'next/server';
import { networkInterfaces } from 'node:os';

export const dynamic = 'force-dynamic';

/**
 * The projector runs on the teacher's own laptop, so `window.location.origin`
 * there is `http://localhost:3000`. Encoding that into the QR sends every phone
 * that scans it to its *own* loopback. The server binds `0.0.0.0`, so the room
 * is already reachable over the classroom wifi — it just needs to advertise the
 * address a phone can actually route to.
 */

/** 192.168/16 and 10/8 are the ranges a school wifi hands out; 172.16/12 is
 *  common on docker/VM bridges, so it is a last resort rather than a first pick. */
function rank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const [a, b] = ip.split('.').map(Number);
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return 2;
  return 3;
}

function lanAddress(): string | null {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const addr of addresses ?? []) {
      // Node <18 reports `family` as the number 4; newer versions use 'IPv4'.
      const isV4 = addr.family === 'IPv4' || (addr.family as unknown as number) === 4;
      // 169.254/16 is what an interface self-assigns when DHCP failed — it looks
      // like a LAN address but nothing can reach it.
      if (!isV4 || addr.internal || addr.address.startsWith('169.254.')) continue;
      found.push(addr.address);
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => rank(a) - rank(b));
  return found[0]!;
}

export function GET() {
  // Set PUBLIC_ORIGIN when the room is served through a tunnel or a real
  // hostname. It also buys HTTPS, which is what `VideoEncoder` needs to produce
  // the small MP4 instead of falling back to the ~10x larger gif.js path.
  const configured = process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, '');
  if (configured) {
    return NextResponse.json({ origin: configured, source: 'env', secure: configured.startsWith('https://') });
  }

  const ip = lanAddress();
  if (!ip) return NextResponse.json({ origin: null, source: 'none', secure: false });

  const port = process.env.PORT ?? '3000';
  return NextResponse.json({ origin: `http://${ip}:${port}`, source: 'lan', secure: false });
}
