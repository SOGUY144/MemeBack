import { describe, expect, it } from 'vitest';
import { suggestPromotions, type PromotionCandidate } from '@/server/promotion';
import type { SceneSpec } from '@/lib/ai/scene-schema';
import type { ClipName, SettingName, SpriteName, Verdict } from '@/lib/meme/vocab';

function spec(opts: {
  clips: ClipName[];
  sprites?: SpriteName[];
  setting?: SettingName;
}): SceneSpec {
  const sprites = opts.sprites ?? ['person_a'];
  return {
    understood: true,
    verdict: 'correct',
    concept_note: '',
    misconception: null,
    teaching_point: '',
    matched_meme: null,
    dialogue: [],
    scene: {
      setting: opts.setting ?? 'classroom',
      meme_format: 'impact_caption',
      actors: sprites.map((s, i) => ({ id: String.fromCharCode(65 + i), label: '', sprite: s, x: 0.3 + i * 0.3 })),
      beats: opts.clips.map((clip) => ({ actor: 'A', clip, target: null, duration_ms: 500 })),
      caption: '',
    },
  };
}

const candidate = (
  answerId: string,
  verdict: Verdict,
  s: SceneSpec | null,
): PromotionCandidate => ({ answerId, verdict, spec: s });

describe('suggestPromotions', () => {
  it('returns nothing when there is nothing to show', () => {
    expect(suggestPromotions([])).toEqual([]);
    expect(suggestPromotions([candidate('a', 'correct', null)])).toEqual([]);
  });

  it('never promotes an off-topic answer', () => {
    const picked = suggestPromotions([
      candidate('a', 'off_topic', spec({ clips: ['think_bubble'] })),
      candidate('b', 'correct', spec({ clips: ['jump', 'kick'] })),
    ]);
    expect(picked).toEqual(['b']);
  });

  it('leads with a misconception — the most teachable answer in the room', () => {
    const picked = suggestPromotions([
      candidate('ok1', 'correct', spec({ clips: ['jump'] })),
      candidate('ok2', 'correct', spec({ clips: ['run', 'collide'] })),
      candidate('wrong', 'misconception', spec({ clips: ['push', 'sweat'] })),
    ]);
    expect(picked[0]).toBe('wrong');
  });

  it('collapses storyboards with an identical clip sequence', () => {
    const picked = suggestPromotions([
      candidate('a', 'correct', spec({ clips: ['jump', 'kick'] })),
      candidate('b', 'correct', spec({ clips: ['jump', 'kick'] })),
      candidate('c', 'correct', spec({ clips: ['throw', 'catch'] })),
    ]);
    expect(picked).toContain('a');
    expect(picked).not.toContain('b');
    expect(picked).toContain('c');
  });

  it('prefers the more varied correct answers', () => {
    const picked = suggestPromotions([
      candidate('flat', 'correct', spec({ clips: ['idle', 'idle'] })),
      candidate('rich', 'correct', spec({ clips: ['run', 'jump', 'kick'], sprites: ['person_a', 'person_b'] })),
    ]);
    expect(picked[0]).toBe('rich');
  });

  it('finds room for an unusual staging', () => {
    const common = Array.from({ length: 4 }, (_, i) =>
      candidate(`c${i}`, 'correct', spec({ clips: ['jump'], sprites: ['person_a'], setting: 'classroom' })),
    );
    const odd = candidate('odd', 'correct', spec({ clips: ['float'], sprites: ['rocket'], setting: 'space' }));
    expect(suggestPromotions([...common, odd])).toContain('odd');
  });

  it('never puts more than five on the projector', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      candidate(`a${i}`, 'correct', spec({ clips: ['jump', 'kick', `${i % 2 ? 'run' : 'walk'}` as ClipName] })),
    );
    const picked = suggestPromotions(many);
    expect(picked.length).toBeLessThanOrEqual(5);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('does not collapse every fallback scene into one meme (no API key case)', () => {
    const answers: PromotionCandidate[] = ['a', 'b', 'c'].map((id) => ({
      answerId: id,
      verdict: 'partial',
      spec: spec({ clips: ['think_bubble'], setting: 'void' }),
    }));
    const picked = suggestPromotions(answers);
    expect(picked).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('still collapses identical non-fallback storyboards', () => {
    const picked = suggestPromotions([
      candidate('a', 'correct', spec({ clips: ['think_bubble'], setting: 'classroom' })),
      candidate('b', 'correct', spec({ clips: ['think_bubble'], setting: 'classroom' })),
    ]);
    expect(picked.length).toBe(1);
  });

  it('still gives a small class a round to play', () => {
    expect(suggestPromotions([candidate('only', 'partial', spec({ clips: ['sweat'] }))])).toEqual([
      'only',
    ]);
  });
});
