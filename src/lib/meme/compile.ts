import { CLIPS_LIB, IMPACT_CLIPS, TARGET_REACTION } from '@/lib/meme/clips';
import { resolveClip, type ClipName, type MemeFormat, type SettingName, type SpriteName } from '@/lib/meme/vocab';

/**
 * Turns a storyboard (`SceneSpec.scene`) into an absolute-time timeline the
 * renderer can scrub deterministically.
 *
 * Scheduling rule, stated once so it can be tested:
 *   - Beats belonging to the same actor are **sequential** — each starts where
 *     that actor's previous beat ended.
 *   - The first beat of a *new* actor starts at the same moment as the beat
 *     before it in the array, so different actors run **in parallel**.
 *
 * On top of that, a beat with a `target` auto-inserts a reaction beat on the
 * target at the moment of impact (kick → knockback, push → walk backwards,
 * throw → catch), unless the storyboard already gave the target something to do
 * at that moment.
 */

export const SCENE_MIN_X = 0.08;
export const SCENE_MAX_X = 0.92;
const MIN_TIMELINE_MS = 1200;

export type CompiledActor = {
  id: string;
  label: string;
  sprite: SpriteName;
  x: number;
};

export type Segment = {
  actorId: string;
  clip: ClipName;
  startMs: number;
  endMs: number;
  /** Normalized screen position at the start / end of the segment. */
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  /** Which way the sprite looks: +1 faces right, -1 faces left. */
  facing: 1 | -1;
  /** Absolute time the hit lands, for impact clips. */
  impactMs: number | null;
  /** True when the compiler inserted this segment (reaction or idle filler). */
  auto: boolean;
};

export type ImpactEvent = {
  tMs: number;
  actorId: string;
  targetId: string | null;
  clip: ClipName;
  /** Where on screen the burst should be drawn. */
  x: number;
};

export type Timeline = {
  durationMs: number;
  setting: SettingName;
  memeFormat: MemeFormat;
  caption: string;
  actors: CompiledActor[];
  segments: Segment[];
  impacts: ImpactEvent[];
};

type InputActor = { id: string; label: string; sprite: SpriteName; x: number };
type InputBeat = { actor: string; clip: string; target?: string | null; duration_ms: number };

export type CompileInput = {
  setting: SettingName;
  meme_format: MemeFormat;
  actors: InputActor[];
  beats: InputBeat[];
  caption: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function compileScene(scene: CompileInput): Timeline {
  const actors: CompiledActor[] = scene.actors.map((a, i) => ({
    id: a.id,
    label: a.label,
    sprite: a.sprite,
    x: Number.isFinite(a.x)
      ? clamp(a.x, SCENE_MIN_X, SCENE_MAX_X)
      : defaultX(i, scene.actors.length),
  }));

  // Models like to put everyone at x: 0 or x: 0.5. Overlapping sprites read as
  // one blob, so re-space the whole cast evenly when any pair is too close.
  const overlapping = actors.some((a, i) =>
    actors.some((b, j) => j > i && Math.abs(a.x - b.x) < 0.12),
  );
  if (overlapping) {
    actors.forEach((a, i) => {
      a.x = defaultX(i, actors.length);
    });
  }

  const byId = new Map(actors.map((a) => [a.id, a]));
  const fallbackActorId = actors[0]!.id;

  const posX = new Map(actors.map((a) => [a.id, a.x] as const));
  const posY = new Map<string, number>(actors.map((a) => [a.id, 0]));
  const facing = new Map(
    actors.map((a) => [a.id, (a.x <= 0.5 ? 1 : -1) as 1 | -1] as const),
  );

  const cursor = new Map<string, number>();
  const segments: Segment[] = [];
  const impacts: ImpactEvent[] = [];
  let prevStart = 0;

  for (const beat of scene.beats) {
    const actorId = byId.has(beat.actor) ? beat.actor : fallbackActorId;
    const clipName = resolveClip(beat.clip);
    const clip = CLIPS_LIB[clipName];
    const duration = clamp(Math.round(beat.duration_ms), 200, 2000);

    const start = cursor.get(actorId) ?? prevStart;
    const end = start + duration;

    const targetId =
      beat.target && byId.has(beat.target) && beat.target !== actorId ? beat.target : null;

    const from = posX.get(actorId)!;
    const fromY = posY.get(actorId)!;

    // Direction: toward the target when there is one, otherwise keep facing.
    let dir: 1 | -1 = facing.get(actorId)!;
    if (targetId) {
      const tx = posX.get(targetId)!;
      dir = tx >= from ? 1 : -1;
    }

    let to = from;
    let toY = fromY;
    if (clip.rootMotion) {
      to = clamp(from + dir * clip.rootMotion.dx, SCENE_MIN_X, SCENE_MAX_X);
      toY = fromY + clip.rootMotion.dy;
      // Don't walk through the target — stop just short of it.
      if (targetId) {
        const tx = posX.get(targetId)!;
        to = dir === 1 ? Math.min(to, tx - 0.08) : Math.max(to, tx + 0.08);
        to = clamp(to, SCENE_MIN_X, SCENE_MAX_X);
      }
    }

    const impactMs =
      clip.impact !== undefined ? Math.round(start + duration * clip.impact) : null;

    segments.push({
      actorId,
      clip: clipName,
      startMs: start,
      endMs: end,
      fromX: from,
      toX: to,
      fromY,
      toY,
      facing: dir,
      impactMs,
      auto: false,
    });

    posX.set(actorId, to);
    posY.set(actorId, toY);
    facing.set(actorId, dir);
    cursor.set(actorId, end);
    prevStart = start;

    if (IMPACT_CLIPS.has(clipName) || (impactMs !== null && targetId)) {
      impacts.push({
        tMs: impactMs ?? Math.round(start + duration * 0.5),
        actorId,
        targetId,
        clip: clipName,
        x: to,
      });
    }

    // --- auto reaction on the target ---------------------------------------
    const reaction = TARGET_REACTION[clipName];
    if (targetId && reaction && impactMs !== null) {
      const reactDuration = clamp(Math.round(duration * 0.8), 320, 900);
      const busy = segments.some(
        (s) =>
          !s.auto &&
          s.actorId === targetId &&
          s.startMs < impactMs + reactDuration &&
          s.endMs > impactMs,
      );

      if (!busy) {
        const rFrom = posX.get(targetId)!;
        const rFromY = posY.get(targetId)!;
        const attackerX = to;
        // Always pushed *away* from whoever hit them.
        const rDir: 1 | -1 = rFrom >= attackerX ? 1 : -1;
        const rClip = CLIPS_LIB[reaction];
        let rTo = rFrom;
        let rToY = rFromY;
        if (rClip.rootMotion) {
          rTo = clamp(rFrom + rDir * Math.abs(rClip.rootMotion.dx), SCENE_MIN_X, SCENE_MAX_X);
          rToY = rFromY + rClip.rootMotion.dy;
        }

        const rStart = Math.max(impactMs, cursor.get(targetId) ?? 0);
        const rEnd = rStart + reactDuration;

        segments.push({
          actorId: targetId,
          clip: reaction,
          startMs: rStart,
          endMs: rEnd,
          fromX: rFrom,
          toX: rTo,
          fromY: rFromY,
          toY: rToY,
          // knocked back = still looking at the attacker
          facing: (-rDir) as 1 | -1,
          impactMs: null,
          auto: true,
        });

        posX.set(targetId, rTo);
        posY.set(targetId, rToY);
        facing.set(targetId, (-rDir) as 1 | -1);
        cursor.set(targetId, rEnd);
      }
    }
  }

  const authoredEnd = segments.reduce((m, s) => Math.max(m, s.endMs), 0);
  const durationMs = Math.max(MIN_TIMELINE_MS, authoredEnd);

  // Idle fillers so every actor is posed at every frame.
  for (const actor of actors) {
    const own = segments
      .filter((s) => s.actorId === actor.id)
      .sort((a, b) => a.startMs - b.startMs);

    const gaps: Array<[number, number]> = [];
    let t = 0;
    for (const s of own) {
      if (s.startMs > t) gaps.push([t, s.startMs]);
      t = Math.max(t, s.endMs);
    }
    if (t < durationMs) gaps.push([t, durationMs]);

    for (const [from, until] of gaps) {
      if (until - from < 1) continue;
      const restX = own.length
        ? (own.find((s) => s.startMs >= until)?.fromX ??
          own[own.length - 1]!.toX)
        : actor.x;
      const restY = own.length
        ? (own.find((s) => s.startMs >= until)?.fromY ?? own[own.length - 1]!.toY)
        : 0;
      segments.push({
        actorId: actor.id,
        clip: 'idle',
        startMs: from,
        endMs: until,
        fromX: restX,
        toX: restX,
        fromY: restY,
        toY: restY,
        facing: facing.get(actor.id)!,
        impactMs: null,
        auto: true,
      });
    }
  }

  segments.sort((a, b) => a.startMs - b.startMs || a.actorId.localeCompare(b.actorId));
  impacts.sort((a, b) => a.tMs - b.tMs);

  return {
    durationMs,
    setting: scene.setting,
    memeFormat: scene.meme_format,
    caption: scene.caption,
    actors,
    segments,
    impacts,
  };
}

function defaultX(index: number, total: number): number {
  if (total <= 1) return 0.5;
  return SCENE_MIN_X + ((SCENE_MAX_X - SCENE_MIN_X) * index) / (total - 1);
}

/** Pose of one actor at an absolute time — what the renderer asks for each frame. */
export function segmentAt(timeline: Timeline, actorId: string, tMs: number): Segment | null {
  let best: Segment | null = null;
  for (const s of timeline.segments) {
    if (s.actorId !== actorId) continue;
    if (tMs >= s.startMs && tMs < s.endMs) {
      // Authored beats win over auto fillers when they overlap.
      if (!best || (best.auto && !s.auto)) best = s;
    }
  }
  if (best) return best;
  // past the end — hold the final pose
  const own = timeline.segments.filter((s) => s.actorId === actorId);
  return own.length ? own[own.length - 1]! : null;
}
