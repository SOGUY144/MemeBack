/**
 * The closed vocabulary the LLM is allowed to speak in.
 *
 * Nothing outside these lists can reach the renderer: the Zod schema rejects it
 * and the timeline compiler maps near-misses onto a known clip. Keeping the
 * lists here (and not inline in the schema) means the system prompt, the
 * validator and the sprite library can never drift apart.
 */

export const CLIPS = [
  'idle',
  'walk',
  'run',
  'jump',
  'kick',
  'punch',
  'push',
  'pull',
  'collide',
  'knockback',
  'fall',
  'bounce',
  'shake',
  'spin',
  'throw',
  'catch',
  'float',
  'sink',
  'pop',
  'point',
  'think_bubble',
  'sweat',
  'celebrate',
] as const;

export type ClipName = (typeof CLIPS)[number];

export const SPRITES = [
  'person_a',
  'person_b',
  'cat',
  'ball',
  'boat',
  'box',
  'car',
  'rocket',
] as const;

export type SpriteName = (typeof SPRITES)[number];

export const SETTINGS = [
  'classroom',
  'street',
  'water',
  'space',
  'kitchen',
  'field',
  'void',
] as const;

export type SettingName = (typeof SETTINGS)[number];

export const MEME_FORMATS = [
  'impact_caption',
  'two_panel',
  'reaction_zoom',
  'before_after',
] as const;

export type MemeFormat = (typeof MEME_FORMATS)[number];

export const VERDICTS = [
  'correct',
  'partial',
  'misconception',
  'off_topic',
] as const;

export type Verdict = (typeof VERDICTS)[number];

export const PARTS = [
  'head',
  'torso',
  'arm_l',
  'arm_r',
  'leg_l',
  'leg_r',
  'body',
] as const;

export type PartName = (typeof PARTS)[number];

/**
 * Verbs the model reaches for that are not in CLIPS. Applied by the compiler
 * before the hard fallback, so a slightly-off clip name still animates.
 */
export const CLIP_SYNONYMS: Record<string, ClipName> = {
  hit: 'punch',
  strike: 'punch',
  smash: 'collide',
  crash: 'collide',
  bump: 'collide',
  explode: 'pop',
  burst: 'pop',
  vibrate: 'shake',
  shiver: 'shake',
  tremble: 'shake',
  drop: 'fall',
  drops: 'fall',
  slip: 'fall',
  toss: 'throw',
  launch: 'throw',
  fly: 'float',
  hover: 'float',
  drown: 'sink',
  dive: 'sink',
  recoil: 'knockback',
  repel: 'knockback',
  bounce_back: 'knockback',
  sprint: 'run',
  dash: 'run',
  leap: 'jump',
  hop: 'jump',
  shove: 'push',
  drag: 'pull',
  tug: 'pull',
  rotate: 'spin',
  twirl: 'spin',
  cheer: 'celebrate',
  win: 'celebrate',
  wonder: 'think_bubble',
  think: 'think_bubble',
  stand: 'idle',
  wait: 'idle',
};

/** Clip used when a name is neither known nor a known synonym. */
export const FALLBACK_CLIP: ClipName = 'shake';

export function resolveClip(raw: string): ClipName {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((CLIPS as readonly string[]).includes(key)) return key as ClipName;
  return CLIP_SYNONYMS[key] ?? FALLBACK_CLIP;
}
