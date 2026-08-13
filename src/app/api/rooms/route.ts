import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { newRoomCode, newTeacherKey } from '@/server/socket';

export const dynamic = 'force-dynamic';

/** Creates a room. The teacherKey is returned once and lives in localStorage. */
export async function POST() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newRoomCode();
    const taken = await prisma.room.findUnique({ where: { code } });
    if (taken) continue;

    const room = await prisma.room.create({
      data: { code, teacherKey: newTeacherKey() },
    });
    return NextResponse.json({ code: room.code, teacherKey: room.teacherKey });
  }

  return NextResponse.json({ error: 'สร้างรหัสห้องไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 503 });
}
