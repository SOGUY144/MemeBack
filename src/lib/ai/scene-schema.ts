import { z } from 'zod';
import {
  CLIPS,
  MEME_FORMATS,
  SETTINGS,
  SPRITES,
  VERDICTS,
  resolveClip,
  type ClipName,
} from '@/lib/meme/vocab';
import { MEME_CATALOG_BY_ID } from '@/lib/meme/catalog';

/**
 * `clip` is the one field where we coerce instead of reject.
 *
 * Rule 4 of the system prompt tells the model to pick the closest allowed clip,
 * and §7.3 gives the compiler a synonym table for when it doesn't. Rejecting the
 * whole scene because one verb came back as "hit" instead of "punch" would throw
 * away a perfectly good storyboard, so we map it here and let every other field
 * fail loudly. The parsed value is always a real ClipName.
 */
const ClipEnum = z
  .string()
  .transform((raw): ClipName => resolveClip(raw))
  .pipe(z.enum(CLIPS));

export const ActorSpec = z.object({
  id: z.string().min(1).max(4),
  label: z.string().max(24),
  sprite: z.enum(SPRITES),
  x: z.number().min(0).max(1),
});

export const BeatSpec = z.object({
  actor: z.string().min(1).max(4),
  clip: ClipEnum,
  target: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  duration_ms: z.number().min(200).max(2000),
});

/**
 * The punchline as a short exchange (e.g. "กำแพง: กฎข้อที่ 3 ของนิวตันไงน้อง"),
 * composed by the model but never rendered by the image model itself — AI
 * image generation draws Thai lettering unreliably. server/image-gen.ts draws
 * this as a real text overlay with a bundled Thai font after the (textless)
 * cartoon comes back, so it's always legible and separately editable.
 */
export const DialogueLine = z.object({
  speaker: z.string().min(1).max(20),
  line: z.string().min(1).max(60),
});

/**
 * The model is asked to pick one id from MEME_CATALOG (or null). Coerced like
 * `clip` above: an id the catalog doesn't recognize (typo, stale id) becomes
 * null rather than failing the whole scene — Giphy search just falls back to
 * the generic action-tag query in that case.
 */
const MatchedMeme = z
  .string()
  .nullish()
  .transform((v) => (v && MEME_CATALOG_BY_ID.has(v) ? v : null));

export const SceneSpec = z.object({
  understood: z.boolean(),
  verdict: z.enum(VERDICTS),
  concept_note: z.string().max(160),
  misconception: z
    .string()
    .max(160)
    .nullish()
    .transform((v) => v ?? null),
  teaching_point: z.string().max(200),
  /** Closest entry from MEME_CATALOG for this answer's action, or null. */
  matched_meme: MatchedMeme,
  /** 1-4 lines, only ever used against a server-generated image (see DialogueLine).
   *  Optional like matched_meme — a model response that omits it still parses. */
  dialogue: z
    .array(DialogueLine)
    .max(4)
    .nullish()
    .transform((v) => v ?? []),
  scene: z.object({
    setting: z.enum(SETTINGS),
    meme_format: z.enum(MEME_FORMATS),
    actors: z.array(ActorSpec).min(1).max(3),
    beats: z.array(BeatSpec).min(1).max(6),
    caption: z.string().max(70),
  }),
});

export type SceneSpec = z.infer<typeof SceneSpec>;
export type Scene = SceneSpec['scene'];
export type ActorSpec = z.infer<typeof ActorSpec>;
export type BeatSpec = z.infer<typeof BeatSpec>;
export type DialogueLine = z.infer<typeof DialogueLine>;

/** Loose shape accepted by the compiler, so hand-written specs and tests can
 *  pass clip names that have not been through Zod yet. */
export type RawBeat = {
  actor: string;
  clip: string;
  target?: string | null;
  duration_ms: number;
};

export const DISTRACTORS = z.array(z.string().min(1).max(80)).length(3);

/**
 * Used when the LLM is unavailable, times out twice, or returns garbage.
 * One actor, one thinking beat, caption is the student's own words truncated —
 * we never invent content on their behalf.
 */
export function fallbackScene(rawText: string): SceneSpec {
  const trimmed = rawText.trim();
  return {
    understood: false,
    verdict: 'partial',
    concept_note: 'ระบบยังวิเคราะห์คำตอบนี้ไม่ได้ ครูจะช่วยดูให้อีกครั้ง',
    misconception: null,
    teaching_point: 'AI วิเคราะห์คำตอบนี้ไม่สำเร็จ — อ่านคำตอบดิบแล้วอธิบายเอง',
    matched_meme: null,
    dialogue: [],
    scene: {
      setting: 'void',
      meme_format: 'impact_caption',
      actors: [{ id: 'A', label: '', sprite: 'person_a', x: 0.5 }],
      beats: [{ actor: 'A', clip: 'think_bubble', target: null, duration_ms: 1600 }],
      caption: trimmed.slice(0, 40) || '...',
    },
  };
}
