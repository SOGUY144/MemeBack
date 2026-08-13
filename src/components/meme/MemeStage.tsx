'use client';

import { useEffect, useRef, useState } from 'react';
import type { Scene } from '@/lib/ai/scene-schema';
import { compileScene } from '@/lib/meme/compile';
import type { EncodeResult } from '@/lib/meme/encode';
import type { SceneRenderer } from '@/lib/meme/renderer';

type Props = {
  scene: Scene;
  hideCaption?: boolean;
  /** Encode the meme to a file once it is on screen. Only the author does this. */
  encode?: boolean;
  onEncoded?: (result: EncodeResult) => void;
  onProgress?: (p: number) => void;
  className?: string;
};

/**
 * Live Pixi playback of a storyboard.
 *
 * The preview starts as soon as the scene arrives — students see motion long
 * before any file exists, which is what keeps the perf budget in §7.5 honest.
 * When `encode` is set, the same renderer is scrubbed frame by frame to produce
 * the GIF/MP4 in the background.
 */
export function MemeStage({
  scene,
  hideCaption = false,
  encode = false,
  onEncoded,
  onProgress,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const encodedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let renderer: SceneRenderer | null = null;

    (async () => {
      try {
        const [{ SceneRenderer: Impl }, { encodeMeme }] = await Promise.all([
          import('@/lib/meme/renderer'),
          import('@/lib/meme/encode'),
        ]);
        if (disposed || !canvasRef.current) return;

        const timeline = compileScene(scene);
        renderer = await Impl.create({
          timeline,
          view: canvasRef.current,
          hideCaption,
        });
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.play();

        if (encode && !encodedRef.current) {
          encodedRef.current = true;
          // let the preview paint a few frames before we start stealing the GPU
          await new Promise((r) => setTimeout(r, 250));
          if (disposed) return;
          renderer.stop();
          const result = await encodeMeme(renderer, { onProgress });
          if (disposed) return;
          renderer.play();
          onEncoded?.(result);
        }
      } catch (err) {
        console.error('[MemeStage] render failed:', err);
        if (!disposed) {
          setFailed(true);
          onEncoded?.(null);
        }
      }
    })();

    return () => {
      disposed = true;
      rendererRef.current = null;
      renderer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, hideCaption, encode]);

  useEffect(() => {
    rendererRef.current?.setHideCaption(hideCaption);
  }, [hideCaption]);

  if (failed) {
    return (
      <div
        className={`grid aspect-[16/9] w-full place-items-center bg-ink text-center text-sm font-black text-white ${className ?? ''}`}
      >
        เรนเดอร์มีมไม่สำเร็จ
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={270}
      className={`meme-frame ${className ?? ''}`}
      aria-label="มีมจากคำตอบ"
    />
  );
}
