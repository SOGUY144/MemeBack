import type { SpriteName } from '@/lib/meme/vocab';

/**
 * Every sprite is drawn here as layered inline SVG. There is no art pipeline and
 * no image files — the renderer turns these strings into textures at runtime.
 *
 * Two rigs exist:
 *   - `humanoid`: head / torso / arm_l / arm_r / leg_l / leg_r, assembled into a
 *     hierarchy so rotating the torso carries the head and arms with it.
 *   - `object`: a single `body` part. Clip tracks aimed at torso or head are
 *     aliased onto it and limb tracks are dropped.
 *
 * Units: a humanoid is 100 tall, origin at the feet, -y is up.
 */

const INK = '#111318';
const SW = 5;

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

export type HumanoidRig = {
  kind: 'humanoid';
  height: number;
  hipY: number; // distance from the feet up to the hip joint
  shoulderY: number; // from the hip up to the shoulder
  headY: number; // from the hip up to the neck
  legW: number;
  legH: number;
  legOffsetX: number;
  armW: number;
  armH: number;
  armOffsetX: number;
  torsoW: number;
  torsoH: number;
  headW: number;
  headH: number;
  /** Sideways offset of the head from the spine — non-zero for four-legged rigs. */
  headOffsetX?: number;
  parts: { head: string; torso: string; arm_l: string; arm_r: string; leg_l: string; leg_r: string };
};

export type ObjectRig = {
  kind: 'object';
  width: number;
  height: number;
  /** How far the body's centre sits above the ground line. */
  restY: number;
  parts: { body: string };
};

export type Rig = HumanoidRig | ObjectRig;

// ---------------------------------------------------------------------------
// humanoid part builders
// ---------------------------------------------------------------------------

const limb = (w: number, h: number, fill: string) =>
  svg(w, h, `<rect x="${SW / 2}" y="${SW / 2}" width="${w - SW}" height="${h - SW}" rx="${(w - SW) / 2}"
      fill="${fill}" stroke="${INK}" stroke-width="${SW}"/>`);

const torsoShape = (w: number, h: number, fill: string, accent: string) =>
  svg(
    w,
    h,
    `<path d="M ${w * 0.18} ${SW} H ${w * 0.82} L ${w - SW / 2} ${h * 0.32} V ${h - SW / 2} H ${SW / 2} V ${h * 0.32} Z"
        fill="${fill}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>
     <path d="M ${w * 0.5} ${SW} L ${w * 0.36} ${h * 0.42} L ${w * 0.5} ${h * 0.56} L ${w * 0.64} ${h * 0.42} Z"
        fill="${accent}" stroke="${INK}" stroke-width="${SW * 0.7}" stroke-linejoin="round"/>`,
  );

const humanHead = (w: number, h: number, skin: string, hair: string) =>
  svg(
    w,
    h,
    `<rect x="${SW / 2}" y="${SW / 2}" width="${w - SW}" height="${h - SW}" rx="${w * 0.34}"
        fill="${skin}" stroke="${INK}" stroke-width="${SW}"/>
     <path d="M ${SW / 2} ${h * 0.34} Q ${w * 0.5} ${-h * 0.06} ${w - SW / 2} ${h * 0.34}
        L ${w - SW / 2} ${h * 0.26} Q ${w * 0.5} ${h * 0.02} ${SW / 2} ${h * 0.26} Z"
        fill="${hair}" stroke="${INK}" stroke-width="${SW * 0.8}" stroke-linejoin="round"/>
     <circle cx="${w * 0.34}" cy="${h * 0.55}" r="${w * 0.075}" fill="${INK}"/>
     <circle cx="${w * 0.66}" cy="${h * 0.55}" r="${w * 0.075}" fill="${INK}"/>
     <path d="M ${w * 0.34} ${h * 0.76} Q ${w * 0.5} ${h * 0.9} ${w * 0.66} ${h * 0.76}"
        fill="none" stroke="${INK}" stroke-width="${SW * 0.8}" stroke-linecap="round"/>`,
  );

function humanoid(opts: {
  skin: string;
  hair: string;
  shirt: string;
  accent: string;
  pants: string;
}): HumanoidRig {
  return {
    kind: 'humanoid',
    height: 100,
    hipY: 36,
    shoulderY: 30,
    headY: 38,
    legW: 15,
    legH: 38,
    legOffsetX: 8,
    armW: 12,
    armH: 34,
    armOffsetX: 19,
    torsoW: 42,
    torsoH: 38,
    headW: 34,
    headH: 34,
    parts: {
      head: humanHead(34, 34, opts.skin, opts.hair),
      torso: torsoShape(42, 38, opts.shirt, opts.accent),
      arm_l: limb(12, 34, opts.shirt),
      arm_r: limb(12, 34, opts.shirt),
      leg_l: limb(15, 38, opts.pants),
      leg_r: limb(15, 38, opts.pants),
    },
  };
}

// ---------------------------------------------------------------------------
// the eight sprites
// ---------------------------------------------------------------------------

const person_a = humanoid({
  skin: '#FFCFA3',
  hair: '#2B2118',
  shirt: '#FF6B35',
  accent: '#FFD93D',
  pants: '#2B3A67',
});

const person_b = humanoid({
  skin: '#F0BE96',
  hair: '#5B2E1E',
  shirt: '#16C79A',
  accent: '#EAF7F2',
  pants: '#4A2C6B',
});

const cat: HumanoidRig = {
  kind: 'humanoid',
  height: 62,
  hipY: 22,
  shoulderY: 18,
  headY: 24,
  legW: 11,
  legH: 22,
  legOffsetX: 12,
  armW: 10,
  armH: 20,
  armOffsetX: 15,
  torsoW: 46,
  torsoH: 26,
  headW: 30,
  headH: 28,
  headOffsetX: -16, // the cat's head sits out front, not on top
  parts: {
    head: svg(
      30,
      28,
      `<path d="M 5 10 L 2 2 L 11 6 Z M 25 10 L 28 2 L 19 6 Z" fill="#FFD93D" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
       <rect x="2.5" y="5.5" width="25" height="20" rx="9" fill="#FFD93D" stroke="${INK}" stroke-width="4"/>
       <circle cx="11" cy="15" r="2.2" fill="${INK}"/><circle cx="19" cy="15" r="2.2" fill="${INK}"/>
       <path d="M 13 20 L 15 22 L 17 20" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    ),
    torso: svg(
      46,
      26,
      `<rect x="2.5" y="2.5" width="41" height="21" rx="10" fill="#FFD93D" stroke="${INK}" stroke-width="4"/>
       <path d="M 43 8 Q 54 2 48 -6" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    ),
    arm_l: limb(10, 20, '#FFD93D'),
    arm_r: limb(10, 20, '#FFD93D'),
    leg_l: limb(11, 22, '#FFD93D'),
    leg_r: limb(11, 22, '#FFD93D'),
  },
};

const ball: ObjectRig = {
  kind: 'object',
  width: 46,
  height: 46,
  restY: 23,
  parts: {
    body: svg(
      46,
      46,
      `<circle cx="23" cy="23" r="20.5" fill="#E63946" stroke="${INK}" stroke-width="5"/>
       <path d="M 6 15 Q 23 26 40 15 M 6 31 Q 23 20 40 31" fill="none" stroke="${INK}" stroke-width="4"/>`,
    ),
  },
};

const box: ObjectRig = {
  kind: 'object',
  width: 58,
  height: 52,
  restY: 26,
  parts: {
    body: svg(
      58,
      52,
      `<rect x="3" y="3" width="52" height="46" rx="4" fill="#C98A3F" stroke="${INK}" stroke-width="5"/>
       <path d="M 3 18 H 55 M 29 3 V 18" fill="none" stroke="${INK}" stroke-width="4"/>`,
    ),
  },
};

const boat: ObjectRig = {
  kind: 'object',
  width: 96,
  height: 76,
  restY: 26,
  parts: {
    body: svg(
      96,
      76,
      `<path d="M 46 6 L 74 50 H 46 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
       <path d="M 42 6 L 42 50 L 20 50 Z" fill="#2E86FF" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
       <path d="M 4 50 H 92 L 78 71 H 18 Z" fill="#8D6A3F" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
       <path d="M 44 4 V 52" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    ),
  },
};

const car: ObjectRig = {
  kind: 'object',
  width: 104,
  height: 56,
  restY: 28,
  parts: {
    body: svg(
      104,
      56,
      `<path d="M 8 38 L 14 20 Q 16 12 26 12 H 66 Q 76 12 82 20 L 96 30 V 38 Z"
          fill="#2E86FF" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
       <path d="M 30 18 H 46 V 28 H 24 Z M 52 18 H 64 L 72 28 H 52 Z" fill="#CFE7FF" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
       <circle cx="30" cy="41" r="11" fill="#26282E" stroke="${INK}" stroke-width="5"/>
       <circle cx="78" cy="41" r="11" fill="#26282E" stroke="${INK}" stroke-width="5"/>`,
    ),
  },
};

const rocket: ObjectRig = {
  kind: 'object',
  width: 46,
  height: 100,
  restY: 50,
  parts: {
    body: svg(
      46,
      100,
      `<path d="M 23 3 Q 38 26 38 62 H 8 Q 8 26 23 3 Z" fill="#F1F1F1" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
       <path d="M 8 46 L 0 76 L 8 68 Z M 38 46 L 46 76 L 38 68 Z" fill="#E63946" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
       <circle cx="23" cy="32" r="7.5" fill="#2E86FF" stroke="${INK}" stroke-width="4.5"/>
       <path d="M 12 62 Q 23 96 34 62 Z" fill="#FF6B35" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`,
    ),
  },
};

export const RIGS: Record<SpriteName, Rig> = {
  person_a,
  person_b,
  cat,
  ball,
  boat,
  box,
  car,
  rocket,
};

/** Data URL for a part, ready to hand to an <img> and then to a Pixi texture. */
export function partDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
