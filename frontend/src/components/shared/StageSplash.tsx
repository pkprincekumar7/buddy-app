import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { readStoredDarkMode } from '@/lib/theme';

/**
 * Full-screen stage splash — image for most stages, video for stages 1, 2, and 4.
 *
 * Image lifecycle:
 *   Fades in on load, then onReady() fires so the parent starts its hold timer.
 *   Fade-out is driven by AnimatePresence in the parent.
 *
 * Video lifecycle (stages 1, 2, 4):
 *   Splash fades in (0.3s). Video element fades in when buffered (onCanPlay).
 *   Plays once unmuted. onReady() fires on end so parent can dismiss immediately
 *   (pass delay=0 to useStageSplash). Splash fades out over 0.5s.
 */

const VIDEO_STAGES = new Set([1, 2, 4]);

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
      initial={{ opacity: isVideo ? 0 : 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
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
  const [videoReady, setVideoReady] = useState(false);

  const handleEnded = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.();
  }, [onReady]);

  return (
    <video
      src={src}
      autoPlay
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
