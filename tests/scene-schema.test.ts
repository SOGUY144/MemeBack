import { describe, expect, it } from 'vitest';
import { DISTRACTORS, SceneSpec, fallbackScene } from '@/lib/ai/scene-schema';

const valid = () => ({
  understood: true,
  verdict: 'correct',
  concept_note: 'ตอบถูก เพราะแรงกิริยาและแรงปฏิกิริยาเกิดพร้อมกัน',
  misconception: null,
  teaching_point: 'ใช้เป็นตัวอย่างแรงคู่ปฏิกิริยาได้เลย',
  scene: {
    setting: 'water',
    meme_format: 'impact_caption',
    actors: [
      { id: 'A', label: 'คน', sprite: 'person_a', x: 0.35 },
      { id: 'B', label: 'เรือ', sprite: 'boat', x: 0.7 },
    ],
    beats: [
      { actor: 'A', clip: 'jump', target: 'B', duration_ms: 800 },
      { actor: 'B', clip: 'knockback', target: null, duration_ms: 700 },
    ],
    caption: 'กระโดดทีเดียว เรือน้อยใจถอยเลย',
  },
});

const parse = (mutate: (o: any) => void) => {
  const o = valid();
  mutate(o);
  return SceneSpec.safeParse(o);
};

describe('SceneSpec — accepts good output', () => {
  it('parses a well-formed storyboard', () => {
    const r = SceneSpec.safeParse(valid());
    expect(r.success).toBe(true);
    expect(r.success && r.data.scene.beats[0]!.clip).toBe('jump');
  });

  it('normalises a missing target to null', () => {
    const r = parse((o) => delete o.scene.beats[0].target);
    expect(r.success).toBe(true);
    expect(r.success && r.data.scene.beats[0]!.target).toBeNull();
  });

  it('coerces a near-miss clip name rather than throwing the scene away', () => {
    const r = parse((o) => {
      o.scene.beats[0].clip = 'hit';
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.scene.beats[0]!.clip).toBe('punch');
  });

  it('coerces an invented clip name to the fallback', () => {
    const r = parse((o) => {
      o.scene.beats[0].clip = 'summon_meteor';
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.scene.beats[0]!.clip).toBe('shake');
  });
});

describe('SceneSpec — rejects malformed output', () => {
  it('rejects an unknown verdict', () => {
    expect(parse((o) => (o.verdict = 'brilliant')).success).toBe(false);
  });

  it('rejects an unknown sprite', () => {
    expect(parse((o) => (o.scene.actors[0].sprite = 'dragon')).success).toBe(false);
  });

  it('rejects an unknown setting', () => {
    expect(parse((o) => (o.scene.setting = 'volcano')).success).toBe(false);
  });

  it('rejects an unknown meme format', () => {
    expect(parse((o) => (o.scene.meme_format = 'deep_fried')).success).toBe(false);
  });

  it('rejects zero actors and more than three', () => {
    expect(parse((o) => (o.scene.actors = [])).success).toBe(false);
    expect(
      parse((o) => {
        o.scene.actors = Array.from({ length: 4 }, (_, i) => ({
          id: `A${i}`,
          label: 'x',
          sprite: 'ball',
          x: 0.5,
        }));
      }).success,
    ).toBe(false);
  });

  it('rejects zero beats and more than six', () => {
    expect(parse((o) => (o.scene.beats = [])).success).toBe(false);
    expect(
      parse((o) => {
        o.scene.beats = Array.from({ length: 7 }, () => ({
          actor: 'A',
          clip: 'idle',
          target: null,
          duration_ms: 300,
        }));
      }).success,
    ).toBe(false);
  });

  it('rejects out-of-range beat durations', () => {
    expect(parse((o) => (o.scene.beats[0].duration_ms = 50)).success).toBe(false);
    expect(parse((o) => (o.scene.beats[0].duration_ms = 9000)).success).toBe(false);
  });

  it('rejects an out-of-range actor position', () => {
    expect(parse((o) => (o.scene.actors[0].x = 1.4)).success).toBe(false);
    expect(parse((o) => (o.scene.actors[0].x = -0.2)).success).toBe(false);
  });

  it('rejects an over-long caption or concept note', () => {
    expect(parse((o) => (o.scene.caption = 'ก'.repeat(71))).success).toBe(false);
    expect(parse((o) => (o.concept_note = 'ก'.repeat(161))).success).toBe(false);
    expect(parse((o) => (o.teaching_point = 'ก'.repeat(201))).success).toBe(false);
  });

  it('rejects a missing scene, and prose instead of JSON', () => {
    expect(parse((o) => delete o.scene).success).toBe(false);
    expect(SceneSpec.safeParse('Here is your storyboard!').success).toBe(false);
    expect(SceneSpec.safeParse(null).success).toBe(false);
  });

  it('rejects wrong scalar types', () => {
    expect(parse((o) => (o.understood = 'yes')).success).toBe(false);
    expect(parse((o) => (o.scene.beats[0].duration_ms = '800')).success).toBe(false);
  });
});

describe('distractors', () => {
  it('requires exactly three', () => {
    expect(DISTRACTORS.safeParse(['a', 'b', 'c']).success).toBe(true);
    expect(DISTRACTORS.safeParse(['a', 'b']).success).toBe(false);
    expect(DISTRACTORS.safeParse(['a', 'b', 'c', 'd']).success).toBe(false);
    expect(DISTRACTORS.safeParse(['a', 'b', '']).success).toBe(false);
  });
});

describe('fallbackScene', () => {
  it('is itself a valid SceneSpec', () => {
    expect(SceneSpec.safeParse(fallbackScene('กระโดดออกจากเรือ')).success).toBe(true);
  });

  it('quotes the student rather than inventing content', () => {
    const s = fallbackScene('  กระโดดออกจากเรือแล้วเรือถอยหลัง  ');
    expect(s.scene.caption).toBe('กระโดดออกจากเรือแล้วเรือถอยหลัง');
    expect(s.scene.beats[0]!.clip).toBe('think_bubble');
    expect(s.scene.actors).toHaveLength(1);
  });

  it('survives an empty answer', () => {
    expect(fallbackScene('   ').scene.caption).toBe('...');
  });
});
