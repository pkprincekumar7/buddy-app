import React, { useCallback } from 'react';
import { Image, StyleSheet } from 'react-native';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/ThemeContext';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

/**
 * Full-screen stage image splash — mirrors web StageSplash exactly.
 *
 * Lifecycle (fully self-contained):
 *   1. Dark #080808 background is shown immediately on mount.
 *   2. Once the image finishes loading (onLoad / onError):
 *      a. Image fades IN + scales down over 1 000 ms.
 *      b. After a 3 000 ms hold the entire container fades OUT over 600 ms.
 *      c. onReady() is called at the END of the fade-out so the parent can
 *         unmount this component and start the page entrance animation.
 *
 * The parent pattern is:
 *   const [showSplash, dismiss] = useStageSplash();
 *   {showSplash && <StageSplash stage={N} onReady={dismiss} />}
 *
 * onReady fires only after the visual fade-out is complete, so there is no
 * abrupt pop and no overlap between the splash disappearing and the content
 * appearing.
 */

const IMAGE_FADE_IN_MS = 1000;
const HOLD_MS = 3000;
const CONTAINER_FADE_MS = 600;

interface StageSplashProps {
  stage: number;
  onReady?: () => void; // called after the container has fully faded out
}

export default function StageSplash({ stage, onReady }: StageSplashProps) {
  const { colors, isDark } = useTheme();
  const padded = String(stage).padStart(2, '0');

  // Image: starts invisible + slightly zoomed in, fades in on load
  const imgOpacity = useSharedValue(0);
  const imgScale = useSharedValue(1.04);
  const imgStyle = useAnimatedStyle(() => ({
    opacity: imgOpacity.value,
    transform: [{ scale: imgScale.value }],
  }));

  // Container: starts fully opaque, fades to 0 before onReady is called
  const containerOpacity = useSharedValue(1);
  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  // Called once the image has loaded (or failed to load).
  // Starts the fade-in animation and then schedules the fade-out.
  const handleLoad = useCallback(() => {
    // 1. Fade image IN
    const fadeIn = {
      duration: IMAGE_FADE_IN_MS,
      easing: Easing.out(Easing.ease),
    };
    imgOpacity.value = withTiming(1, fadeIn);
    imgScale.value = withTiming(1, fadeIn);

    // 2. After HOLD_MS, fade the whole container OUT, then fire onReady
    const notify = onReady ?? (() => {});
    containerOpacity.value = withDelay(
      HOLD_MS,
      withTiming(
        0,
        { duration: CONTAINER_FADE_MS, easing: Easing.in(Easing.ease) },
        finished => {
          if (finished) runOnJS(notify)();
        },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Outer animated wrapper handles the full-screen fade-out
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        { backgroundColor: colors.background },
        containerStyle,
      ]}
    >
      {/* Inner wrapper handles the image fade-in + scale */}
      <Animated.View style={[StyleSheet.absoluteFill, imgStyle]}>
        <Image
          source={{
            uri: `${env.CDN_BASE_URL}/app-assets/avatars/stage-${padded}-${
              isDark ? 'dark' : 'light'
            }.png`,
          }}
          style={styles.image}
          resizeMode="contain"
          onLoad={handleLoad}
          onError={handleLoad}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 100,
    elevation: 100,
  },
  image: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
