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
 * Full-screen stage splash — image for most stages, video for stages 1, 2, 4, and 7.
 *
 * Image lifecycle:
 *   1. Dark background shown immediately.
 *   2. Image fades IN + scales down over 1 000 ms on load.
 *   3. Hold for 3 000 ms, then container fades OUT over 400 ms.
 *   4. onReady() is called after fade-out.
 *
 * Video lifecycle (stages 1, 2, 4, 7):
 *   1. Container fades IN over 300 ms (smooth entry from page).
 *   2. VideoView fades IN over 400 ms when video starts playing (masks buffering pause).
 *   3. Video plays once unmuted — duration drives timing.
 *   4. On playback finish the container fades OUT over 400 ms.
 *   5. onReady() is called after fade-out.
 */

const IMAGE_FADE_IN_MS = 1000;
const HOLD_MS = 3000;
const CONTAINER_FADE_MS = 500;
const VIDEO_FADE_IN_MS = 400;
const CONTAINER_ENTRY_MS = 500;

const VIDEO_STAGES = new Set([1, 2, 4, 7]);

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
  const videoOpacity = useSharedValue(0);
  const videoStyle = useAnimatedStyle(() => ({ opacity: videoOpacity.value }));

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

  // Fade in the video when it starts playing — masks buffering pause
  player.addListener('playingChange', ({ isPlaying }) => {
    if (isPlaying) {
      videoOpacity.value = withTiming(1, {
        duration: VIDEO_FADE_IN_MS,
        easing: Easing.out(Easing.ease),
      });
    }
  });

  // Fire fade-out when playback reaches the end
  player.addListener('playToEnd', fadeOutAndNotify);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, videoStyle]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
    </Animated.View>
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

  // Video stages fade the container in to mask buffering pause.
  // Image stages start at full opacity — the image element handles its own fade-in.
  const containerOpacity = useSharedValue(isVideo ? 0 : 1);
  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  if (isVideo) {
    containerOpacity.value = withTiming(1, {
      duration: CONTAINER_ENTRY_MS,
      easing: Easing.out(Easing.ease),
    });
  }

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
