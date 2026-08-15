import type { SceneSpec } from '@/lib/ai/scene-schema';
import type { Verdict } from '@/lib/meme/vocab';

export type PromotionCandidate = {
  answerId: string;
  verdict: Verdict | null;
  spec: SceneSpec | null;
};

/**
 * Picks the 3–5 memes worth putting on the projector (§6.5).
 *
 * The mix matters more than any single score: one wrong answer teaches the room
 * more than three right ones, so a misconception goes first, then the most
 * varied correct answers, then whichever scene looks least like the others.
 * Near-identical storyboards are collapsed by comparing their clip sequences.
 */
export function suggestPromotions(candidates: PromotionCandidate[]): string[] {
  const usable = candidates.filter((c) => c.spec && c.verdict && c.verdict !== 'off_topic');
  if (usable.length === 0) return [];

  const seen = new Set<string>();
  const unique: PromotionCandidate[] = [];
  for (const c of usable) {
    const sig = clipSignature(c);
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(c);
  }

  const picked: string[] = [];
  const take = (c: PromotionCandidate | undefined) => {
    if (c && !picked.includes(c.answerId)) picked.push(c.answerId);
  };

  // 1. the most instructive wrong answer
  take(unique.filter((c) => c.verdict === 'misconception').sort(byDiversity)[0]);

  // 2. up to three correct answers, most varied first
  for (const c of unique.filter((c) => c.verdict === 'correct').sort(byDiversity).slice(0, 3)) {
    if (picked.length >= 4) break;
    take(c);
  }

  // 3. the oddest staging in the room, wherever it came from
  take(
    unique
      .filter((c) => !picked.includes(c.answerId))
      .sort((a, b) => rarity(b, unique) - rarity(a, unique))[0],
  );

  // 4. top up from whatever is left so a small class still gets a round
  for (const c of unique) {
    if (picked.length >= 5) break;
    take(c);
  }

  return picked.slice(0, 5);
}

/**
 * Every answer that fails analysis (no ANTHROPIC_API_KEY, two timeouts, a bad
 * parse — see `fallbackScene()` in scene-schema.ts) renders the exact same
 * single-actor think_bubble storyboard. Signing those by clip sequence like
 * any other scene collapsed all of them into one "duplicate", so a room with
 * no AI key ever got more than one meme on the projector no matter how many
 * students answered. Each of those is still a distinct student's answer, so
 * fold the answerId into the signature instead of letting them collide.
 */
function clipSignature(c: PromotionCandidate): string {
  const spec = c.spec!;
  if (isFallbackShape(spec)) return `fallback:${c.answerId}`;
  return spec.scene.beats.map((b) => b.clip).join('>');
}

function isFallbackShape(spec: SceneSpec): boolean {
  const { scene } = spec;
  return (
    scene.setting === 'void' &&
    scene.actors.length === 1 &&
    scene.beats.length === 1 &&
    scene.beats[0]?.clip === 'think_bubble'
  );
}

/** More distinct clips and more actors = more to look at on the projector. */
function diversityScore(c: PromotionCandidate): number {
  if (!c.spec) return 0;
  const clips = new Set(c.spec.scene.beats.map((b) => b.clip));
  const targeted = c.spec.scene.beats.filter((b) => b.target).length;
  return clips.size * 2 + c.spec.scene.actors.length + targeted;
}

const byDiversity = (a: PromotionCandidate, b: PromotionCandidate) =>
  diversityScore(b) - diversityScore(a);

/** How unusual this scene's sprite/setting combo is compared with the rest. */
function rarity(c: PromotionCandidate, all: PromotionCandidate[]): number {
  if (!c.spec) return 0;
  const counts = new Map<string, number>();
  for (const other of all) {
    if (!other.spec) continue;
    for (const key of comboKeys(other.spec)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let score = 0;
  for (const key of comboKeys(c.spec)) score += 1 / (counts.get(key) ?? 1);
  return score;
}

function comboKeys(spec: SceneSpec): string[] {
  return spec.scene.actors.map((a) => `${spec.scene.setting}:${a.sprite}`);
}
