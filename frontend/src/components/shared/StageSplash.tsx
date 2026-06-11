import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { readStoredDarkMode } from '@/lib/theme';

/**
 * Full-screen stage splash — image for most stages, video for stages 2 and 4.
 *
 * Image lifecycle:
 *   Fades in on load, then onReady() fires so the parent starts its hold timer.
 *   Fade-out is driven by AnimatePresence in the parent.
 *
 * Video lifecycle (stages 2 and 4):
 *   Plays the .mp4 once (no loop, unmuted). onReady() fires when playback ends
 *   so the parent can dismiss immediately (pass delay=0 to useStageSplash).
 *   Fade-out is still driven by AnimatePresence in the parent.
 *
 * Use with:
 *   const [showSplash, startTimer] = useStageSplash(isVideoStage ? 0 : 3000);
 *   <AnimatePresence>{showSplash && <StageSplash stage={N} onReady={startTimer} />}</AnimatePresence>
 */

const VIDEO_STAGES = new Set([2, 4]);

interface StageSplashProps {
  stage: number;
  onReady?: () => void;
}

export default function StageSplash({ stage, onReady }: StageSplashProps) {
  const padded = String(stage).padStart(2, '0');
  const isVideo = VIDEO_STAGES.has(stage);
  const [isDark, setIsDark] = useState(readStoredDarkMode);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains('light'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const theme = isDark ? 'dark' : 'light';

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.0, ease: 'easeInOut' }}
      className="fixed inset-0 z-[100] bg-background"
    >
      {isVideo ? (
        <VideoSplash src={`/app-assets/avatars/stage-${padded}-${theme}.mp4`} onReady={onReady} />
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

function VideoSplash({ src, onReady }: { src: string; onReady?: () => void }) {
  const firedRef = useRef(false);

  const handleEnded = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.();
  }, [onReady]);

  return (
    <video
      src={src}
      autoPlay
      muted={false}
      playsInline
      onEnded={handleEnded}
      // Fallback: if video fails to load, dismiss immediately so the user isn't stuck
      onError={handleEnded}
      className="h-full w-full object-contain"
    />
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
