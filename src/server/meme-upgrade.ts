import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateVideo } from '@/server/sora';
import type { SceneSpec } from '@/lib/ai/scene-schema';

/**
 * Turns exactly one meme per question — the one that opens CLASS_GUESS — into
 * a real Sora video, in place of its sprite-composited GIF/mp4.
 *
 * Scoped this tight on purpose. A full class answering one question is 20-30
 * sprite memes made in the browser for free in under 5s each; the same count
 * as Sora clips would be $25-45 and 30s-2min *per student* — the opposite of
 * "the room sees itself immediately." Upgrading only the meme every student's
 * eyes are already on for CLASS_GUESS keeps that promise for everyone's own
 * answer while still spending the AI budget where the whole room will see it.
 *
 * Every sprite meme stays exactly as it was — `Answer.memeUrl` is untouched —
 * this only ever adds `Answer.aiVideoUrl` and, on success, tells the room to
 * swap it in for display. A failure here (moderation block, timeout, no key)
 * is silent: the sprite meme that's already on screen just stays there.
 */

const MEME_DIR = path.join(process.cwd(), 'public', 'memes');

const CLIP_PHRASE: Record<string, string> = {
  idle: 'stands still',
  walk: 'walks',
  run: 'runs',
  jump: 'jumps',
  kick: 'kicks',
  punch: 'punches',
  push: 'pushes',
  pull: 'pulls',
  collide: 'collides with',
  knockback: 'is knocked backward',
  fall: 'falls down',
  bounce: 'bounces',
  shake: 'shakes back and forth',
  spin: 'spins around',
  throw: 'throws something at',
  catch: 'catches something',
  float: 'floats upward',
  sink: 'sinks downward',
  pop: 'pops',
  point: 'points at',
  think_bubble: 'stands still thinking, a question mark over its head',
  sweat: 'sweats nervously',
  celebrate: 'jumps and celebrates',
};

/**
 * Teacher-picked, per-question — see FormRow "สไตล์มีม" on the host page. An
 * open-ended "give me whatever's trending" option was ruled out because
 * there's no reliable way to confirm what's actually trending, or that it's
 * appropriate, without a human checking it first — "brainrot" below is as
 * close as that gets: it names the *aesthetic* (chaotic, absurdist,
 * mismatched-creature internet-meme energy that students in this age range
 * gravitate to) without naming or recreating specific copyrighted characters
 * (e.g. the Italian-brainrot cast) — both to stay clear of IP issues and
 * because Sora's own moderation is unpredictable about named characters.
 */
export const MEME_STYLES = ['default', 'cartoon', 'brainrot'] as const;
export type MemeStyle = (typeof MEME_STYLES)[number];

const STYLE_PROMPT: Record<MemeStyle, string> = {
  default:
    'flat vector illustration, thick clean black outlines, bold flat colors, ' +
    'simple geometric shapes, cheerful classroom-safe cartoon style, ' +
    'no readable text, no watermark, 16:9',
  cartoon:
    'vivid bright saturated cartoon illustration, glossy highlights, bouncy ' +
    'exaggerated motion, thick outlines, playful energetic classroom-safe ' +
    'cartoon style, no readable text, no watermark, 16:9',
  brainrot:
    'chaotic absurdist internet-meme aesthetic, silly mismatched-creature ' +
    'character designs, oversaturated colors, snappy jump-cut energy, ' +
    'exaggerated bouncy motion, deadpan comedic timing, playful and goofy ' +
    'but still classroom-appropriate, no readable text, no watermark, 16:9',
};

export function isMemeStyle(v: unknown): v is MemeStyle {
  return typeof v === 'string' && (MEME_STYLES as readonly string[]).includes(v);
}

export function describeSceneForVideo(spec: SceneSpec, style: MemeStyle = 'default'): string {
  const labelFor = (actorId: string) =>
    spec.scene.actors.find((a) => a.id === actorId)?.sprite.replace('_', ' ') ?? 'a character';

  const beats = spec.scene.beats
    .map((b) => {
      const verb = CLIP_PHRASE[b.clip] ?? b.clip;
      const target = b.target ? ` ${labelFor(b.target)}` : '';
      return `${labelFor(b.actor)} ${verb}${target}`;
    })
    .join(', then ');

  return `${beats}, ${spec.scene.setting} background, ${STYLE_PROMPT[style]}`;
}

/** Generates the clip, saves it, and returns its public URL. Throws on any failure. */
export async function upgradeAnswerToAiVideo(
  answerId: string,
  spec: SceneSpec,
  style: MemeStyle = 'default',
): Promise<string> {
  const prompt = describeSceneForVideo(spec, style);
  const bytes = await generateVideo({ prompt, size: '1280x720', seconds: '8' });

  await mkdir(MEME_DIR, { recursive: true });
  const filename = `${answerId}-ai.mp4`;
  await writeFile(path.join(MEME_DIR, filename), bytes);
  return `/memes/${filename}`;
}
