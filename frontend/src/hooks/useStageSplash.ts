import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Returns [showSplash, startTimer].
 *
 * showSplash — true while the splash overlay should be visible.
 * startTimer — call this once the splash is ready to dismiss. After `delay`
 *              ms the splash is hidden. Pass delay=0 for video stages where
 *              the media duration already provides the hold time.
 *
 * Automatically skipped when the page was reached via a Back navigation,
 * i.e. location.state?.fromBack is truthy.
 */
export function useStageSplash(delay = 3000) {
  const location = useLocation();
  const locationState = location.state as { fromBack?: boolean } | null;
  const skipRef = useRef(!!locationState?.fromBack);
  const [showSplash, setShowSplash] = useState(() => !locationState?.fromBack);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const startTimer = useCallback(() => {
    if (skipRef.current) return;
    timerRef.current = setTimeout(() => setShowSplash(false), delay);
  }, [delay]);

  return [showSplash, startTimer] as [boolean, () => void];
}
