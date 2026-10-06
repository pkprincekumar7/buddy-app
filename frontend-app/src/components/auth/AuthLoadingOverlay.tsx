import React from 'react';
import { Text } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { MODAL_BACKDROP } from '@/lib/animations';
import DualRingSpinner from '@/components/shared/DualRingSpinner';

// web: initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4, ease: 'easeOut' }}
const MESSAGE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 8 }] },
  100: {
    opacity: 1,
    transform: [{ translateY: 0 }],
    easing: Easing.out(Easing.ease),
  },
})
  .duration(400)
  .delay(150);

/**
 * Full-screen loading overlay shown during sign-in — web
 * `fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background/95`
 * (backdrop-blur dropped). Render it conditionally; it fades in/out on mount/unmount.
 */
export default function AuthLoadingOverlay({ message }: { message: string }) {
  return (
    <Animated.View
      {...MODAL_BACKDROP}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      className="absolute inset-0 z-50 items-center justify-center gap-8 bg-background/95"
    >
      <DualRingSpinner />
      <Animated.View entering={MESSAGE_IN} className="items-center gap-1">
        <Text className="text-center text-base font-semibold text-foreground">
          {message}
        </Text>
        <Text className="text-center text-sm text-muted-foreground">
          Please wait a moment…
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
