import { describe, expect, it } from 'vitest';
import { compileScene, segmentAt, type CompileInput } from '@/lib/meme/compile';

const base = (over: Partial<CompileInput>): CompileInput => ({
  setting: 'void',
  meme_format: 'impact_caption',
  caption: 'ทดสอบ',
  actors: [
    { id: 'A', label: 'เอ', sprite: 'person_a', x: 0.25 },
    { id: 'B', label: 'บี', sprite: 'person_b', x: 0.75 },
  ],
  beats: [],
  ...over,
});

const authored = (t: ReturnType<typeof compileScene>) => t.segments.filter((s) => !s.auto);

describe('compileScene — beat to absolute time', () => {
  it('runs beats of the same actor back to back', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'walk', target: null, duration_ms: 500 },
          { actor: 'A', clip: 'jump', target: null, duration_ms: 700 },
          { actor: 'A', clip: 'celebrate', target: null, duration_ms: 400 },
        ],
      }),
    );

    expect(authored(t).map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 500],
      [500, 1200],
      [1200, 1600],
    ]);
    expect(t.durationMs).toBe(1600);
  });

  it('starts a new actor in parallel with the beat before it', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'walk', target: null, duration_ms: 600 },
          { actor: 'B', clip: 'shake', target: null, duration_ms: 400 },
          { actor: 'B', clip: 'idle', target: null, duration_ms: 300 },
        ],
      }),
    );

    const segs = authored(t);
    expect(segs.find((s) => s.actorId === 'A')!.startMs).toBe(0);
    // B has never acted, so it joins at the previous beat's start → parallel
    expect(segs.filter((s) => s.actorId === 'B').map((s) => s.startMs)).toEqual([0, 400]);
  });

  it('never leaves an actor unposed', () => {
    const t = compileScene(
      base({
        beats: [{ actor: 'A', clip: 'jump', target: null, duration_ms: 800 }],
      }),
    );

    for (const ms of [0, 400, 799, 1000, t.durationMs - 1]) {
      expect(segmentAt(t, 'A', ms), `A at ${ms}`).not.toBeNull();
      expect(segmentAt(t, 'B', ms), `B at ${ms}`).not.toBeNull();
    }
    expect(t.durationMs).toBeGreaterThanOrEqual(1200);
  });

  it('clamps out-of-range beat durations instead of failing', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'idle', target: null, duration_ms: 5 },
          { actor: 'A', clip: 'idle', target: null, duration_ms: 99999 },
        ],
      }),
    );
    expect(authored(t).map((s) => s.endMs - s.startMs)).toEqual([200, 2000]);
  });
});

describe('compileScene — clip resolution', () => {
  it('maps known synonyms onto real clips', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'hit', target: null, duration_ms: 400 },
          { actor: 'A', clip: 'crash', target: null, duration_ms: 400 },
          { actor: 'A', clip: 'explode', target: null, duration_ms: 400 },
          { actor: 'A', clip: 'vibrate', target: null, duration_ms: 400 },
          { actor: 'A', clip: 'drop', target: null, duration_ms: 400 },
        ],
      }),
    );
    expect(authored(t).map((s) => s.clip)).toEqual(['punch', 'collide', 'pop', 'shake', 'fall']);
  });

  it('is case and separator insensitive', () => {
    const t = compileScene(
      base({ beats: [{ actor: 'A', clip: 'Think Bubble', target: null, duration_ms: 400 }] }),
    );
    expect(authored(t)[0]!.clip).toBe('think_bubble');
  });

  it('falls back to shake for an invented clip', () => {
    const t = compileScene(
      base({ beats: [{ actor: 'A', clip: 'teleport_through_wall', target: null, duration_ms: 400 }] }),
    );
    expect(authored(t)[0]!.clip).toBe('shake');
  });

  it('reroutes a beat naming an actor that does not exist', () => {
    const t = compileScene(
      base({ beats: [{ actor: 'Z', clip: 'jump', target: null, duration_ms: 400 }] }),
    );
    expect(authored(t)[0]!.actorId).toBe('A');
  });
});

describe('compileScene — target reactions', () => {
  it('inserts knockback on the target at the moment of impact', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'jump', target: null, duration_ms: 600 },
          { actor: 'A', clip: 'kick', target: 'B', duration_ms: 800 },
        ],
      }),
    );

    const kick = authored(t).find((s) => s.clip === 'kick')!;
    expect(kick.impactMs).toBe(600 + 800 * 0.55);

    const reaction = t.segments.find((s) => s.auto && s.clip === 'knockback');
    expect(reaction).toBeDefined();
    expect(reaction!.actorId).toBe('B');
    expect(reaction!.startMs).toBe(kick.impactMs);
  });

  it('drives the two actors apart', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'jump', target: null, duration_ms: 500 },
          { actor: 'A', clip: 'kick', target: 'B', duration_ms: 700 },
        ],
      }),
    );

    const kick = t.segments.find((s) => s.clip === 'kick')!;
    const knock = t.segments.find((s) => s.clip === 'knockback')!;
    // A came from the left and moved right; B was on the right and got pushed further right
    expect(kick.toX).toBeGreaterThan(kick.fromX);
    expect(knock.toX).toBeGreaterThan(knock.fromX);
    expect(knock.fromX).toBeGreaterThan(kick.toX);
  });

  it('pushes the target backwards for push, and hands the ball over for throw', () => {
    const pushed = compileScene(
      base({ beats: [{ actor: 'A', clip: 'push', target: 'B', duration_ms: 900 }] }),
    );
    expect(pushed.segments.find((s) => s.auto && s.clip === 'walk')).toBeDefined();

    const thrown = compileScene(
      base({ beats: [{ actor: 'A', clip: 'throw', target: 'B', duration_ms: 900 }] }),
    );
    expect(thrown.segments.find((s) => s.auto && s.clip === 'catch')).toBeDefined();
  });

  it('does not insert a reaction when the storyboard already posed the target', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'B', clip: 'fall', target: null, duration_ms: 2000 },
          { actor: 'A', clip: 'kick', target: 'B', duration_ms: 800 },
        ],
      }),
    );
    expect(t.segments.filter((s) => s.auto && s.clip === 'knockback')).toHaveLength(0);
  });

  it('ignores a target that is the actor itself or unknown', () => {
    const self = compileScene(
      base({ beats: [{ actor: 'A', clip: 'kick', target: 'A', duration_ms: 600 }] }),
    );
    const ghost = compileScene(
      base({ beats: [{ actor: 'A', clip: 'kick', target: 'Q', duration_ms: 600 }] }),
    );
    expect(self.segments.filter((s) => s.auto && s.clip === 'knockback')).toHaveLength(0);
    expect(ghost.segments.filter((s) => s.auto && s.clip === 'knockback')).toHaveLength(0);
  });

  it('records impact events for impact clips', () => {
    const t = compileScene(
      base({
        beats: [
          { actor: 'A', clip: 'punch', target: 'B', duration_ms: 600 },
          { actor: 'A', clip: 'pop', target: null, duration_ms: 400 },
        ],
      }),
    );
    expect(t.impacts.map((i) => i.clip)).toEqual(['punch', 'pop']);
    expect(t.impacts[0]!.targetId).toBe('B');
    expect(t.impacts.every((i) => i.tMs >= 0 && i.tMs <= t.durationMs)).toBe(true);
  });
});

describe('compileScene — staging', () => {
  it('keeps every actor inside the frame', () => {
    const t = compileScene(
      base({
        actors: [{ id: 'A', label: 'เอ', sprite: 'car', x: 0.9 }],
        beats: [
          { actor: 'A', clip: 'run', target: null, duration_ms: 900 },
          { actor: 'A', clip: 'run', target: null, duration_ms: 900 },
          { actor: 'A', clip: 'run', target: null, duration_ms: 900 },
        ],
      }),
    );
    for (const s of t.segments) {
      expect(s.fromX).toBeGreaterThanOrEqual(0.08);
      expect(s.toX).toBeLessThanOrEqual(0.92);
    }
  });

  it('spreads actors out when the storyboard stacks them', () => {
    const t = compileScene(
      base({
        actors: [
          { id: 'A', label: '', sprite: 'person_a', x: 0 },
          { id: 'B', label: '', sprite: 'boat', x: 0 },
        ],
        beats: [{ actor: 'A', clip: 'idle', target: null, duration_ms: 400 }],
      }),
    );
    expect(t.actors[0]!.x).not.toBe(t.actors[1]!.x);
  });
});
