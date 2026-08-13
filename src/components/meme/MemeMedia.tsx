'use client';

import type { Scene } from '@/lib/ai/scene-schema';
import { MemeStage } from '@/components/meme/MemeStage';

type Props = {
  memeUrl: string | null;
  scene: Scene;
  hideCaption?: boolean;
  className?: string;
};

/**
 * Shows the encoded file when one exists, and plays the scene live when it does
 * not — a device that blew the 8s encode budget still gets its meme on screen.
 */
export function MemeMedia({ memeUrl, scene, hideCaption = false, className }: Props) {
  if (!memeUrl) {
    return <MemeStage scene={scene} hideCaption={hideCaption} className={className} />;
  }

  if (memeUrl.endsWith('.mp4')) {
    return (
      <video
        src={memeUrl}
        className={`meme-frame ${className ?? ''}`}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={memeUrl} alt="มีมจากคำตอบ" className={`meme-frame ${className ?? ''}`} />;
}
