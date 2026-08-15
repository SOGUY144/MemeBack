# MemeBack — สรุปโปรเจคสำหรับ Codex

เอกสารนี้สรุปสถานะปัจจุบันของ repo `memeback` (โฟลเดอร์ `MemeBack/`) เพื่อให้ agent อื่นเข้าใจโปรเจคได้เร็วโดยไม่ต้องไล่อ่านทุกไฟล์เอง ข้อมูลดึงมาจาก README.md, TODO.md, schema.prisma, และซอร์สโค้ดจริงในโฟลเดอร์ `src/` ณ วันที่ 15 ส.ค. 2569

## 1. โปรเจคนี้คืออะไร

ครูตั้งคำถามปลายเปิดในห้องเรียน → นักเรียนแต่ละคนพิมพ์คำตอบด้วยความคิดตัวเอง → AI วิเคราะห์คำตอบและแปลงเป็น **สตอรีบอร์ด (SceneSpec)** → เอนจิ้นฝั่งเบราว์เซอร์เรนเดอร์เป็นมีมสั้น ๆ (GIF/MP4) → ทั้งห้องทายว่ามีมนั้นสื่อถึงหลักการอะไร → ครูเฉลย

```
Student Answer → AI Analysis → Meme GIF → Class Guess → Teacher Reveal
```

กติกาสำคัญ: **AI ไม่เคยแต่งคำตอบให้นักเรียน** มันแค่เข้ารหัสความคิดของนักเรียนใหม่ให้เป็นภาพ คำตอบที่ว่างหรือไม่เข้าเรื่องจะถูกบอกตรง ๆ ว่า `off_topic` ไม่ใช่สร้างฉากมั่วขึ้นมาแทน

Demo หลักที่ seed ไว้ (`npm run seed` สร้างห้อง `MEME01`): คำถามกฎข้อที่ 3 ของนิวตัน มีตัวอย่างคำตอบ `correct` / `misconception` / `off_topic` ให้ทดสอบ flow ครบ

## 2. Stack เทคนิค

- **Next.js 15** (App Router) + **React 19** + TypeScript, รันผ่าน custom server (`server.ts`) ที่ผูก Next กับ **Socket.IO** บนพอร์ตเดียว — ไม่ใช้ Next dev server เปล่า ๆ
- **Prisma** ORM, dev ใช้ **SQLite** (`prisma/dev.db`), schema เขียนให้ swap ไป Postgres ได้โดยเปลี่ยนแค่ `provider`
- **Pixi.js v8** สำหรับเรนเดอร์แอนิเมชันมีมที่ 480×270 ฝั่งเบราว์เซอร์ของนักเรียนแต่ละคน (ไม่ใช่เซิร์ฟเวอร์)
- เข้ารหัสวิดีโอด้วย **WebCodecs → MP4** ถ้าเบราว์เซอร์รองรับและอยู่ใน secure context ไม่งั้น fallback เป็น **gif.js** (ใน Web Worker) — ไฟล์ใหญ่กว่ามาก (~582KB vs ~55KB) แต่เล่นได้เหมือนกัน
- **Zod** validate โครงสร้าง SceneSpec ที่ AI ส่งกลับมา
- **@anthropic-ai/sdk** เรียก Claude เพื่อวิเคราะห์คำตอบ (โมเดล default `claude-sonnet-5`, override ได้ด้วย `ANTHROPIC_MODEL`)
- **Vitest** สำหรับเทสต์, **Tailwind v4** (CSS-first `@theme`, ไม่มีไฟล์ config แยก)
- ไม่มี web font ทั้งแอป — ใช้ `Noto Sans Thai` / `Leelawadee UI` / `Segoe UI` ที่มีอยู่ในเครื่อง เพราะต้องบูตได้บนโน้ตบุ๊กโรงเรียนที่ไม่มีเน็ต

## 3. โครงสร้างไฟล์หลัก

```
server.ts                    Next custom server + Socket.IO (พอร์ตเดียว)
src/server/socket.ts         หัวใจของ backend: เฟส สิทธิ์ ไปป์ไลน์สร้างมีม การทาย คะแนน (~38KB ไฟล์เดียว)
src/server/ai.ts             เรียก LLM ทั้งหมด คิวจำกัด 5 งานพร้อมกัน
src/server/promotion.ts      เลือกมีม 3–5 อันขึ้นจอ (auto-promotion)
src/server/scoring.ts        สูตรคะแนน (ดูหัวข้อ 6)
src/lib/realtime/events.ts   ★ สัญญา TypeScript ของ Socket.IO ทั้งหมด (ClientToServer/ServerToClient) — จุดเริ่มอ่านที่ดีที่สุด
src/lib/realtime/client.ts   socket client — เป็น module-level singleton ใช้ร่วมกันข้าม client-side navigation (ดูหัวข้อ 8)
src/lib/ai/scene-schema.ts   Zod SceneSpec + FALLBACK_SCENE
src/lib/meme/vocab.ts        คำศัพท์ปิด: 23 clip, 8 sprite, 7 ฉาก, 4 รูปแบบมีม, 4 verdict — LLM พูดได้แค่คำในนี้
src/lib/meme/clips.ts        คีย์เฟรมของทั้ง 23 clip
src/lib/meme/compile.ts      SceneSpec → timeline เวลาสัมบูรณ์ (ทำ synonym mapping ก่อนตก fallback)
src/lib/meme/renderer.ts     Pixi v8 renderer จัดองค์ประกอบตามรูปแบบมีม (~27KB)
src/lib/meme/encode.ts       WebCodecs → MP4 ถ้ามี ไม่งั้น gif.js ใน worker
src/assets/sprites/          สไปรต์ SVG แบบแยกชิ้น ไม่มีไฟล์ภาพภายนอก
src/app/page.tsx             หน้า landing/join (redesign แล้ว — ดูหัวข้อ 7)
src/app/host/[code]/         แผงควบคุมครู (redesign แล้ว)
src/app/screen/[code]/       จอฉายโปรเจกเตอร์ (redesign แล้ว)
src/app/play/[code]/         หน้านักเรียน (★ ยังไม่ redesign — ดูหัวข้อ 7)
src/app/dev/scenes/          ตรวจ renderer โดยไม่ต้องมี API key: SceneSpec เขียนมือครบทุกรูปแบบ
src/app/api/join-url/        หา IP วงในของเครื่องที่รันเซิร์ฟเวอร์ ให้จอฉายสร้าง QR ที่ใช้ได้จริงบนมือถือ (ไม่ใช้ localhost)
tests/                       phase.test.ts (state machine), socket-auth.test.ts (รัน socket.io จริงบนพอร์ตชั่วคราว)
```

## 4. Data model (Prisma — `prisma/schema.prisma`)

```
Room      code (unique, 6 ตัว, ไม่มี O/0/I/1), teacherKey (secret ใน localStorage ครู), phase
Question  prompt, targetConcept, conceptHint?, subject, language, distractors (Json string[])
Player    nickname, score, socketId?
Answer    rawText, analysis (Json = SceneSpec), verdict, memeUrl, promoted
Guess     choice, correct  (@@unique [answerId, playerId] — ทายซ้ำไม่ได้)
```
ความสัมพันธ์เป็น cascade delete ทั้งสาย (ลบ Room → ลบทุกอย่างที่ผูกกับมัน)

## 5. Phase state machine + Socket protocol

จาก `src/lib/realtime/events.ts` (ของจริง ไม่ใช่สรุปคร่าว ๆ):

```ts
LOBBY:            ['ANSWERING']
ANSWERING:        ['GENERATING']
GENERATING:       ['PERSONAL_REVEAL']
PERSONAL_REVEAL:  ['CLASS_GUESS', 'SCOREBOARD']
CLASS_GUESS:      ['REVEAL']
REVEAL:           ['CLASS_GUESS', 'ANSWERING', 'SCOREBOARD']
SCOREBOARD:       ['ANSWERING', 'LOBBY']
```
เช็คด้วย `canTransition()` — **ครูฝั่ง client เป็นคนขับเฟส แต่เซิร์ฟเวอร์เช็คซ้ำทุก hop เสมอ** ห้ามไว้ใจ client ล้วน ๆ

**Client → Server:** `room:join`, `answer:submit`, `guess:submit`, `meme:upload`, `teacher:phase`, `teacher:promote`, `teacher:question`, `teacher:guess-next`, `teacher:reanalyze`
**Server → Client:** `room:state`, `meme:progress`, `meme:ready`, `meme:mine`, `answer:mine`, `generation:status`, `guess:card`, `guess:tally`, `reveal:answer`, `scoreboard`, `error`

สิทธิ์: เปลี่ยนเฟส/โปรโมทมีม/ตั้งคำถามได้เฉพาะ socket ที่ยืนยันด้วย `teacherKey` เท่านั้น — เซิร์ฟเวอร์ปฏิเสธเองถ้า socket นักเรียนยิง `teacher:*` มา ไม่ใช่แค่ซ่อนปุ่มใน UI

## 6. คะแนน (`src/server/scoring.ts`)

- ทายถูก: `100 - 2×วินาทีที่ผ่านไป` พื้น 40 (**บั๊กที่รู้อยู่**: ไม่มีการเช็ค deadline จริง ทายหลังนาฬิกาขึ้น 0 ก็ยังได้ 40 คะแนนเท่ากับทายตอนวินาทีสุดท้ายพอดี — ดูหัวข้อ 9)
- เจ้าของมีมได้ +150 ถ้า ≥50% ของคนโหวตทายถูก
- คะแนนคำตอบตัวเอง: `correct`=50, `partial`=35, `misconception`=20, `off_topic`=5 (สเปกกำหนดแค่ correct/misconception ที่เหลือเติมตามหลัก "ลงมือทำแล้วไม่ควรได้ศูนย์")

## 7. ระบบดีไซน์ — กำลัง migrate อยู่ (สำคัญมากสำหรับใครมาแก้ UI)

แอปเริ่มจากธีม **"chunky"**: กรอบหมึกหนา 3–4px, hard offset shadow, สีจัด — คลาสอยู่ใน `src/app/globals.css` (`.chunk`, `.chunk-sm`, `.btn`, `.field`, `.tag`)

ตั้งแต่ 14 ส.ค. 2569 กำลังเปลี่ยนทีละหน้าไปเป็นธีม **"soft"**: การ์ดขาว/เข้ม มุมโค้ง rounded-3xl, soft shadow, ปุ่ม gradient, ไม่มีกรอบหนา — อิงจาก mockup สไตล์ Figma ที่เจ้าของโปรเจคส่งเป็นภาพให้ทีละหน้า

**สถานะ migration ณ ตอนนี้:**
1. ✅ `/screen/[code]` — เพิ่มคลาส `.join-card` แทน fullscreen stack เดิม
2. ✅ `/host/[code]` — redesign เต็มรูปแบบ, เพิ่ม `.host-field`, มี inline SVG icon set ในไฟล์ `.tsx` เอง
3. ✅ `/` (landing) — ใช้ `.host-field` ซ้ำ, ปุ่ม gradient ส้ม (join) / มินต์ (create room)
4. ❌ **`/play/[code]` (หน้านักเรียน) ยังไม่ redesign** — ยังใช้คลาส chunky เดิม (`.chunk`/`.btn`/`.field`/`.tag`) ถ้ามีงานต่อไปคือ "ทำให้ทุกหน้า consistent" นี่คือหน้าที่เหลือ

**ห้ามลบคลาส chunky (`.chunk`, `.chunk-sm`, `.btn*`, `.field`, `.tag`) ออกจาก globals.css จนกว่า `/play` จะ migrate เสร็จ** เพราะยังใช้อยู่จริง

Palette แบรนด์ (ของจริงจาก `globals.css`): ink `#111318`, paper `#fff6e5`, pop (ส้ม) `#ff6b35`, sun (เหลือง) `#ffd93d`, mint `#16c79a`, sky `#2e86ff`, berry (แดง) `#e63946`, grape (ม่วง) `#7f6fb0`, night (จอฉาย) `#16171f`

## 8. บั๊กที่เพิ่งแก้ (14 ส.ค. 2569) — ยังไม่ได้บันทึกใน TODO.md

**อาการ:** เข้าห้องใหม่แล้วจอฉายโชว์ผู้เล่นค้างจากห้องทดสอบเก่า (เช่นชื่อ "max" ที่ไม่ควรอยู่)

**สาเหตุ:** `src/lib/realtime/client.ts` เป็น module-level singleton ที่ใช้ร่วมกันข้าม client-side navigation ฝั่งเซิร์ฟเวอร์ `room:join` (`src/server/socket.ts`) ไม่เคยเรียก `socket.leave()` ออกจากห้องเก่าก่อนเข้าห้องใหม่ — แท็บที่เคยเข้าห้องทดสอบเก่าเลยยังรับ broadcast ของห้องเก่าอยู่

**วิธีแก้:** (1) เซิร์ฟเวอร์ออกจาก channel เก่า (room/teacher/player) ใน `room:join` ก่อนเข้าห้องใหม่เสมอ ผ่าน `socket.data.roomCode`, (2) client's `onState` handler เพิ่ม defense-in-depth: ignore `RoomState` ที่ `.code` ไม่ตรงกับห้องที่ hook กำลังโชว์อยู่

**ข้อควรระวัง:** ต้อง restart custom Node server (`server.ts`) ให้เปลี่ยนมีผล — โค้ด socket.io ฝั่งเซิร์ฟเวอร์ไม่ถูก pick up ด้วย Next.js Fast Refresh

## 9. สถานะงาน / สิ่งที่ต้องทำต่อ (จาก TODO.md จริง เรียงตามผลกระทบ ไม่ใช่ความยาก)

### บล็อกการเอาไปใช้สอนจริง
- **ยังไม่มี `ANTHROPIC_API_KEY` ใน `.env`** → ทุกคำตอบได้ฉากสำรอง (`verdict: partial`) เหมือนกันหมด ยังไม่เคยมีมีมส่วนตัวจริงเกิดขึ้นเลย ต้องใส่คีย์ก่อนถึงจะทดสอบของจริงได้

### แก้แล้วทั้งหมด (14 ส.ค. 2569) — 9 บั๊ก
QR ชี้ผิด IP, นักเรียนมาสายเข้าห้องไม่ได้, progress bar ปลอม, คำตอบ off_topic เป็นทางตัน, เข้าห้องกลางเฟส REVEAL/SCOREBOARD เจอจอเปล่า, กดขึ้นจอระหว่างรอบทายทำให้ทายไม่ได้, ชื่อเล่นซ้ำ, คำตอบวิเคราะห์ล้มเหลวเป็นทางตัน, ไฟล์มีมไม่เคยถูกลบ — รายละเอียดเต็มอยู่ใน `TODO.md` ส่วน 1 ถ้าต้องแก้อะไรใกล้เคียงจุดพวกนี้ควรอ่านของเดิมก่อนว่าทำไมถึงแก้แบบนั้น

### รอพิสูจน์ (ต้องมี API key ก่อนถึงจะทำได้)
ยืนยัน verdict จริงจาก AI ตรงตาม acceptance criteria (correct/misconception/off_topic ตามตัวอย่างใน README), ยืนยัน distractor ที่ AI สร้างใช้ได้จริงไม่ใช่ fallback, วัดเวลาจริง (พรีวิว ≤1.5s, ไฟล์เสร็จ ≤4s)

### ต้องทดสอบแบบห้องเรียนจริง
เทสต์ด้วย 3 เครื่องแยกกันจริง (เทสต์เดิมใช้ 2 แท็บเบราว์เซอร์เดียวกัน localStorage ก้อนเดียวกันเลยกลายเป็นคนเดียวกัน — **ไม่ valid**), เปิดจอโปรเจกเตอร์จริงอ่านจากหลังห้องได้ไหม, ปุ่มบนมือถือใหญ่พอไหม, ปิด-เปิด wifi กลางคันแล้วกลับเข้าห้องเป็นคนเดิมได้ไหม

### ช่องโหว่ที่รู้อยู่ ยังไม่กระทบการใช้งาน
- นาฬิกาจับเวลาทายเป็นแค่ตัวเลขโชว์ — **`guess:submit` ไม่เช็ค deadline จริง** ทายช้าไม่มีโทษ (พื้น 40 คะแนนเสมอ)
- ตั้งเวลาทายไม่ได้ — `GUESS_DURATION_MS` ฝัง 30 วินาทีเป็นค่าคงที่
- `?key=` (teacherKey) อยู่ใน URL ติด browser history — พอสำหรับห้องเรียนแต่ไม่ควรใช้ที่อื่น
- ตัวเลือกคำตอบสลับใหม่ถ้าเซิร์ฟเวอร์รีสตาร์ทกลางรอบ (state อยู่ใน memory)
- SceneSpec ที่ parse ไม่ผ่านทำให้มีมหายเงียบ ๆ ไม่มี log บอกครู

### เพิ่มความสมบูรณ์ (ยังไม่ทำ)
สลับภาษาไทย/อังกฤษ (`src/lib/i18n/en.ts` เขียนครบแล้วแต่ไม่มีปุ่มสลับ), เพิ่มสไปรต์ (ตอนนี้มีแค่ 8 ตัว), ให้ครูจัดลำดับมีมบนจอเอง, หน้าสรุปหลังคาบ

### Deploy จริงนอกเครื่องตัวเอง
ย้าย SQLite → Postgres (schema รองรับอยู่แล้ว), ย้ายไฟล์มีมจาก disk ไป object storage ถ้า deploy หลาย instance, `runtimes` map อยู่ใน memory ของ process เดียว — สเกลหลาย instance ต้องมี Redis หรือ sticky session

## 10. วิธีรันโปรเจค

```bash
npm install
cp .env.example .env       # ใส่ ANTHROPIC_API_KEY เองถ้าจะทดสอบ AI จริง
npx prisma db push
npm run seed                # สร้างห้อง MEME01 พร้อมคำถามนิวตัน
npm run dev
```
เปิดสามลิงก์ (โผล่ใน output ของ `npm run seed` ด้วย): ครู `/host/MEME01?key=demo-teacher-key`, จอฉาย `/screen/MEME01`, นักเรียน `/play/MEME01`

`npm test` รัน vitest (`tests/phase.test.ts` — ตารางเส้นทางเขียนมือ ไม่ได้อ่านจาก `PHASE_TRANSITIONS` เอง กัน false-positive; `tests/socket-auth.test.ts` — รัน socket.io จริงบนพอร์ตชั่วคราวกับสำเนา `dev.db`)

`npm run typecheck` = `tsc --noEmit`

## 11. Git remotes

- `origin` → `https://github.com/maxsaidawat-cell/memeback.git` (branch `main` track อยู่)
- `soguy` → `https://github.com/SOGUY144/MemeBack.git` (remote ที่สองของ repo เดียวกัน เจ้าของโปรเจคใช้ push ไปทั้งสองที่)
- `.gitignore` กัน `.env`, `node_modules/`, `.next/`, `prisma/dev.db*`, `public/memes/` ไว้แล้ว ปลอดภัยที่จะ push
