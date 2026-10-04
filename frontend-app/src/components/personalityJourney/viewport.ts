import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface JourneyViewport {
  /** Viewport width (web `100vw`). */
  width: number;
  /** Viewport height (web `100vh`) — the window below the status bar, where the web header starts. */
  vh: number;
  /** Phase-1 orb radius — web `clamp(100px, 36vmin, 150px)`. */
  orbRadius: number;
}

/**
 * The web page sizes everything in vh/vmin (`calc(50vh - 64px - …)`), measured
 * from the top of the browser viewport where the 64px header sits. On RN the
 * header starts below the status bar, so the equivalent viewport is the window
 * minus the top inset; offsets inside the page then line up with the web.
 */
export function useJourneyViewport(): JourneyViewport {
  const { width, height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  return useMemo(() => {
    const vh = height - top;
    const vmin = Math.min(width, vh);
    return { width, vh, orbRadius: Math.min(150, Math.max(100, vmin * 0.36)) };
  }, [width, height, top]);
}
