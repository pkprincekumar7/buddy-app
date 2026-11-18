import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react';
import type { ScrollView, View } from 'react-native';

/**
 * Stops a scroll view scrolling while a game follows the child's finger.
 *
 * A drag game claims the finger from JS (`keepTouch`), but that claim reaches Android a beat
 * later: on a busy phone the finger can pass the touch slop first, and the native scroll view
 * takes the stroke anyway. With `scrollEnabled` off it never tries, so the game owns every
 * drag. The page can't be scrolled by hand meanwhile, so the game is scrolled into view first.
 */
export interface ScrollLock {
  /** Locks the scroll view, after scrolling `target`'s bottom into view; returns the release. */
  lock: (target: View | null) => () => void;
}

const ScrollLockContext = createContext<ScrollLock | null>(null);
export const ScrollLockProvider = ScrollLockContext.Provider;

/** For a scroll view's owner: `locked` goes to `scrollEnabled`, `value` to the provider.
 * `bottomPad`: the room kept under a revealed game (the home indicator's). */
export function useScrollLockHost(
  scroll: RefObject<ScrollView | null>,
  bottomPad = 0,
) {
  const [holds, setHolds] = useState(0);
  const lock = useCallback(
    (target: View | null) => {
      setHolds(n => n + 1);
      if (target && scroll.current) reveal(scroll.current, target, bottomPad);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        setHolds(n => n - 1);
      };
    },
    [scroll, bottomPad],
  );
  const value = useMemo(() => ({ lock }), [lock]);
  return { locked: holds > 0, value };
}

/** Scrolls down just enough that `target`'s bottom is `bottomPad` above the scroll view's.
 * The offset is the scroll view's top less its content's, both in window points. */
function reveal(scroll: ScrollView, target: View, bottomPad: number) {
  const native = scroll.getNativeScrollRef();
  // ScrollView has getInnerViewRef (ScrollView.js), though its .d.ts leaves it out.
  const inner = (
    scroll as unknown as { getInnerViewRef?: () => View | null }
  ).getInnerViewRef?.();
  if (!native || !inner) return;
  native.measureInWindow((_sx, top, _sw, height) =>
    inner.measureInWindow((_ix, contentTop) =>
      target.measureInWindow((_tx, y, _tw, h) => {
        const over = y + h - (top + height - bottomPad);
        if (over > 0)
          scroll.scrollTo({ y: top - contentTop + over, animated: true });
      }),
    ),
  );
}

/** For a game that follows a finger: locks the nearest scroll view while it's mounted, with
 * `target` (the game's box) scrolled into view. No scroll view, no lock. */
export function useLockScroll(target: RefObject<View | null>) {
  const lock = useContext(ScrollLockContext)?.lock;
  useEffect(() => lock?.(target.current), [lock, target]);
}
