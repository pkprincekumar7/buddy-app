import React from 'react';
import Animated from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';
import { SPINNER } from '@/lib/animations';
import { cn } from '@/lib/utils';

interface SpinnerProps {
  className?: string;
  /** Overrides SPINNER's default 2s rotation — some loading states want a faster spin. */
  durationSeconds?: number;
  /** Overrides the default `border-primary` ring color, e.g. for a page-specific token. */
  style?: StyleProp<ViewStyle>;
}

/** web: h-10 w-10 rounded-full border-2 border-primary border-t-transparent, rotating. */
export default function Spinner({
  className,
  durationSeconds,
  style,
}: SpinnerProps) {
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      className={cn(
        'h-10 w-10 rounded-full border-2 border-primary border-t-transparent',
        className,
      )}
      style={[
        SPINNER,
        durationSeconds ? { animationDuration: `${durationSeconds}s` } : null,
        style,
      ]}
    />
  );
}
