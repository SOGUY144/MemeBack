import { PrismaClient } from '@prisma/client';

/**
 * Demo room for the walkthrough in the README.
 *
 * The teacher key is fixed (and obviously not a secret) so the seeded room can
 * be opened straight from a link instead of hunting through localStorage.
 */
const prisma = new PrismaClient();

const CODE = 'MEME01';
const TEACHER_KEY = 'demo-teacher-key';

async function main() {
  await prisma.room.deleteMany({ where: { code: CODE } });

  const room = await prisma.room.create({
    data: { code: CODE, teacherKey: TEACHER_KEY, phase: 'LOBBY' },
  });

  await prisma.question.create({
    data: {
      roomId: room.id,
      prompt: 'ยกตัวอย่างเหตุการณ์ในชีวิตประจำวันที่เกี่ยวข้องกับกฎข้อที่ 3 ของนิวตัน',
      targetConcept: "Newton's Third Law",
      conceptHint: 'ทุกแรงกิริยามีแรงปฏิกิริยาขนาดเท่ากันแต่ทิศทางตรงกันข้าม',
      subject: 'science',
      distractors: ['กฎการอนุรักษ์พลังงาน', 'ความเฉื่อย (กฎข้อที่ 1)', 'แรงเสียดทาน'],
    },
  });

  const port = process.env.PORT ?? 3000;
  console.log(`\n  ห้องเดโมพร้อมแล้ว: ${CODE}`);
  console.log(`  ครู      http://localhost:${port}/host/${CODE}?key=${TEACHER_KEY}`);
  console.log(`  จอฉาย    http://localhost:${port}/screen/${CODE}`);
  console.log(`  นักเรียน http://localhost:${port}/play/${CODE}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
