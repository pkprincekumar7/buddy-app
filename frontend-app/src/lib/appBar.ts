import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Whether the app bar and its Back row are hidden (web lib/appBar): while a stage splash plays (a
 * circle's avatar video, Discover's portal) and during the journey's warp, nothing of the page
 * chrome shows; it comes back with the page. A count, so overlapping holders (the warp, then a
 * splash) don't bring it back early.
 */
let holders = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True while anything is hiding the app bar. */
export function useAppBarHidden(): boolean {
  return useSyncExternalStore(subscribe, () => holders > 0);
}

/** Hides the app bar while `active`: before the frame is drawn, so a page that opens behind a
 *  splash never shows its bar first. */
export function useHideAppBar(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    holders += 1;
    emit();
    return () => {
      holders -= 1;
      emit();
    };
  }, [active]);
}

/** The bar's style for `hidden`: gone at once, back over .5s (web .app-bar-hidden). */
export const appBarFade = (hidden: boolean, reduced: boolean) => ({
  opacity: hidden ? 0 : 1,
  transitionProperty: 'opacity' as const,
  transitionDuration: hidden || reduced ? 0 : 500,
});
