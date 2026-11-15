import React, { useRef, useState } from 'react';
import {
  Platform,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { cn } from '@/lib/utils';
import Spinner from './Spinner';

/** The spinner's appearance: transparent, then a .3s fade after .3s. */
const SPIN_IN = {
  opacity: 0,
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: '0.3s',
  animationDelay: '0.3s',
  animationTimingFunction: 'ease',
  animationFillMode: 'both',
} as const;

interface PageLoaderProps {
  /** The page's background and size (defaults: the app background, the rest of the screen). */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** The spinner's own look, for a page with its own colours. */
  spinnerClassName?: string;
  spinnerStyle?: StyleProp<ViewStyle>;
  durationSeconds?: number;
}

/**
 * The standard "page is loading" state (web components/shared/PageLoader): its spinner on the
 * window's centre, wherever the loader starts (under the app bar, the Back row or a page's own
 * header), so it sits where the journey's orb and hub do. The loader measures where it is on
 * screen; the spinner shows once it's placed.
 */
export default function PageLoader({
  className,
  style,
  spinnerClassName,
  spinnerStyle,
  durationSeconds,
}: PageLoaderProps) {
  const ref = useRef<View>(null);
  const { height } = useWindowDimensions();
  // Android's measureInWindow leaves out the status bar (iOS's counts it), so it's added back.
  const insets = useSafeAreaInsets();
  const statusBar = Platform.OS === 'android' ? insets.top : 0;
  const [top, setTop] = useState<number | null>(null);
  const reduced = useReducedMotion();
  return (
    <View
      ref={ref}
      className={cn('flex-1 bg-background', className)}
      style={style}
      onLayout={() =>
        ref.current?.measureInWindow((_x, y) => setTop(y + statusBar))
      }
    >
      {/* A zero-height row on the window's centre line centres the spinner on it. It shows
          after .3s (web .page-loader-spin): a quick load goes straight to the page. */}
      <Animated.View
        className="absolute left-0 right-0 h-0 items-center justify-center"
        style={[
          { top: top === null ? 0 : height / 2 - top },
          top === null ? { opacity: 0 } : reduced ? { opacity: 1 } : SPIN_IN,
        ]}
      >
        <Spinner
          className={spinnerClassName}
          style={spinnerStyle}
          durationSeconds={durationSeconds}
        />
      </Animated.View>
    </View>
  );
}
