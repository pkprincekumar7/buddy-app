import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HEADER_HEIGHT } from '@/components/layout/AppHeader';

export interface JourneyViewport {
  /** Viewport width (web `100vw`). */
  width: number;
  /** Viewport height (web `100vh`) — the window below the status bar, where the web header starts. */
  vh: number;
  /** Phase-1 orb radius — 36vmin, 100 to 220pt (web ORB_MAX_RADIUS). */
  orbRadius: number;
  /** How far the window's centre lies below the top of the page (just under the app bar),
   *  where the warp's stars start: the orb and the circles' hub are centred there. */
  centerY: number;
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
    return {
      width,
      vh,
      // Up to 220pt (web ORB_MAX_RADIUS): the room the heading leaves decides the rest.
      orbRadius: Math.min(220, Math.max(100, vmin * 0.36)),
      centerY: height / 2 - top - HEADER_HEIGHT,
    };
  }, [width, height, top]);
}
