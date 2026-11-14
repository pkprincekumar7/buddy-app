import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Full-screen stage splash — image for most stages, video for stages 1, 2, 4, and 7.
 *
 * Image lifecycle:
 *   Fades in on load, then onReady() fires so the parent starts its hold timer.
 *   Fade-out is driven by AnimatePresence in the parent.
 *
 * Video lifecycle (stages 1, 2, 4, 7):
 *   Splash fades in (0.3s). Video element fades in when buffered (onCanPlay).
 *   Plays once unmuted. onReady() fires on end so parent can dismiss immediately
 *   (pass delay=0 to useStageSplash). Splash fades out over 0.5s.
 */

const VIDEO_STAGES = new Set([1, 2, 4, 7]);

interface StageSplashProps {
  stage: number;
  /** Discover's portal (the prototype's): the video tinted, with a cyan glow over it, and
   *  onReady fires 3 s after it shows even if it runs longer. Fitted like every stage video
   *  (not the prototype's cover, which zooms it). */
  portal?: boolean;
  onReady?: () => void;
}

/** How long the Discover portal plays before it moves on. */
const PORTAL_MS = 3000;

export default function StageSplash({ stage, portal = false, onReady }: StageSplashProps) {
  const padded = String(stage).padStart(2, '0');
  const isVideo = VIDEO_STAGES.has(stage);
  const theme = 'dark';

  return (
    <motion.div
      initial={{ opacity: isVideo ? 0 : 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className="fixed inset-0 z-[100] bg-background"
    >
      {isVideo ? (
        <VideoSplash
          src={`/app-assets/avatars/stage-${padded}-${theme}.mp4`}
          portal={portal}
          onReady={onReady}
        />
      ) : (
        <ImageSplash
          src={`/app-assets/avatars/stage-${padded}-${theme}.png`}
          stage={stage}
          onReady={onReady}
        />
      )}
    </motion.div>
  );
}

// ─── Video variant ────────────────────────────────────────────────────────────

function VideoSplash({
  src,
  portal,
  onReady,
}: {
  src: string;
  portal: boolean;
  onReady?: () => void;
}) {
  const firedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  const handleEnded = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.();
  }, [onReady]);

  // Unmuted autoplay is frequently blocked by the browser (most reliably on a
  // plain page load/refresh, rather than after in-app navigation) — a blocked
  // `autoPlay` attribute never fires `ended` or `error`, so onReady would
  // never fire and the caller's content stays hidden forever. Calling .play()
  // explicitly surfaces that as a rejected promise, so a block can fall back
  // to skipping the splash immediately instead of hanging.
  useEffect(() => {
    videoRef.current?.play().catch((err: unknown) => {
      console.warn('[StageSplash] Autoplay blocked, skipping splash:', err);
      handleEnded();
    });
  }, [handleEnded]);

  // The portal moves on 3 s after the video shows, as the prototype's does, however long the
  // video is. Counted from then, not from mount: a slow load would otherwise use up the 3 s
  // before anything is seen.
  useEffect(() => {
    if (!portal || !videoReady) return;
    const id = setTimeout(handleEnded, PORTAL_MS);
    return () => clearTimeout(id);
  }, [portal, videoReady, handleEnded]);

  const video = (
    <video
      ref={videoRef}
      src={src}
      preload="auto"
      muted={false}
      playsInline
      onCanPlay={() => setVideoReady(true)}
      onEnded={handleEnded}
      onError={handleEnded}
      style={{
        opacity: videoReady ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}
      className={cn('h-full w-full object-contain', portal && 'stage-portal-video')}
    />
  );
  if (!portal) return video;
  return (
    <>
      {video}
      <div className="stage-portal-glow" aria-hidden="true" />
    </>
  );
}

// ─── Image variant ────────────────────────────────────────────────────────────

function ImageSplash({
  src,
  stage,
  onReady,
}: {
  src: string;
  stage: number;
  onReady?: () => void;
}) {
  const [imageReady, setImageReady] = useState(false);

  const handleLoad = useCallback(() => {
    setImageReady(true);
    onReady?.();
  }, [onReady]);

  return (
    <motion.img
      src={src}
      alt={`Stage ${stage}`}
      initial={{ opacity: 0, scale: 1.04 }}
      animate={imageReady ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.04 }}
      transition={{ duration: 1.0, ease: 'easeOut' }}
      className="h-full w-full object-contain"
      onLoad={handleLoad}
      onError={handleLoad}
    />
  );
}
