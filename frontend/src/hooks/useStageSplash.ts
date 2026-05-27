import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Returns [showSplash, startTimer].
 *
 * showSplash — true while the splash overlay should be visible.
 * startTimer — call this once the splash image has finished loading
 *              (onLoad / onError). The 3-second countdown (1 s fade-in,
 *              2 s hold, 1 s fade-out) begins from that moment so the
 *              animation always plays against a visible image.
 *
 * Automatically skipped when the page was reached via a Back navigation,
 * i.e. location.state?.fromBack is truthy.
 *
 */
export function useStageSplash() {
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
    timerRef.current = setTimeout(() => setShowSplash(false), 3000);
  }, []);

  return [showSplash, startTimer] as [boolean, () => void];
}
