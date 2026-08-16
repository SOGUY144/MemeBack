import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { DialogueLine, SceneSpec } from '@/lib/ai/scene-schema';
import { MEME_CATALOG_BY_ID } from '@/lib/meme/catalog';

/**
 * On-demand upgrade from a Giphy match (src/server/giphy.ts) to a bespoke
 * cartoon, triggered only by the teacher via teacher:generate-ai-meme on an
 * already-promoted answer (server/socket.ts) — this costs real money per
 * call, so it must never run automatically for every answer in a class.
 *
 * The model is never asked to draw the joke's dialogue itself — image models
 * render non-Latin text unreliably, Thai especially. Instead it draws a plain
 * (textless) cartoon, and `compositeDialogue` below burns the actual dialogue
 * on top as real vector text with a bundled Thai font, checked in
 * assets/fonts/Kanit-Bold.ttf. The base cartoon is kept on disk as
 * `<id>-ai-base.png` specifically so a dialogue edit (teacher:edit-dialogue in
 * server/socket.ts) can re-composite for free instead of paying for and
 * waiting on a second generation.
 */

const BASE = 'https://api.openai.com/v1/images/generations';
const MODEL = 'gpt-image-1';
const TIMEOUT_MS = 30_000;
const MEME_DIR = path.join(process.cwd(), 'public', 'memes');
const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'Kanit-Bold.ttf');

let fontB64Cache: string | null = null;
async function fontBase64(): Promise<string> {
  if (!fontB64Cache) fontB64Cache = (await readFile(FONT_PATH)).toString('base64');
  return fontB64Cache;
}

function apiKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

export function imageGenAvailable(): boolean {
  return Boolean(apiKey());
}

/**
 * Sprite name → a fixed, generic English phrase. Used instead of the scene's
 * free-text actor `label` when building an image prompt: `label` is written
 * by the storyboard LLM from the student's own answer (server/ai.ts) and can
 * legitimately contain a real name ("สมชายว่ายน้ำ" → label "สมชาย") — sending
 * that to an external image API would leak a student's name outside the app.
 * `sprite` is a closed enum (see lib/meme/vocab.ts) with no free text at all,
 * so it carries the same visual information with no PII path.
 */
const SPRITE_DESCRIPTION: Record<string, string> = {
  person_a: 'a person',
  person_b: 'another person',
  cat: 'a cat',
  ball: 'a ball',
  boat: 'a boat',
  box: 'a box',
  car: 'a car',
  rocket: 'a rocket',
};

/**
 * English, textless (dialogue is composited on afterward — see module doc).
 * Never includes scene.actors[].label or any other free-text field that
 * could carry a student's name — see SPRITE_DESCRIPTION above.
 *
 * Two paths:
 *  - matched_meme has a `visual` (the "Italian brainrot" cast — see catalog.ts
 *    for why that field exists and what it does and doesn't claim about
 *    ownership): describe the character's general recognizable traits doing
 *    the scene's action, in the hyperreal/uncanny AI-art style these memes
 *    actually circulate in, explicitly instructed as an original
 *    reinterpretation rather than a copy of any specific reference image —
 *    that instruction is the actual risk reduction, not an ownership claim.
 *    This is what makes a kid go "that's Tralalero Tralala!" instead of a
 *    generic illustration of the same action.
 *  - no match, or the match is a real copyrighted character (Pikachu,
 *    Homelander, ...): fall back to describing the scene's own actors/action
 *    generically, in the same style, without naming or depicting anyone's IP.
 */
export function buildPrompt(spec: SceneSpec): string {
  const { scene } = spec;
  const style =
    'Hyperrealistic, cinematic photo composition, dramatic lighting, highly detailed — the slightly uncanny AI-generated look real viral "brainrot" memes have, not a flat cartoon illustration.';
  const noText = 'Absolutely no text, letters, captions, or writing anywhere in the image.';

  const matched = spec.matched_meme ? MEME_CATALOG_BY_ID.get(spec.matched_meme) : undefined;
  if (matched?.visual) {
    const actions = scene.beats
      .map((b) => b.clip.replace('_', ' '))
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(' then ');
    return [
      style,
      noText,
      `Main subject: ${matched.visual}.`,
      `It is ${actions || 'in its usual pose'}.`,
      `Setting: ${scene.setting}.`,
      'This is an original artistic reinterpretation based only on the general concept above — do not replicate any specific existing artwork, exact pose, composition, or distinctive design detail, and do not include any brand logos or trademarks.',
    ].join(' ');
  }

  const actors = scene.actors.map((a) => SPRITE_DESCRIPTION[a.sprite] ?? 'a character').join(' and ');
  const actions = scene.beats
    .map((b) => b.clip.replace('_', ' '))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(' then ');
  return [
    style,
    noText,
    `Subject: ${actors || 'a character'}.`,
    `Action: ${actions || 'standing'}.`,
    `Setting: ${scene.setting}.`,
  ].join(' ');
}

type ImageResponse = {
  data?: { b64_json?: string }[];
  error?: { message?: string };
};

async function requestImage(prompt: string): Promise<Buffer | null> {
  const key = apiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, prompt, size: '1024x1024', quality: 'low', n: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[image-gen] request failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as ImageResponse;
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      console.warn('[image-gen] no image in response:', data.error?.message ?? 'unknown');
      return null;
    }
    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.warn('[image-gen] generation failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A dialogue line can only ever have come from a <textarea> (host UI) or a
 *  socket payload (server/socket.ts already `.trim().slice()`s it), but this
 *  is the last stop before the value becomes SVG markup, so it gets its own
 *  defensive pass rather than trusting either caller: collapses embedded
 *  newlines/tabs (SVG <text> does not line-break on them, they'd just render
 *  as odd gaps) into single spaces. */
const sanitizeForOverlay = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();

const MIN_FONT_SIZE = 36;
const MAX_FONT_SIZE = 80;

export function overlayFontSize(text: string, maxWidth: number): number {
  if (text.length === 0) return MAX_FONT_SIZE;
  const estimated = Math.floor(maxWidth / (text.length * 0.6));
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, estimated));
}

async function dialogueSvg(width: number, height: number, dialogue: DialogueLine[]): Promise<string> {
  if (dialogue.length === 0) return '';
  const font = await fontBase64();
  const lineHeight = 100;
  const gap = 15;
  const marginX = 20;
  const marginBottom = 40;
  const totalHeight = dialogue.length * lineHeight + (dialogue.length - 1) * gap;
  const startY = Math.max(marginBottom, height - marginBottom - totalHeight);
  const barWidth = width - marginX * 2;

  const bars = dialogue
    .map((d, i) => {
      const y = startY + i * (lineHeight + gap);
      const label = escapeXml(`${sanitizeForOverlay(d.speaker)}: ${sanitizeForOverlay(d.line)}`);
      const fontSize = overlayFontSize(label, barWidth);
      return `
        <text x="${width / 2}" y="${y + lineHeight / 2}" text-anchor="middle"
              dominant-baseline="central" fill="white" font-size="${fontSize}"
              stroke="black" stroke-width="${fontSize * 0.15}" stroke-linejoin="round"
              paint-order="stroke fill">${label}</text>
      `;
    })
    .join('');

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: 'OverlayFont';
            src: url(data:font/ttf;base64,${font}) format('truetype');
          }
          text { font-family: 'OverlayFont'; }
        </style>
      </defs>
      ${bars}
    </svg>
  `;
}

/** Burns `dialogue` onto `base` as a real text overlay and writes the result
 *  to `<answerId>-ai.png` — the URL the rest of the app treats as the meme. */
export async function compositeDialogue(
  base: Buffer,
  dialogue: DialogueLine[],
  answerId: string,
): Promise<string> {
  const image = sharp(base);
  const { width = 1024, height = 1024 } = await image.metadata();
  const svg = await dialogueSvg(width, height, dialogue);

  const composited = svg
    ? await image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
    : await image.png().toBuffer();

  await mkdir(MEME_DIR, { recursive: true });
  const filename = `${answerId}-ai.png`;
  await writeFile(path.join(MEME_DIR, filename), composited);
  return `/memes/${filename}`;
}

/** Generates the base cartoon (no text), composites the dialogue on top, and
 *  keeps the textless base around as `<id>-ai-base.png` for later edits.
 *  Returns null on any failure — the caller falls back to the sprite engine,
 *  same as when Giphy comes up empty. */
export async function generateMemeImage(spec: SceneSpec, answerId: string): Promise<string | null> {
  const base = await requestImage(buildPrompt(spec));
  if (!base) return null;

  try {
    await mkdir(MEME_DIR, { recursive: true });
    await writeFile(path.join(MEME_DIR, `${answerId}-ai-base.png`), base);
    return await compositeDialogue(base, spec.dialogue, answerId);
  } catch (err) {
    console.warn('[image-gen] compositing failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Re-composites an edited dialogue onto the already-generated base image —
 *  no new OpenAI call, so editing the joke's wording is free and instant. */
export async function recompositeDialogue(
  answerId: string,
  dialogue: DialogueLine[],
): Promise<string | null> {
  try {
    const base = await readFile(path.join(MEME_DIR, `${answerId}-ai-base.png`));
    return await compositeDialogue(base, dialogue, answerId);
  } catch (err) {
    console.warn('[image-gen] recomposite failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
