import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

/**
 * Framer Motion `whileInView` + `viewport={{ once: true }}` for a scrolling
 * screen. The screen owns a <RevealProvider> and calls `notify()` from its
 * ScrollView `onScroll`; each <Reveal> checks (once per notification, until it
 * has revealed) whether it has entered the window and then transitions from
 * its `initial` style to the resting style via a Reanimated CSS transition.
 */
type Listener = () => void;
interface RevealCtx {
  subscribe: (l: Listener) => () => void;
}
const Ctx = createContext<RevealCtx>({ subscribe: () => () => undefined });

export function useRevealNotifier() {
  const listeners = useRef(new Set<Listener>());
  const notify = useCallback(() => {
    listeners.current.forEach(l => l());
  }, []);
  const value = useRef<RevealCtx>({
    subscribe: (l: Listener) => {
      listeners.current.add(l);
      return () => {
        listeners.current.delete(l);
      };
    },
  }).current;
  return { notify, value };
}

export function RevealProvider({
  value,
  children,
}: {
  value: RevealCtx;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

interface RevealProps {
  /** Web `initial` — `{ y: 20 }` or `{ scale: 0.97 }` (opacity always starts at 0). */
  y?: number;
  scale?: number;
  /** Seconds, like framer `transition.delay`. */
  delay?: number;
  /** Seconds. */
  duration?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function Reveal({
  y = 0,
  scale = 1,
  delay = 0,
  duration = 0.4,
  className,
  style,
  children,
}: RevealProps) {
  const { subscribe } = useContext(Ctx);
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const ref = useRef<View>(null);
  const [revealed, setRevealed] = useState(false);

  const check = useCallback(() => {
    ref.current?.measureInWindow((_x, top, _w, h) => {
      if (top < windowHeight && top + h > 0) setRevealed(true);
    });
  }, [windowHeight]);

  useEffect(() => {
    if (revealed) return undefined;
    return subscribe(check);
  }, [revealed, subscribe, check]);

  const hidden = !revealed && !reducedMotion;

  return (
    <Animated.View
      ref={ref}
      onLayout={check}
      className={className}
      style={[
        style,
        {
          opacity: hidden ? 0 : 1,
          transform: [
            { translateY: hidden ? y : 0 },
            { scale: hidden ? scale : 1 },
          ],
          transitionProperty: ['opacity', 'transform'],
          transitionDuration: `${duration}s`,
          transitionDelay: `${delay}s`,
          transitionTimingFunction: 'ease-out',
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
