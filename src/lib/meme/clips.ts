import type { ClipName, PartName } from '@/lib/meme/vocab';

/**
 * Clips are keyframe transforms, not sprite sheets.
 *
 * Every value in `keys` is a *delta from the sprite's rest pose*, in sprite
 * units (a sprite is ~100 units tall, +y is down, matching Pixi). `t` is
 * normalized 0..1 across the beat's duration, so the same clip stretches to fit
 * whatever duration the storyboard asked for.
 *
 * `root` is a pseudo-part meaning "the whole actor". Object sprites only have a
 * `body` part, so the renderer aliases torso/head onto it and drops limb tracks —
 * that is why every clip drives `root` for its readable motion and uses limbs
 * only for flavour.
 */

export type TrackPart = PartName | 'root';

export type Key = {
  t: number;
  x?: number;
  y?: number;
  rot?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
};

export type Track = { part: TrackPart; keys: Key[] };

export type Clip = {
  tracks: Track[];
  /** Travel across the scene, as a fraction of scene width/height. Signed by
   *  the compiler: +dx always means "toward the target / facing direction". */
  rootMotion?: { dx: number; dy: number };
  /** 0..1 — the moment the hit lands. Drives screen shake, flash, radial lines
   *  and the target's auto-inserted reaction. */
  impact?: number;
};

const D = Math.PI / 180;

export const CLIPS_LIB: Record<ClipName, Clip> = {
  idle: {
    tracks: [
      { part: 'root', keys: [{ t: 0, y: 0 }, { t: 0.5, y: -2 }, { t: 1, y: 0 }] },
      { part: 'head', keys: [{ t: 0, rot: 0 }, { t: 0.5, rot: 2 * D }, { t: 1, rot: 0 }] },
    ],
  },

  walk: {
    rootMotion: { dx: 0.18, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0 },
          { t: 0.25, y: -3 },
          { t: 0.5, y: 0 },
          { t: 0.75, y: -3 },
          { t: 1, y: 0 },
        ],
      },
      {
        part: 'leg_r',
        keys: [
          { t: 0, rot: -22 * D },
          { t: 0.5, rot: 22 * D },
          { t: 1, rot: -22 * D },
        ],
      },
      {
        part: 'leg_l',
        keys: [
          { t: 0, rot: 22 * D },
          { t: 0.5, rot: -22 * D },
          { t: 1, rot: 22 * D },
        ],
      },
      {
        part: 'arm_r',
        keys: [
          { t: 0, rot: 18 * D },
          { t: 0.5, rot: -18 * D },
          { t: 1, rot: 18 * D },
        ],
      },
      {
        part: 'arm_l',
        keys: [
          { t: 0, rot: -18 * D },
          { t: 0.5, rot: 18 * D },
          { t: 1, rot: -18 * D },
        ],
      },
    ],
  },

  run: {
    rootMotion: { dx: 0.34, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0 },
          { t: 0.25, y: -7 },
          { t: 0.5, y: 0 },
          { t: 0.75, y: -7 },
          { t: 1, y: 0 },
        ],
      },
      { part: 'torso', keys: [{ t: 0, rot: 14 * D }, { t: 1, rot: 14 * D }] },
      {
        part: 'leg_r',
        keys: [
          { t: 0, rot: -50 * D },
          { t: 0.5, rot: 50 * D },
          { t: 1, rot: -50 * D },
        ],
      },
      {
        part: 'leg_l',
        keys: [
          { t: 0, rot: 50 * D },
          { t: 0.5, rot: -50 * D },
          { t: 1, rot: 50 * D },
        ],
      },
      {
        part: 'arm_r',
        keys: [
          { t: 0, rot: 55 * D },
          { t: 0.5, rot: -55 * D },
          { t: 1, rot: 55 * D },
        ],
      },
      {
        part: 'arm_l',
        keys: [
          { t: 0, rot: -55 * D },
          { t: 0.5, rot: 55 * D },
          { t: 1, rot: -55 * D },
        ],
      },
    ],
  },

  jump: {
    rootMotion: { dx: 0.07, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0, scaleY: 1 },
          { t: 0.15, y: 6, scaleY: 0.82 },
          { t: 0.45, y: -52, scaleY: 1.08 },
          { t: 0.75, y: -52, scaleY: 1.08 },
          { t: 0.94, y: 4, scaleY: 0.88 },
          { t: 1, y: 0, scaleY: 1 },
        ],
      },
      {
        part: 'leg_r',
        keys: [{ t: 0, rot: 0 }, { t: 0.45, rot: -40 * D }, { t: 1, rot: 0 }],
      },
      {
        part: 'leg_l',
        keys: [{ t: 0, rot: 0 }, { t: 0.45, rot: -25 * D }, { t: 1, rot: 0 }],
      },
      {
        part: 'arm_r',
        keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: -150 * D }, { t: 1, rot: 0 }],
      },
      {
        part: 'arm_l',
        keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: 150 * D }, { t: 1, rot: 0 }],
      },
    ],
  },

  kick: {
    impact: 0.55,
    rootMotion: { dx: 0.1, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [{ t: 0, y: 0 }, { t: 0.4, y: -8 }, { t: 0.55, y: -6 }, { t: 1, y: 0 }],
      },
      { part: 'torso', keys: [{ t: 0, rot: 0 }, { t: 0.5, rot: -22 * D }, { t: 1, rot: 0 }] },
      {
        part: 'leg_r',
        keys: [
          { t: 0, rot: 0 },
          { t: 0.35, rot: 35 * D },
          { t: 0.55, rot: -95 * D },
          { t: 0.75, rot: -80 * D },
          { t: 1, rot: 0 },
        ],
      },
      { part: 'arm_l', keys: [{ t: 0, rot: 0 }, { t: 0.55, rot: 70 * D }, { t: 1, rot: 0 }] },
    ],
  },

  punch: {
    impact: 0.5,
    rootMotion: { dx: 0.06, dy: 0 },
    tracks: [
      { part: 'root', keys: [{ t: 0, x: 0 }, { t: 0.3, x: -6 }, { t: 0.5, x: 10 }, { t: 1, x: 0 }] },
      { part: 'torso', keys: [{ t: 0, rot: 0 }, { t: 0.3, rot: -12 * D }, { t: 0.5, rot: 14 * D }, { t: 1, rot: 0 }] },
      {
        part: 'arm_r',
        keys: [
          { t: 0, rot: 0, scaleX: 1 },
          { t: 0.3, rot: 40 * D, scaleX: 0.9 },
          { t: 0.5, rot: -88 * D, scaleX: 1.35 },
          { t: 0.7, rot: -80 * D, scaleX: 1.2 },
          { t: 1, rot: 0, scaleX: 1 },
        ],
      },
    ],
  },

  push: {
    impact: 0.45,
    rootMotion: { dx: 0.15, dy: 0 },
    tracks: [
      { part: 'torso', keys: [{ t: 0, rot: 0 }, { t: 0.45, rot: 20 * D }, { t: 1, rot: 12 * D }] },
      {
        part: 'arm_r',
        keys: [{ t: 0, rot: -30 * D }, { t: 0.45, rot: -85 * D }, { t: 1, rot: -85 * D }],
      },
      {
        part: 'arm_l',
        keys: [{ t: 0, rot: 30 * D }, { t: 0.45, rot: -85 * D }, { t: 1, rot: -85 * D }],
      },
      {
        part: 'leg_r',
        keys: [{ t: 0, rot: 0 }, { t: 0.5, rot: 26 * D }, { t: 1, rot: 26 * D }],
      },
    ],
  },

  pull: {
    rootMotion: { dx: -0.13, dy: 0 },
    tracks: [
      { part: 'torso', keys: [{ t: 0, rot: 14 * D }, { t: 0.6, rot: -18 * D }, { t: 1, rot: -14 * D }] },
      {
        part: 'arm_r',
        keys: [{ t: 0, rot: -85 * D }, { t: 0.6, rot: -20 * D }, { t: 1, rot: -25 * D }],
      },
      {
        part: 'arm_l',
        keys: [{ t: 0, rot: -85 * D }, { t: 0.6, rot: 20 * D }, { t: 1, rot: 25 * D }],
      },
      { part: 'leg_l', keys: [{ t: 0, rot: 0 }, { t: 0.6, rot: -24 * D }, { t: 1, rot: -20 * D }] },
    ],
  },

  collide: {
    impact: 0.5,
    rootMotion: { dx: 0.24, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, x: 0, rot: 0 },
          { t: 0.5, x: 0, rot: 8 * D },
          { t: 0.58, x: -12, rot: -10 * D },
          { t: 0.72, x: 6, rot: 6 * D },
          { t: 1, x: 0, rot: 0 },
        ],
      },
      { part: 'torso', keys: [{ t: 0, rot: 16 * D }, { t: 0.5, rot: 16 * D }, { t: 1, rot: 0 }] },
    ],
  },

  knockback: {
    rootMotion: { dx: 0.22, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0, rot: 0 },
          { t: 0.2, y: -22, rot: -26 * D },
          { t: 0.6, y: -14, rot: -46 * D },
          { t: 0.85, y: 0, rot: -20 * D },
          { t: 1, y: 0, rot: 0 },
        ],
      },
      { part: 'arm_r', keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: -120 * D }, { t: 1, rot: -20 * D }] },
      { part: 'arm_l', keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: 120 * D }, { t: 1, rot: 20 * D }] },
      { part: 'leg_r', keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: -55 * D }, { t: 1, rot: 0 }] },
    ],
  },

  fall: {
    rootMotion: { dx: 0.04, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, rot: 0, y: 0 },
          { t: 0.35, rot: -30 * D, y: -6 },
          { t: 0.8, rot: -88 * D, y: 24 },
          { t: 0.92, rot: -84 * D, y: 20 },
          { t: 1, rot: -88 * D, y: 24 },
        ],
      },
      { part: 'arm_l', keys: [{ t: 0, rot: 0 }, { t: 0.5, rot: 100 * D }, { t: 1, rot: 60 * D }] },
    ],
  },

  bounce: {
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0, scaleY: 1, scaleX: 1 },
          { t: 0.1, y: 4, scaleY: 0.78, scaleX: 1.22 },
          { t: 0.35, y: -46, scaleY: 1.12, scaleX: 0.9 },
          { t: 0.55, y: 3, scaleY: 0.84, scaleX: 1.16 },
          { t: 0.78, y: -20, scaleY: 1.05, scaleX: 0.95 },
          { t: 1, y: 0, scaleY: 1, scaleX: 1 },
        ],
      },
    ],
  },

  shake: {
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, x: 0 },
          { t: 0.12, x: -7 },
          { t: 0.25, x: 7 },
          { t: 0.38, x: -5 },
          { t: 0.5, x: 5 },
          { t: 0.63, x: -4 },
          { t: 0.76, x: 4 },
          { t: 0.88, x: -2 },
          { t: 1, x: 0 },
        ],
      },
    ],
  },

  spin: {
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, rot: 0, y: 0 },
          { t: 0.5, rot: Math.PI, y: -14 },
          { t: 1, rot: Math.PI * 2, y: 0 },
        ],
      },
    ],
  },

  throw: {
    impact: 0.5,
    tracks: [
      { part: 'torso', keys: [{ t: 0, rot: 0 }, { t: 0.35, rot: -20 * D }, { t: 0.55, rot: 18 * D }, { t: 1, rot: 0 }] },
      {
        part: 'arm_r',
        keys: [
          { t: 0, rot: 0 },
          { t: 0.35, rot: 130 * D },
          { t: 0.55, rot: -110 * D },
          { t: 1, rot: -20 * D },
        ],
      },
      { part: 'root', keys: [{ t: 0, x: 0 }, { t: 0.35, x: -5 }, { t: 0.55, x: 7 }, { t: 1, x: 0 }] },
    ],
  },

  catch: {
    tracks: [
      { part: 'root', keys: [{ t: 0, y: 0 }, { t: 0.4, y: -16 }, { t: 0.7, y: 4 }, { t: 1, y: 0 }] },
      { part: 'arm_r', keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: -120 * D }, { t: 0.75, rot: -70 * D }, { t: 1, rot: -60 * D }] },
      { part: 'arm_l', keys: [{ t: 0, rot: 0 }, { t: 0.4, rot: 120 * D }, { t: 0.75, rot: 70 * D }, { t: 1, rot: 60 * D }] },
    ],
  },

  float: {
    rootMotion: { dx: 0.05, dy: 0 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: -18, rot: -3 * D },
          { t: 0.25, y: -30, rot: 3 * D },
          { t: 0.5, y: -18, rot: 3 * D },
          { t: 0.75, y: -30, rot: -3 * D },
          { t: 1, y: -18, rot: -3 * D },
        ],
      },
    ],
  },

  sink: {
    rootMotion: { dx: 0, dy: 0.1 },
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0, rot: 0 },
          { t: 0.5, y: 16, rot: 8 * D },
          { t: 1, y: 34, rot: -6 * D },
        ],
      },
      { part: 'arm_l', keys: [{ t: 0, rot: 0 }, { t: 0.6, rot: 150 * D }, { t: 1, rot: 160 * D }] },
      { part: 'arm_r', keys: [{ t: 0, rot: 0 }, { t: 0.6, rot: -150 * D }, { t: 1, rot: -160 * D }] },
    ],
  },

  pop: {
    impact: 0.4,
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, scale: 1 },
          { t: 0.3, scale: 1.3 },
          { t: 0.4, scale: 1.75 },
          { t: 0.55, scale: 0.15 },
          { t: 1, scale: 0.15 },
        ],
      },
    ],
  },

  point: {
    tracks: [
      { part: 'arm_r', keys: [{ t: 0, rot: 0 }, { t: 0.3, rot: -78 * D }, { t: 1, rot: -78 * D }] },
      { part: 'torso', keys: [{ t: 0, rot: 0 }, { t: 0.3, rot: 6 * D }, { t: 1, rot: 6 * D }] },
      { part: 'head', keys: [{ t: 0, rot: 0 }, { t: 0.3, rot: 8 * D }, { t: 1, rot: 8 * D }] },
    ],
  },

  think_bubble: {
    tracks: [
      { part: 'root', keys: [{ t: 0, y: 0 }, { t: 0.5, y: -3 }, { t: 1, y: 0 }] },
      {
        part: 'head',
        keys: [{ t: 0, rot: 0 }, { t: 0.35, rot: -11 * D }, { t: 0.8, rot: -8 * D }, { t: 1, rot: -11 * D }],
      },
      { part: 'arm_r', keys: [{ t: 0, rot: 0 }, { t: 0.35, rot: -140 * D }, { t: 1, rot: -140 * D }] },
    ],
  },

  sweat: {
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, x: 0 },
          { t: 0.2, x: -3 },
          { t: 0.4, x: 3 },
          { t: 0.6, x: -3 },
          { t: 0.8, x: 3 },
          { t: 1, x: 0 },
        ],
      },
      { part: 'head', keys: [{ t: 0, rot: 0 }, { t: 0.5, rot: 10 * D }, { t: 1, rot: 0 }] },
      { part: 'arm_l', keys: [{ t: 0, rot: 0 }, { t: 0.5, rot: 40 * D }, { t: 1, rot: 20 * D }] },
    ],
  },

  celebrate: {
    tracks: [
      {
        part: 'root',
        keys: [
          { t: 0, y: 0 },
          { t: 0.25, y: -26 },
          { t: 0.5, y: 0 },
          { t: 0.75, y: -26 },
          { t: 1, y: 0 },
        ],
      },
      { part: 'arm_r', keys: [{ t: 0, rot: -150 * D }, { t: 0.5, rot: -170 * D }, { t: 1, rot: -150 * D }] },
      { part: 'arm_l', keys: [{ t: 0, rot: 150 * D }, { t: 0.5, rot: 170 * D }, { t: 1, rot: 150 * D }] },
      { part: 'head', keys: [{ t: 0, rot: -6 * D }, { t: 0.5, rot: 6 * D }, { t: 1, rot: -6 * D }] },
    ],
  },
};

/** Clips that fire a shake + flash + radial-line burst and knock their target back. */
export const IMPACT_CLIPS: ReadonlySet<ClipName> = new Set([
  'collide',
  'kick',
  'punch',
  'push',
  'pop',
]);

/** Which reaction the target of a beat performs when the hit lands. */
export const TARGET_REACTION: Partial<Record<ClipName, ClipName>> = {
  kick: 'knockback',
  punch: 'knockback',
  collide: 'knockback',
  push: 'walk', // walked backwards — the compiler flips its direction
  pull: 'walk',
  throw: 'catch',
  pop: 'shake',
};

export function getClip(name: ClipName): Clip {
  return CLIPS_LIB[name];
}

/** Sample a track at normalized time `t`, linearly interpolating between keys. */
export function sampleTrack(keys: readonly Key[], t: number): Required<Omit<Key, 't'>> {
  const rest = { x: 0, y: 0, rot: 0, scale: 1, scaleX: 1, scaleY: 1 };
  if (keys.length === 0) return rest;

  const clamped = Math.min(1, Math.max(0, t));
  let a = keys[0]!;
  let b = keys[keys.length - 1]!;
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i]!;
    const k1 = keys[i + 1]!;
    if (clamped >= k0.t && clamped <= k1.t) {
      a = k0;
      b = k1;
      break;
    }
  }
  if (clamped <= keys[0]!.t) a = b = keys[0]!;
  if (clamped >= keys[keys.length - 1]!.t) a = b = keys[keys.length - 1]!;

  const span = b.t - a.t;
  const raw = span <= 0 ? 0 : (clamped - a.t) / span;
  // ease-in-out keeps keyframed poses from looking robotic
  const u = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;

  const lerp = (k: keyof Omit<Key, 't'>, fallback: number) => {
    const av = a[k] ?? fallback;
    const bv = b[k] ?? fallback;
    return av + (bv - av) * u;
  };

  return {
    x: lerp('x', 0),
    y: lerp('y', 0),
    rot: lerp('rot', 0),
    scale: lerp('scale', 1),
    scaleX: lerp('scaleX', 1),
    scaleY: lerp('scaleY', 1),
  };
}
