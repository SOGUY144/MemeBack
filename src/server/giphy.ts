import type { SceneSpec } from '@/lib/ai/scene-schema';

/**
 * Replaces the meme-rendering step (sprite engine + the old Sora video
 * upgrade) with a search against Giphy's library, using the already-analyzed
 * scene to build the query. Analysis (verdict/concept_note/teaching_point —
 * the grading side) is untouched; this only changes what picture the student
 * sees for their answer.
 *
 * Free (Giphy's API has no per-call cost), classroom-rated ('g' only), and
 * near-instant compared to generative video. The tradeoff, on purpose: the
 * result is a real existing GIF that best matches the *shape* of the answer
 * (who did what to whom), not a bespoke render of it — see the caller in
 * socket.ts for the fallback to the sprite engine when nothing matches.
 */

const SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';

export function giphyAvailable(): boolean {
  return Boolean(process.env.GIPHY_API_KEY);
}

export const MEME_STYLES = ['default', 'cartoon', 'brainrot'] as const;
export type MemeStyle = (typeof MEME_STYLES)[number];

export function isMemeStyle(v: unknown): v is MemeStyle {
  return typeof v === 'string' && (MEME_STYLES as readonly string[]).includes(v);
}

const CLIP_TAG: Record<string, string> = {
  idle: 'standing',
  walk: 'walking',
  run: 'running',
  jump: 'jumping',
  kick: 'kick',
  punch: 'punch',
  push: 'push',
  pull: 'pull',
  collide: 'collision',
  knockback: 'knocked back',
  fall: 'falling',
  bounce: 'bounce',
  shake: 'shaking',
  spin: 'spinning',
  throw: 'throw',
  catch: 'catch',
  float: 'floating',
  sink: 'sinking',
  pop: 'pop',
  point: 'pointing',
  think_bubble: 'thinking',
  sweat: 'nervous sweat',
  celebrate: 'celebration',
};

const STYLE_TAG: Record<MemeStyle, string> = {
  default: 'meme reaction funny',
  cartoon: 'meme reaction cartoon funny',
  brainrot: 'meme reaction viral chaotic',
};

/**
 * Short, tag-like — Giphy's search matches keyword soup better than
 * sentences. Every query is anchored on "meme"/"reaction" (measured against
 * real searches — see the commit that added this) on purpose: Giphy has no
 * notion of "from TikTok" or "from Reels", it only searches its own library,
 * so the closest fit is steering every search at GIFs Giphy itself has
 * tagged as memes/reactions, never at movie clips or generic stock footage.
 *
 * Only the *first* beat's action makes it into the query. Testing showed
 * each additional specific verb pulled Giphy's relevance ranking further
 * toward literal (often sports or movie) matches for that verb and further
 * from meme content — one clear anchor plus the meme/reaction terms held the
 * results on-topic far more reliably than stacking three.
 */
export function buildGiphyQuery(spec: SceneSpec, style: MemeStyle): string {
  const primaryVerb = CLIP_TAG[spec.scene.beats[0]?.clip ?? ''] ?? '';
  return [primaryVerb, STYLE_TAG[style]].filter(Boolean).join(' ');
}

type GiphySearchResponse = {
  data?: { images?: { fixed_height?: { url?: string }; original?: { url?: string } } }[];
};

/** Rated 'g' only — this is a classroom, not a general Giphy embed. */
export async function searchMemeGif(query: string): Promise<string | null> {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return null;

  try {
    const url = `${SEARCH_URL}?${new URLSearchParams({
      api_key: key,
      q: query,
      limit: '1',
      rating: 'g',
      lang: 'en',
    })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[giphy] search failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as GiphySearchResponse;
    const gif = data.data?.[0]?.images;
    return gif?.fixed_height?.url ?? gif?.original?.url ?? null;
  } catch (err) {
    console.warn('[giphy] search failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
