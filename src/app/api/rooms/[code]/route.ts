import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = await prisma.room.findUnique({
    where: { code: code.toUpperCase() },
    select: { code: true, phase: true },
  });
  if (!room) return NextResponse.json({ exists: false }, { status: 404 });
  return NextResponse.json({ exists: true, ...room });
}
