import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Full-screen stage image splash.
 *
 * The image fade-in animation only plays once the browser has finished
 * loading the image (onLoad / onError). At that same moment onReady() is
 * called so the parent can start its 3-second countdown timer. This
 * ensures the full 1 s fade-in → 2 s hold → 1 s fade-out sequence always
 * plays against a visible image, regardless of how long the network fetch
 * took.
 *
 * Fade-out is handled by AnimatePresence in the parent.
 * Use with: <AnimatePresence>{showSplash && <StageSplash stage={N} onReady={startTimer} />}</AnimatePresence>
 */

interface StageSplashProps {
  stage: number;
  onReady?: () => void;
}

export default function StageSplash({ stage, onReady }: StageSplashProps) {
  const padded = String(stage).padStart(2, '0');
  const [imageReady, setImageReady] = useState(false);

  const handleLoad = useCallback(() => {
    setImageReady(true);
    onReady?.();
  }, [onReady]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.0, ease: 'easeInOut' }}
      className="fixed inset-0 z-[100] bg-[#080808]"
    >
      <motion.img
        src={`/app-assets/avatars/stage-${padded}.png`}
        alt={`Stage ${stage}`}
        initial={{ opacity: 0, scale: 1.04 }}
        animate={imageReady ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.04 }}
        transition={{ duration: 1.0, ease: 'easeOut' }}
        className="h-full w-full object-contain"
        onLoad={handleLoad}
        onError={handleLoad}
      />
    </motion.div>
  );
}
