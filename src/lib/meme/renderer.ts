'use client';

import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { RIGS, partDataUrl, type HumanoidRig, type ObjectRig } from '@/assets/sprites';
import { sampleTrack, CLIPS_LIB, type TrackPart } from '@/lib/meme/clips';
import { segmentAt, type Segment, type Timeline } from '@/lib/meme/compile';
import type { SettingName, SpriteName } from '@/lib/meme/vocab';

export const MEME_W = 480;
export const MEME_H = 270;
export const MEME_FPS = 20;
const GROUND_Y = 214;

// ---------------------------------------------------------------------------
// texture cache
// ---------------------------------------------------------------------------

const textureCache = new Map<string, Texture>();

async function textureFor(key: string, markup: string): Promise<Texture> {
  const hit = textureCache.get(key);
  if (hit) return hit;
  const img = new Image();
  img.src = partDataUrl(markup);
  await img.decode();
  const tex = Texture.from(img);
  textureCache.set(key, tex);
  return tex;
}

async function loadRigTextures(sprite: SpriteName): Promise<Record<string, Texture>> {
  const rig = RIGS[sprite];
  const out: Record<string, Texture> = {};
  for (const [part, markup] of Object.entries(rig.parts)) {
    out[part] = await textureFor(`${sprite}:${part}`, markup as string);
  }
  return out;
}

// ---------------------------------------------------------------------------
// actor rigs on stage
// ---------------------------------------------------------------------------

type ActorView = {
  id: string;
  root: Container; // world placement + facing
  inner: Container; // driven by the `root` clip track
  upper: Container | null; // hip joint: torso + arms + head
  parts: Partial<Record<TrackPart, Container>>;
  rig: HumanoidRig | ObjectRig;
  label: Text | null;
  headOffset: { x: number; y: number };
};

function anchorSprite(tex: Texture, ax: number, ay: number, w: number, h: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(ax, ay);
  s.width = w;
  s.height = h;
  return s;
}

async function buildActor(sprite: SpriteName, label: string): Promise<ActorView> {
  const rig = RIGS[sprite];
  const tex = await loadRigTextures(sprite);

  const root = new Container();
  const inner = new Container();
  root.addChild(inner);

  const parts: Partial<Record<TrackPart, Container>> = {};
  let upper: Container | null = null;
  let headOffset = { x: 0, y: -60 };

  if (rig.kind === 'humanoid') {
    const legL = anchorSprite(tex.leg_l!, 0.5, 0.06, rig.legW, rig.legH);
    const legR = anchorSprite(tex.leg_r!, 0.5, 0.06, rig.legW, rig.legH);
    legL.position.set(-rig.legOffsetX, -rig.hipY);
    legR.position.set(rig.legOffsetX, -rig.hipY);

    upper = new Container();
    upper.position.set(0, -rig.hipY);

    const torso = anchorSprite(tex.torso!, 0.5, 1, rig.torsoW, rig.torsoH);
    const armL = anchorSprite(tex.arm_l!, 0.5, 0.08, rig.armW, rig.armH);
    const armR = anchorSprite(tex.arm_r!, 0.5, 0.08, rig.armW, rig.armH);
    armL.position.set(-rig.armOffsetX, -rig.shoulderY);
    armR.position.set(rig.armOffsetX, -rig.shoulderY);

    const head = anchorSprite(tex.head!, 0.5, 1, rig.headW, rig.headH);
    head.position.set(rig.headOffsetX ?? 0, -rig.headY);

    // arm_l behind the torso, arm_r in front — reads as depth without a z-buffer
    upper.addChild(armL, torso, head, armR);
    inner.addChild(legL, legR, upper);

    parts.leg_l = legL;
    parts.leg_r = legR;
    parts.arm_l = armL;
    parts.arm_r = armR;
    parts.torso = upper;
    parts.head = head;
    headOffset = { x: rig.headOffsetX ?? 0, y: -(rig.hipY + rig.headY + rig.headH * 0.5) };
  } else {
    const body = anchorSprite(tex.body!, 0.5, 0.5, rig.width, rig.height);
    body.position.set(0, -rig.restY);
    inner.addChild(body);
    parts.body = body;
    // Clips aimed at the torso/head of an object drive its single body part.
    parts.torso = body;
    parts.head = body;
    headOffset = { x: 0, y: -(rig.restY + rig.height * 0.3) };
  }

  let labelText: Text | null = null;
  if (label.trim()) {
    labelText = new Text({
      text: label.trim(),
      style: new TextStyle({
        fontFamily: 'Noto Sans Thai, Segoe UI, system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '800',
        fill: 0xffffff,
        stroke: { color: 0x111318, width: 4, join: 'round' },
      }),
    });
    labelText.anchor.set(0.5, 0);
    root.addChild(labelText);
  }

  return { id: '', root, inner, upper, parts, rig, label: labelText, headOffset };
}

// ---------------------------------------------------------------------------
// backgrounds
// ---------------------------------------------------------------------------

function band(g: Graphics, y: number, h: number, color: number) {
  g.rect(0, y, MEME_W, h).fill(color);
}

/** Cheap vertical gradient: a handful of bands is plenty at 480×270. */
function gradient(g: Graphics, from: number, to: number, y0: number, y1: number, steps = 10) {
  const fr = (from >> 16) & 255,
    fg = (from >> 8) & 255,
    fb = from & 255;
  const tr = (to >> 16) & 255,
    tg = (to >> 8) & 255,
    tb = to & 255;
  const h = (y1 - y0) / steps;
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const c = (
      (Math.round(fr + (tr - fr) * u) << 16) |
      (Math.round(fg + (tg - fg) * u) << 8) |
      Math.round(fb + (tb - fb) * u)
    );
    band(g, y0 + i * h, h + 1, c);
  }
}

function drawBackground(setting: SettingName): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);

  switch (setting) {
    case 'classroom': {
      gradient(g, 0xfdf1dc, 0xf2ddb8, 0, GROUND_Y);
      band(g, GROUND_Y, MEME_H - GROUND_Y, 0xb98a53);
      g.rect(0, GROUND_Y, MEME_W, 5).fill(0x111318);
      g.rect(48, 34, 190, 96).fill(0x2f6b4f).stroke({ width: 5, color: 0x111318 });
      g.moveTo(66, 62).lineTo(170, 62).moveTo(66, 84).lineTo(200, 84).moveTo(66, 106).lineTo(140, 106)
        .stroke({ width: 4, color: 0xe8f3ec });
      g.rect(300, 44, 130, 86).fill(0xbfe4ff).stroke({ width: 5, color: 0x111318 });
      g.moveTo(365, 44).lineTo(365, 130).moveTo(300, 87).lineTo(430, 87).stroke({ width: 4, color: 0x111318 });
      g.rect(330, GROUND_Y - 44, 108, 12).fill(0xd9a45b).stroke({ width: 4, color: 0x111318 });
      g.rect(340, GROUND_Y - 32, 8, 32).fill(0x8d6a3f);
      g.rect(420, GROUND_Y - 32, 8, 32).fill(0x8d6a3f);
      break;
    }
    case 'street': {
      gradient(g, 0x7ec8f2, 0xd8f0ff, 0, 150);
      band(g, 150, GROUND_Y - 150, 0x9aa7b4);
      band(g, GROUND_Y, MEME_H - GROUND_Y, 0x4a4f57);
      g.rect(0, GROUND_Y, MEME_W, 5).fill(0x111318);
      g.rect(20, 62, 78, 88).fill(0xd76f5a).stroke({ width: 5, color: 0x111318 });
      g.rect(112, 40, 66, 110).fill(0xefc75e).stroke({ width: 5, color: 0x111318 });
      g.rect(360, 54, 92, 96).fill(0x7f6fb0).stroke({ width: 5, color: 0x111318 });
      for (let i = 0; i < 8; i++) g.rect(34 + i * 14, 78, 8, 10).fill(0x2b3a67);
      g.rect(216, 92, 7, GROUND_Y - 92).fill(0x2b3a67).stroke({ width: 4, color: 0x111318 });
      g.circle(219, 88, 12).fill(0xffe27a).stroke({ width: 4, color: 0x111318 });
      for (let x = 24; x < MEME_W; x += 74) g.rect(x, MEME_H - 26, 40, 6).fill(0xf5f5f5);
      break;
    }
    case 'water': {
      gradient(g, 0x8fd8ff, 0xe4f6ff, 0, 168);
      g.circle(404, 46, 27).fill(0xffe27a).stroke({ width: 5, color: 0x111318 });
      g.ellipse(96, 56, 40, 17).fill(0xffffff).stroke({ width: 5, color: 0x111318 });
      g.ellipse(132, 48, 26, 14).fill(0xffffff).stroke({ width: 5, color: 0x111318 });
      band(g, 168, MEME_H - 168, 0x2f8fd0);
      g.rect(0, 168, MEME_W, 5).fill(0x111318);
      for (let i = 0; i < 5; i++) {
        const y = 190 + i * 18;
        for (let x = -20 + (i % 2) * 26; x < MEME_W; x += 62) {
          g.moveTo(x, y).quadraticCurveTo(x + 16, y - 8, x + 32, y).stroke({ width: 4, color: 0x9fd8f5 });
        }
      }
      break;
    }
    case 'space': {
      gradient(g, 0x120b2e, 0x2b1a5c, 0, MEME_H);
      let seed = 7;
      for (let i = 0; i < 60; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        const x = (seed / 233280) * MEME_W;
        seed = (seed * 9301 + 49297) % 233280;
        const y = (seed / 233280) * MEME_H;
        g.circle(x, y, i % 7 === 0 ? 2.4 : 1.2).fill(0xffffff);
      }
      g.circle(392, 66, 40).fill(0xff8f5a).stroke({ width: 5, color: 0x111318 });
      g.ellipse(392, 66, 62, 12).fill(0x00000000).stroke({ width: 5, color: 0xffe27a });
      g.ellipse(240, MEME_H + 40, 320, 110).fill(0x4a3a86).stroke({ width: 5, color: 0x111318 });
      break;
    }
    case 'kitchen': {
      gradient(g, 0xfff3e6, 0xffe2c4, 0, GROUND_Y);
      for (let x = 0; x < MEME_W; x += 40) g.moveTo(x, 0).lineTo(x, GROUND_Y).stroke({ width: 2, color: 0xf0cfa8 });
      band(g, GROUND_Y, MEME_H - GROUND_Y, 0xc0765a);
      g.rect(0, GROUND_Y, MEME_W, 5).fill(0x111318);
      g.rect(286, GROUND_Y - 58, 170, 58).fill(0xf1f1f1).stroke({ width: 5, color: 0x111318 });
      g.circle(330, GROUND_Y - 72, 22).fill(0x8f98a3).stroke({ width: 5, color: 0x111318 });
      g.rect(310, GROUND_Y - 82, 40, 8).fill(0x5c646e).stroke({ width: 4, color: 0x111318 });
      g.rect(34, 40, 118, 60).fill(0xffffff).stroke({ width: 5, color: 0x111318 });
      g.moveTo(34, 70).lineTo(152, 70).stroke({ width: 4, color: 0x111318 });
      break;
    }
    case 'field': {
      gradient(g, 0x87d3f5, 0xdff3ff, 0, 156);
      g.ellipse(104, 48, 42, 18).fill(0xffffff).stroke({ width: 5, color: 0x111318 });
      g.ellipse(146, 40, 27, 15).fill(0xffffff).stroke({ width: 5, color: 0x111318 });
      g.circle(418, 44, 26).fill(0xffe27a).stroke({ width: 5, color: 0x111318 });
      band(g, 156, MEME_H - 156, 0x6fbf58);
      g.rect(0, 156, MEME_W, 5).fill(0x111318);
      g.rect(0, GROUND_Y, MEME_W, MEME_H - GROUND_Y).fill(0x5aa746);
      g.rect(56, 118, 14, GROUND_Y - 118).fill(0x8d6a3f).stroke({ width: 4, color: 0x111318 });
      g.circle(63, 108, 40).fill(0x3f9c46).stroke({ width: 5, color: 0x111318 });
      g.circle(34, 128, 26).fill(0x3f9c46).stroke({ width: 5, color: 0x111318 });
      break;
    }
    case 'void':
    default: {
      gradient(g, 0x1b1d27, 0x30344a, 0, MEME_H);
      for (let i = -6; i < 26; i++) {
        g.moveTo(i * 30, 0).lineTo(i * 30 - 90, MEME_H).stroke({ width: 2, color: 0x3d425c });
      }
      g.circle(MEME_W / 2, GROUND_Y - 6, 118).stroke({ width: 4, color: 0x474d6b });
      break;
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------------

export type RendererOptions = {
  timeline: Timeline;
  /** When set, the composed output is blitted into this canvas every frame. */
  view?: HTMLCanvasElement;
  /** Hide the caption — the projector hides it during CLASS_GUESS. */
  hideCaption?: boolean;
};

export class SceneRenderer {
  readonly output: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private app: Application;
  private stage: Container;
  private world: Container;
  private fx: Graphics;
  private actors = new Map<string, ActorView>();
  private timeline: Timeline;
  private view?: HTMLCanvasElement;
  private hideCaption: boolean;
  private raf = 0;
  private scratch: HTMLCanvasElement;
  private destroyed = false;

  private constructor(app: Application, timeline: Timeline, opts: RendererOptions) {
    this.app = app;
    this.timeline = timeline;
    this.view = opts.view;
    this.hideCaption = opts.hideCaption ?? false;
    this.stage = app.stage;
    this.world = new Container();
    this.fx = new Graphics();
    this.output = document.createElement('canvas');
    this.output.width = MEME_W;
    this.output.height = MEME_H;
    const ctx = this.output.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
    this.scratch = document.createElement('canvas');
    this.scratch.width = MEME_W;
    this.scratch.height = MEME_H;
  }

  static async create(opts: RendererOptions): Promise<SceneRenderer> {
    const app = new Application();
    await app.init({
      width: MEME_W,
      height: MEME_H,
      backgroundAlpha: 1,
      background: 0x111318,
      antialias: true,
      preserveDrawingBuffer: true,
      autoStart: false,
      resolution: 1,
    });
    app.ticker.stop();

    const r = new SceneRenderer(app, opts.timeline, opts);
    app.stage.addChild(drawBackground(opts.timeline.setting));
    app.stage.addChild(r.world);
    app.stage.addChild(r.fx);

    for (const a of opts.timeline.actors) {
      const view = await buildActor(a.sprite, a.label);
      view.id = a.id;
      r.actors.set(a.id, view);
      r.world.addChild(view.root);
    }
    r.renderAt(0);
    return r;
  }

  get durationMs(): number {
    return this.timeline.durationMs;
  }

  get frameCount(): number {
    return Math.max(2, Math.round((this.timeline.durationMs / 1000) * MEME_FPS));
  }

  setHideCaption(v: boolean) {
    this.hideCaption = v;
  }

  // -- per-frame -----------------------------------------------------------

  /** Pose everything for absolute time `tMs` and draw the raw scene. */
  private poseAndDrawScene(tMs: number): void {
    this.fx.clear();

    let shake = 0;
    let flash = 0;
    for (const imp of this.timeline.impacts) {
      const dt = tMs - imp.tMs;
      if (dt >= 0 && dt < 220) {
        const k = 1 - dt / 220;
        shake = Math.max(shake, 9 * k);
        flash = Math.max(flash, 0.5 * k * k);
        if (dt < 130) this.drawImpactBurst(imp.x * MEME_W, GROUND_Y - 70, 1 - dt / 130);
      }
    }
    this.world.position.set(
      shake ? (Math.random() - 0.5) * shake * 2 : 0,
      shake ? (Math.random() - 0.5) * shake : 0,
    );

    for (const actor of this.timeline.actors) {
      const view = this.actors.get(actor.id);
      if (!view) continue;
      const seg = segmentAt(this.timeline, actor.id, tMs);
      if (!seg) continue;
      this.poseActor(view, seg, tMs);
    }

    if (flash > 0) this.fx.rect(0, 0, MEME_W, MEME_H).fill({ color: 0xffffff, alpha: flash });

    this.app.renderer.render(this.stage);
  }

  private poseActor(view: ActorView, seg: Segment, tMs: number): void {
    const span = Math.max(1, seg.endMs - seg.startMs);
    const u = Math.min(1, Math.max(0, (tMs - seg.startMs) / span));
    // ease-out travel so actors arrive rather than slide linearly
    const travel = 1 - Math.pow(1 - u, 2);

    const x = (seg.fromX + (seg.toX - seg.fromX) * travel) * MEME_W;
    const y = GROUND_Y + (seg.fromY + (seg.toY - seg.fromY) * travel) * MEME_H;

    view.root.position.set(x, y);
    view.root.scale.x = seg.facing;

    // reset then apply
    view.inner.position.set(0, 0);
    view.inner.rotation = 0;
    view.inner.scale.set(1, 1);
    for (const key of ['head', 'arm_l', 'arm_r', 'leg_l', 'leg_r'] as const) {
      const p = view.parts[key];
      if (p && p !== view.parts.torso) p.rotation = 0;
    }
    if (view.upper) view.upper.rotation = 0;

    const clip = CLIPS_LIB[seg.clip];
    for (const track of clip.tracks) {
      const s = sampleTrack(track.keys, u);
      if (track.part === 'root') {
        view.inner.position.set(s.x, s.y);
        view.inner.rotation = s.rot;
        view.inner.scale.set(s.scale * s.scaleX, s.scale * s.scaleY);
        continue;
      }
      const target = view.parts[track.part];
      if (!target) continue;
      if (track.part === 'torso' && view.upper) {
        view.upper.rotation = s.rot;
        continue;
      }
      if (view.rig.kind === 'object') {
        // objects only have a body; fold limb-ish tracks into a wobble
        target.rotation += s.rot * 0.35;
        continue;
      }
      target.rotation = s.rot;
      if (s.scaleX !== 1) target.scale.y = s.scaleX; // limb "extend" (sprites are drawn vertically)
      else target.scale.y = 1;
    }

    if (view.label) {
      view.label.position.set(0, -(this.actorHeight(view) + 26));
      view.label.scale.x = seg.facing; // keep text readable when the rig flips
    }

    this.drawDecoration(view, seg, u, x, y);
  }

  private actorHeight(view: ActorView): number {
    return view.rig.kind === 'humanoid' ? view.rig.height : view.rig.restY + view.rig.height / 2;
  }

  private drawDecoration(view: ActorView, seg: Segment, u: number, x: number, y: number): void {
    const hx = x + view.headOffset.x * seg.facing;
    const hy = y + view.headOffset.y;

    if (seg.clip === 'think_bubble') {
      const grow = Math.min(1, u * 3);
      const bx = hx + 42 * seg.facing;
      const by = hy - 30;
      this.fx.circle(hx + 18 * seg.facing, hy - 6, 4 * grow).fill(0xffffff).stroke({ width: 2.5, color: 0x111318 });
      this.fx.circle(hx + 28 * seg.facing, hy - 16, 6 * grow).fill(0xffffff).stroke({ width: 2.5, color: 0x111318 });
      this.fx.ellipse(bx, by, 30 * grow, 20 * grow).fill(0xffffff).stroke({ width: 3.5, color: 0x111318 });
      if (grow > 0.9) {
        this.fx.moveTo(bx - 6, by - 6).quadraticCurveTo(bx + 8, by - 12, bx + 2, by + 1)
          .lineTo(bx + 2, by + 5).stroke({ width: 3.5, color: 0x111318 });
        this.fx.circle(bx + 2, by + 11, 2).fill(0x111318);
      }
    }

    if (seg.clip === 'sweat') {
      for (let i = 0; i < 3; i++) {
        const p = (u * 1.6 + i * 0.33) % 1;
        const dx = (18 + i * 9) * seg.facing;
        this.fx
          .ellipse(hx + dx, hy - 14 + p * 26, 3.5, 5.5)
          .fill(0x7ec8f2)
          .stroke({ width: 2, color: 0x111318 });
      }
    }

    if (seg.clip === 'celebrate') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + u * 3;
        this.fx
          .circle(hx + Math.cos(a) * (26 + u * 12), hy - 12 + Math.sin(a) * (20 + u * 10), 3)
          .fill([0xffd93d, 0xff6b35, 0x16c79a, 0x2e86ff, 0xe63946][i]!);
      }
    }
  }

  private drawImpactBurst(x: number, y: number, k: number): void {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r0 = 16 + (1 - k) * 26;
      const r1 = r0 + 20 * k + 8;
      this.fx
        .moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0)
        .lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
        .stroke({ width: 5 * k + 1, color: 0xffd93d });
    }
    this.fx.circle(x, y, 12 + (1 - k) * 22).stroke({ width: 5 * k + 1, color: 0xffffff });
  }

  // -- composition ---------------------------------------------------------

  /** Draw the fully composed meme frame for absolute time `tMs`. */
  renderAt(tMs: number): void {
    if (this.destroyed) return;
    const t = Math.max(0, Math.min(this.timeline.durationMs, tMs));
    const ctx = this.ctx;
    const dur = this.timeline.durationMs;

    ctx.save();
    ctx.clearRect(0, 0, MEME_W, MEME_H);

    switch (this.timeline.memeFormat) {
      case 'two_panel': {
        // top = the setup, bottom = the payoff, frozen and stacked
        this.blitFrozen(dur * 0.28, 0, 0, MEME_W, MEME_H / 2, { sx: 0, sy: 26, sh: MEME_H - 52 });
        this.blitFrozen(dur * 0.92, 0, MEME_H / 2, MEME_W, MEME_H / 2, { sx: 0, sy: 26, sh: MEME_H - 52 });
        ctx.fillStyle = '#111318';
        ctx.fillRect(0, MEME_H / 2 - 3, MEME_W, 6);
        break;
      }
      case 'before_after': {
        this.blitFrozen(0, 0, 0, MEME_W / 2, MEME_H, { sx: 84, sy: 0, sw: MEME_W - 168 });
        this.blitFrozen(dur, MEME_W / 2, 0, MEME_W / 2, MEME_H, { sx: 84, sy: 0, sw: MEME_W - 168 });
        ctx.fillStyle = '#111318';
        ctx.fillRect(MEME_W / 2 - 3, 0, 6, MEME_H);
        this.chip('ก่อน', 12, 12);
        this.chip('หลัง', MEME_W / 2 + 12, 12);
        break;
      }
      case 'reaction_zoom': {
        this.poseAndDrawScene(t);
        const imp = this.timeline.impacts[0];
        const zooming = imp !== undefined && t >= imp.tMs && t < imp.tMs + 700;
        if (zooming) {
          const focus = this.focusPoint(imp!, t);
          const zw = MEME_W / 2;
          const zh = MEME_H / 2;
          const sx = Math.max(0, Math.min(MEME_W - zw, focus.x - zw / 2));
          const sy = Math.max(0, Math.min(MEME_H - zh, focus.y - zh / 2));
          ctx.drawImage(this.app.canvas as HTMLCanvasElement, sx, sy, zw, zh, 0, 0, MEME_W, MEME_H);
          ctx.strokeStyle = '#FFD93D';
          ctx.lineWidth = 8;
          ctx.strokeRect(4, 4, MEME_W - 8, MEME_H - 8);
        } else {
          ctx.drawImage(this.app.canvas as HTMLCanvasElement, 0, 0);
        }
        break;
      }
      case 'impact_caption':
      default: {
        this.poseAndDrawScene(t);
        ctx.drawImage(this.app.canvas as HTMLCanvasElement, 0, 0);
        break;
      }
    }

    ctx.restore();

    if (!this.hideCaption && this.timeline.caption.trim()) {
      this.drawCaption(this.timeline.caption.trim());
    }

    if (this.view) {
      const vctx = this.view.getContext('2d');
      if (vctx) {
        this.view.width = MEME_W;
        this.view.height = MEME_H;
        vctx.imageSmoothingEnabled = false;
        vctx.drawImage(this.output, 0, 0);
      }
    }
  }

  private focusPoint(imp: { targetId: string | null; actorId: string; x: number }, tMs: number) {
    const id = imp.targetId ?? imp.actorId;
    const seg = segmentAt(this.timeline, id, tMs);
    const view = this.actors.get(id);
    if (!seg || !view) return { x: imp.x * MEME_W, y: GROUND_Y - 70 };
    const span = Math.max(1, seg.endMs - seg.startMs);
    const u = Math.min(1, Math.max(0, (tMs - seg.startMs) / span));
    const travel = 1 - Math.pow(1 - u, 2);
    return {
      x: (seg.fromX + (seg.toX - seg.fromX) * travel) * MEME_W,
      y: GROUND_Y + view.headOffset.y + (seg.fromY + (seg.toY - seg.fromY) * travel) * MEME_H,
    };
  }

  private blitFrozen(
    tMs: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    crop: { sx: number; sy: number; sw?: number; sh?: number },
  ) {
    this.poseAndDrawScene(Math.max(0, Math.min(this.timeline.durationMs, tMs)));
    const sw = crop.sw ?? MEME_W;
    const sh = crop.sh ?? MEME_H;
    this.ctx.drawImage(this.app.canvas as HTMLCanvasElement, crop.sx, crop.sy, sw, sh, dx, dy, dw, dh);
  }

  private chip(label: string, x: number, y: number) {
    const ctx = this.ctx;
    ctx.font = '800 20px "Noto Sans Thai", "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(label).width + 24;
    ctx.fillStyle = '#FFD93D';
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 32, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111318';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 12, y + 17);
  }

  private drawCaption(caption: string) {
    const ctx = this.ctx;
    const maxW = MEME_W - 28;
    let size = 27;
    let lines: string[] = [];
    // shrink until it fits in at most two lines
    for (; size >= 15; size -= 2) {
      ctx.font = `800 ${size}px "Noto Sans Thai", "Segoe UI", system-ui, sans-serif`;
      lines = wrapThai(ctx, caption, maxW);
      if (lines.length <= 2) break;
    }
    if (lines.length > 2) lines = [lines[0]!, `${lines[1]!}…`];

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const lineH = size * 1.24;
    const bottom = MEME_H - 12;
    lines.forEach((line, i) => {
      const y = bottom - (lines.length - 1 - i) * lineH;
      ctx.lineWidth = Math.max(6, size * 0.34);
      ctx.strokeStyle = '#111318';
      ctx.strokeText(line, MEME_W / 2, y);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(line, MEME_W / 2, y);
    });
  }

  // -- playback ------------------------------------------------------------

  play(): void {
    if (this.raf || this.destroyed) return;
    const t0 = performance.now();
    const loop = () => {
      if (this.destroyed) return;
      const t = (performance.now() - t0) % (this.timeline.durationMs + 400);
      this.renderAt(Math.min(t, this.timeline.durationMs));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Snapshot of the composed frame, for the GIF encoder. */
  frameCanvas(index: number): HTMLCanvasElement {
    const t = (index / (this.frameCount - 1)) * this.timeline.durationMs;
    this.renderAt(t);
    const sctx = this.scratch.getContext('2d')!;
    sctx.clearRect(0, 0, MEME_W, MEME_H);
    sctx.drawImage(this.output, 0, 0);
    return this.scratch;
  }

  get frameDelayMs(): number {
    return Math.round(this.timeline.durationMs / this.frameCount);
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.app.destroy(true, { children: true });
  }
}

/**
 * Thai has no spaces between words, so a space-based wrap leaves one huge line.
 * Break on spaces when they exist, otherwise fall back to character wrapping.
 */
function wrapThai(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (ctx.measureText(text).width <= maxW) return [text];

  const words = text.split(/(\s+)/).filter((s) => s.trim().length > 0);
  const lines: string[] = [];
  let current = '';

  const pushChunk = (chunk: string) => {
    const candidate = current ? `${current} ${chunk}` : chunk;
    if (ctx.measureText(candidate).width <= maxW) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    if (ctx.measureText(chunk).width <= maxW) {
      current = chunk;
      return;
    }
    // single chunk too wide (Thai run) — split by character
    let buf = '';
    for (const ch of chunk) {
      if (ctx.measureText(buf + ch).width > maxW) {
        lines.push(buf);
        buf = ch;
      } else {
        buf += ch;
      }
    }
    current = buf;
  };

  for (const w of words) pushChunk(w);
  if (current) lines.push(current);
  return lines;
}
