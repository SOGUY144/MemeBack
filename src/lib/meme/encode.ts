'use client';

import { MEME_FPS, MEME_H, MEME_W, type SceneRenderer } from '@/lib/meme/renderer';

/**
 * Turns a posed timeline into a file.
 *
 * WebCodecs gives a much smaller, cleaner MP4 where it exists; everywhere else
 * we fall back to gif.js in a worker. Either way the encode is on a deadline —
 * §7.5 says a meme that takes longer than 8s stops being a file and becomes a
 * live Pixi playback instead, so the room never waits on one slow device.
 */

export const ENCODE_DEADLINE_MS = 8_000;

export type EncodeResult = { bytes: ArrayBuffer; mime: string } | null;

export async function encodeMeme(
  renderer: SceneRenderer,
  opts: { deadlineMs?: number; onProgress?: (p: number) => void } = {},
): Promise<EncodeResult> {
  const deadline = opts.deadlineMs ?? ENCODE_DEADLINE_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadline);
  });

  const abort = { cancelled: false };
  const work = (async (): Promise<EncodeResult> => {
    if (await mp4Supported()) {
      try {
        return await encodeMp4(renderer, abort, opts.onProgress);
      } catch (err) {
        console.warn('[encode] mp4 path failed, falling back to gif:', err);
      }
    }
    return encodeGif(renderer, abort, opts.onProgress);
  })();

  try {
    const result = await Promise.race([work, expired]);
    if (result === null) abort.cancelled = true;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// WebCodecs → MP4
// ---------------------------------------------------------------------------

const AVC_CODEC = 'avc1.4d001f'; // Main profile, level 3.1 — plays everywhere

async function mp4Supported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // Escape hatch for testing the gif.js path on a browser that has WebCodecs:
  //   localStorage['memeback:force-gif'] = '1'
  try {
    if (localStorage.getItem('memeback:force-gif') === '1') return false;
  } catch {
    /* private mode */
  }
  if (typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') return false;
  try {
    const res = await VideoEncoder.isConfigSupported({
      codec: AVC_CODEC,
      width: MEME_W,
      height: MEME_H,
      framerate: MEME_FPS,
    });
    return Boolean(res.supported);
  } catch {
    return false;
  }
}

async function encodeMp4(
  renderer: SceneRenderer,
  abort: { cancelled: boolean },
  onProgress?: (p: number) => void,
): Promise<EncodeResult> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: MEME_W, height: MEME_H },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => console.error('[encode] VideoEncoder error:', err),
  });

  encoder.configure({
    codec: AVC_CODEC,
    width: MEME_W,
    height: MEME_H,
    framerate: MEME_FPS,
    bitrate: 1_400_000,
  });

  const frames = renderer.frameCount;
  const frameUs = Math.round(1_000_000 / MEME_FPS);

  for (let i = 0; i < frames; i++) {
    if (abort.cancelled) {
      encoder.close();
      return null;
    }
    const canvas = renderer.frameCanvas(i);
    const frame = new VideoFrame(canvas, { timestamp: i * frameUs, duration: frameUs });
    encoder.encode(frame, { keyFrame: i % MEME_FPS === 0 });
    frame.close();
    onProgress?.((i + 1) / frames);
    if (i % 5 === 4) await yieldToBrowser();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  return { bytes: target.buffer, mime: 'video/mp4' };
}

// ---------------------------------------------------------------------------
// gif.js fallback
// ---------------------------------------------------------------------------

async function encodeGif(
  renderer: SceneRenderer,
  abort: { cancelled: boolean },
  onProgress?: (p: number) => void,
): Promise<EncodeResult> {
  const GIF = (await import('gif.js')).default;

  const gif = new GIF({
    workers: 2,
    quality: 10,
    dither: false,
    width: MEME_W,
    height: MEME_H,
    workerScript: '/gif.worker.js',
    repeat: 0, // loop forever
  });

  const frames = renderer.frameCount;
  const delay = renderer.frameDelayMs;

  for (let i = 0; i < frames; i++) {
    if (abort.cancelled) return null;
    gif.addFrame(renderer.frameCanvas(i), { copy: true, delay });
    onProgress?.(((i + 1) / frames) * 0.5);
    if (i % 5 === 4) await yieldToBrowser();
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    gif.on('progress', (p) => onProgress?.(0.5 + p * 0.5));
    gif.on('finished', (b) => resolve(b));
    gif.on('abort', () => resolve(null));
    try {
      gif.render();
    } catch (err) {
      console.error('[encode] gif.js render failed:', err);
      resolve(null);
    }
  });

  if (!blob || abort.cancelled) return null;
  return { bytes: await blob.arrayBuffer(), mime: 'image/gif' };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
