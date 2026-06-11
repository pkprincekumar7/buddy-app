import { useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';

// Usage: const style = useFadeIn(); → <Animated.View style={style} />

/**
 * Like useSlideUpWhenReady, but also re-plays the entrance animation every time
 * the screen gains focus (e.g. back navigation, tab re-selection).
 * Use this on screens visited multiple times (Journey, Growth, Pathway, Goals).
 */
export function useFocusEntranceAnim(
  ready: boolean,
  delay = 0,
  duration = 700,
) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  const play = useCallback(() => {
    opacity.value = 0;
    translateY.value = 24;
    const cfg = { duration, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateY.value = withDelay(delay, withTiming(0, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, duration]);

  // Initial load: play when data becomes ready
  useEffect(() => {
    if (ready) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Back/forward navigation: re-play every time screen gains focus
  useFocusEffect(
    useCallback(() => {
      if (ready) play();
    }, [ready, play]),
  );

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

export function useFadeIn(delay = 0, duration = 600) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.ease) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

export function useSlideUp(delaySeconds = 0, duration = 1000) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);
  const delayMs = delaySeconds * 1000;
  useEffect(() => {
    const cfg = { duration, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delayMs, withTiming(1, cfg));
    translateY.value = withDelay(delayMs, withTiming(0, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

/**
 * Like useSlideUp, but starts the animation only when `ready` flips to true.
 * Use this on any screen that shows a loading spinner — the animation fires
 * at the moment content becomes visible, not on mount.
 */
export function useSlideUpWhenReady(ready: boolean, delay = 0, duration = 700) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);
  useEffect(() => {
    if (!ready) return;
    const cfg = { duration, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateY.value = withDelay(delay, withTiming(0, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

export function usePageSlide(direction: 'in' | 'out' = 'in', duration = 450) {
  const opacity = useSharedValue(direction === 'in' ? 0 : 1);
  const translateX = useSharedValue(direction === 'in' ? 50 : 0);
  useEffect(() => {
    const cfg = { duration };
    opacity.value = withTiming(direction === 'in' ? 1 : 0, cfg);
    translateX.value = withTiming(direction === 'in' ? 0 : -50, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));
}

export function useModalScale(visible: boolean) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.95);
  const translateY = useSharedValue(16);
  useEffect(() => {
    const cfg = { duration: 375, easing: Easing.out(Easing.ease) };
    opacity.value = withTiming(visible ? 1 : 0, cfg);
    scale.value = withTiming(visible ? 1 : 0.95, cfg);
    translateY.value = withTiming(visible ? 0 : 16, cfg);
    // opacity/scale/translateY are Reanimated SharedValues — stable refs, safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));
}

export function useSpinner() {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 2000, easing: Easing.linear }),
      -1,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
}
