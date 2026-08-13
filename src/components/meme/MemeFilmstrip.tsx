'use client';

import { useEffect, useRef } from 'react';
import type { Scene } from '@/lib/ai/scene-schema';
import { compileScene } from '@/lib/meme/compile';
import { MEME_H, MEME_W, type SceneRenderer } from '@/lib/meme/renderer';

type Props = { scene: Scene; frames?: number; className?: string };

/**
 * Renders N evenly spaced frames of a storyboard side by side.
 *
 * Unlike the live preview this never touches requestAnimationFrame, so it shows
 * the actual motion in a paused tab, a headless browser or a screenshot — which
 * is exactly what you need when checking a clip or the timeline compiler.
 */
export function MemeFilmstrip({ scene, frames = 6, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let renderer: SceneRenderer | null = null;

    (async () => {
      const { SceneRenderer: Impl } = await import('@/lib/meme/renderer');
      if (disposed || !ref.current) return;

      const timeline = compileScene(scene);
      renderer = await Impl.create({ timeline });
      if (disposed) {
        renderer.destroy();
        return;
      }

      const canvas = ref.current;
      canvas.width = MEME_W * frames;
      canvas.height = MEME_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      for (let i = 0; i < frames; i++) {
        const t = (i / (frames - 1)) * timeline.durationMs;
        renderer.renderAt(t);
        ctx.drawImage(renderer.output, i * MEME_W, 0);
        ctx.strokeStyle = '#111318';
        ctx.lineWidth = 4;
        ctx.strokeRect(i * MEME_W, 0, MEME_W, MEME_H);
        ctx.font = '900 22px system-ui, sans-serif';
        ctx.fillStyle = '#FFD93D';
        ctx.strokeStyle = '#111318';
        ctx.lineWidth = 5;
        ctx.strokeText(`${Math.round(t)}ms`, i * MEME_W + 12, 30);
        ctx.fillText(`${Math.round(t)}ms`, i * MEME_W + 12, 30);
      }

      renderer.destroy();
      renderer = null;
    })();

    return () => {
      disposed = true;
      renderer?.destroy();
    };
  }, [scene, frames]);

  return <canvas ref={ref} className={`w-full ${className ?? ''}`} />;
}
