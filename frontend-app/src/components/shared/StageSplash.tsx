import React, { useCallback, useRef } from 'react';
import { Image, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
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
 * Full-screen stage splash — image for most stages, video for stages 2 and 4.
 *
 * Image lifecycle:
 *   1. Dark background shown immediately.
 *   2. Image fades IN + scales down over 1 000 ms on load.
 *   3. Hold for 3 000 ms, then container fades OUT over 600 ms.
 *   4. onReady() is called after fade-out.
 *
 * Video lifecycle (stages 2 and 4):
 *   1. Dark background shown immediately.
 *   2. Video plays once from the CDN url (no hold timer — duration drives timing).
 *   3. On playback finish the container fades OUT over 600 ms.
 *   4. onReady() is called after fade-out.
 */

const IMAGE_FADE_IN_MS = 1000;
const HOLD_MS = 3000;
const CONTAINER_FADE_MS = 600;

const VIDEO_STAGES = new Set([2, 4]);

interface StageSplashProps {
  stage: number;
  onReady?: () => void;
}

// ─── Video variant ────────────────────────────────────────────────────────────

function VideoSplash({
  uri,
  containerOpacity,
  onReady,
}: {
  uri: string;
  containerOpacity: ReturnType<typeof useSharedValue<number>>;
  onReady?: () => void;
}) {
  const firedRef = useRef(false);

  const fadeOutAndNotify = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const notify = onReady ?? (() => {});
    containerOpacity.value = withTiming(
      0,
      { duration: CONTAINER_FADE_MS, easing: Easing.in(Easing.ease) },
      finished => {
        if (finished) runOnJS(notify)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const player = useVideoPlayer(uri, p => {
    p.loop = false;
    p.muted = false;
    p.play();
  });

  // Fire fade-out when playback reaches the end
  player.addListener('playToEnd', fadeOutAndNotify);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

// ─── Image variant ────────────────────────────────────────────────────────────

function ImageSplash({
  uri,
  containerOpacity,
  onReady,
}: {
  uri: string;
  containerOpacity: ReturnType<typeof useSharedValue<number>>;
  onReady?: () => void;
}) {
  const imgOpacity = useSharedValue(0);
  const imgScale = useSharedValue(1.04);
  const imgStyle = useAnimatedStyle(() => ({
    opacity: imgOpacity.value,
    transform: [{ scale: imgScale.value }],
  }));

  const handleLoad = useCallback(() => {
    const fadeIn = {
      duration: IMAGE_FADE_IN_MS,
      easing: Easing.out(Easing.ease),
    };
    imgOpacity.value = withTiming(1, fadeIn);
    imgScale.value = withTiming(1, fadeIn);

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
    <Animated.View style={[StyleSheet.absoluteFill, imgStyle]}>
      <Image
        source={{ uri }}
        style={styles.image}
        resizeMode="contain"
        onLoad={handleLoad}
        onError={handleLoad}
      />
    </Animated.View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StageSplash({ stage, onReady }: StageSplashProps) {
  const { colors, isDark } = useTheme();
  const padded = String(stage).padStart(2, '0');
  const isVideo = VIDEO_STAGES.has(stage);
  const ext = isVideo ? 'mp4' : 'png';
  const uri = `${env.CDN_BASE_URL}/app-assets/avatars/stage-${padded}-${
    isDark ? 'dark' : 'light'
  }.${ext}`;

  const containerOpacity = useSharedValue(1);
  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        { backgroundColor: colors.background },
        containerStyle,
      ]}
    >
      {isVideo ? (
        <VideoSplash
          uri={uri}
          containerOpacity={containerOpacity}
          onReady={onReady}
        />
      ) : (
        <ImageSplash
          uri={uri}
          containerOpacity={containerOpacity}
          onReady={onReady}
        />
      )}
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
