'use client';

import { useState } from 'react';
import { MemeFilmstrip } from '@/components/meme/MemeFilmstrip';
import { MemeStage } from '@/components/meme/MemeStage';
import type { Scene } from '@/lib/ai/scene-schema';
import { compileScene } from '@/lib/meme/compile';

/**
 * Hand-written storyboards for checking the meme engine without an API key
 * (build order step 2). Every clip, every setting and all four meme formats are
 * reachable from here, so a rendering regression shows up immediately.
 */

type Sample = { title: string; note: string; scene: Scene };

const SAMPLES: Sample[] = [
  {
    title: 'A · กระโดดออกจากเรือแล้วเรือถอยหลัง',
    note: 'person_a + boat · jump → knockback บนเรือ',
    scene: {
      setting: 'water',
      meme_format: 'impact_caption',
      actors: [
        { id: 'A', label: 'คนกระโดด', sprite: 'person_a', x: 0.34 },
        { id: 'B', label: 'เรือ', sprite: 'boat', x: 0.66 },
      ],
      beats: [
        { actor: 'A', clip: 'idle', target: null, duration_ms: 400 },
        { actor: 'A', clip: 'jump', target: 'B', duration_ms: 900 },
        { actor: 'A', clip: 'celebrate', target: null, duration_ms: 700 },
      ],
      caption: 'กระโดดทีเดียว เรือน้อยใจถอยเลย',
    },
  },
  {
    title: 'B · Tung Tung กระโดดเตะ Cappuccina',
    note: 'สองตัวละคร · jump → kick → knockback แล้วกระเด็นคนละทาง',
    scene: {
      setting: 'street',
      meme_format: 'reaction_zoom',
      actors: [
        { id: 'A', label: 'Tung Tung', sprite: 'person_a', x: 0.22 },
        { id: 'B', label: 'Cappuccina', sprite: 'person_b', x: 0.74 },
      ],
      beats: [
        { actor: 'A', clip: 'run', target: 'B', duration_ms: 700 },
        { actor: 'A', clip: 'jump', target: null, duration_ms: 500 },
        { actor: 'A', clip: 'kick', target: 'B', duration_ms: 900 },
      ],
      caption: 'เตะแรงแค่ไหน ก็เจ็บเท่ากันทั้งคู่',
    },
  },
  {
    title: 'C · ผลักกำแพงแล้วกำแพงไม่ขยับ (เข้าใจผิด)',
    note: 'box เป็นกำแพง · push → two_panel',
    scene: {
      setting: 'classroom',
      meme_format: 'two_panel',
      actors: [
        { id: 'A', label: 'นักเรียน', sprite: 'person_b', x: 0.3 },
        { id: 'B', label: 'กำแพง', sprite: 'box', x: 0.68 },
      ],
      beats: [
        { actor: 'A', clip: 'push', target: 'B', duration_ms: 1200 },
        { actor: 'A', clip: 'sweat', target: null, duration_ms: 900 },
      ],
      caption: 'ดันจนหน้าแดง กำแพงยังนิ่ง',
    },
  },
  {
    title: 'D · จรวดพุ่งขึ้น แก๊สพุ่งลง',
    note: 'rocket · float → pop · before_after',
    scene: {
      setting: 'space',
      meme_format: 'before_after',
      actors: [
        { id: 'A', label: 'จรวด', sprite: 'rocket', x: 0.32 },
        { id: 'B', label: 'ดาว', sprite: 'ball', x: 0.74 },
      ],
      beats: [
        { actor: 'A', clip: 'float', target: null, duration_ms: 900 },
        { actor: 'A', clip: 'collide', target: 'B', duration_ms: 900 },
      ],
      caption: 'พ่นลงหนึ่งที ลอยขึ้นหนึ่งที',
    },
  },
  {
    title: 'E · แมวปาลูกบอลใส่กล่อง',
    note: 'throw → catch อัตโนมัติที่เป้าหมาย',
    scene: {
      setting: 'kitchen',
      meme_format: 'impact_caption',
      actors: [
        { id: 'A', label: 'แมว', sprite: 'cat', x: 0.24 },
        { id: 'B', label: 'ลูกบอล', sprite: 'ball', x: 0.5 },
        { id: 'C', label: 'กล่อง', sprite: 'box', x: 0.78 },
      ],
      beats: [
        { actor: 'A', clip: 'throw', target: 'B', duration_ms: 800 },
        { actor: 'B', clip: 'spin', target: null, duration_ms: 600 },
        { actor: 'B', clip: 'collide', target: 'C', duration_ms: 700 },
      ],
      caption: 'ปาไปหนึ่งที กล่องตอบกลับหนึ่งที',
    },
  },
  {
    title: 'F · ฉากสำรอง (ไม่มี AI)',
    note: 'think_bubble ตัวเดียว · void',
    scene: {
      setting: 'void',
      meme_format: 'impact_caption',
      actors: [{ id: 'A', label: '', sprite: 'person_a', x: 0.5 }],
      beats: [{ actor: 'A', clip: 'think_bubble', target: null, duration_ms: 1600 }],
      caption: 'กระโดดออกจากเรือแล้วเรือถอยหลัง',
    },
  },
];

export default function DevScenesPage() {
  const [hideCaption, setHideCaption] = useState(false);
  const [filmstrip, setFilmstrip] = useState(false);

  return (
    <main className="mx-auto grid max-w-6xl gap-5 p-6">
      <header className="chunk flex flex-wrap items-center justify-between gap-3 bg-sun p-4">
        <div>
          <h1 className="text-3xl">ตรวจฉากมีม</h1>
          <p className="text-sm font-bold text-ink/70">
            SceneSpec เขียนมือ — ใช้ตรวจ renderer โดยไม่ต้องมี ANTHROPIC_API_KEY
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="tag cursor-pointer bg-white">
            <input
              type="checkbox"
              checked={hideCaption}
              onChange={(e) => setHideCaption(e.target.checked)}
            />
            ซ่อนคำบรรยาย
          </label>
          <label className="tag cursor-pointer bg-white">
            <input
              type="checkbox"
              checked={filmstrip}
              onChange={(e) => setFilmstrip(e.target.checked)}
            />
            ฟิล์มสตริป (ไม่ใช้ rAF)
          </label>
        </div>
      </header>

      <div className={`grid gap-5 ${filmstrip ? '' : 'md:grid-cols-2'}`}>
        {SAMPLES.map((sample) => {
          const timeline = compileScene(sample.scene);
          return (
            <section key={sample.title} className="chunk overflow-hidden p-3">
              {filmstrip ? (
                <MemeFilmstrip scene={sample.scene} />
              ) : (
                <MemeStage scene={sample.scene} hideCaption={hideCaption} />
              )}
              <h2 className="mt-3 text-lg leading-tight">{sample.title}</h2>
              <p className="text-sm font-bold text-ink/60">{sample.note}</p>
              <dl className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <span className="tag bg-paper-2">{sample.scene.meme_format}</span>
                <span className="tag bg-paper-2">{sample.scene.setting}</span>
                <span className="tag bg-paper-2">{timeline.durationMs} ms</span>
                <span className="tag bg-paper-2">{timeline.segments.length} segments</span>
                <span className="tag bg-paper-2">{timeline.impacts.length} impacts</span>
              </dl>
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink/60">
                {timeline.segments
                  .filter((s) => !s.auto)
                  .map((s) => `${s.actorId}:${s.clip}@${s.startMs}`)
                  .join('  ')}
                {timeline.segments.some((s) => s.auto && s.clip !== 'idle') && (
                  <>
                    {'  ·  auto → '}
                    {timeline.segments
                      .filter((s) => s.auto && s.clip !== 'idle')
                      .map((s) => `${s.actorId}:${s.clip}@${s.startMs}`)
                      .join('  ')}
                  </>
                )}
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
