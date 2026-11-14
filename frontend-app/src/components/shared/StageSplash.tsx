import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { rgb } from '@/theme';
import { Portal } from '@/components/ui/portal';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { env } from '@/lib/env';

/**
 * Full-screen stage splash — image for most stages, video for stages 1, 2, 4, and 7.
 * Same lifecycle as the web StageSplash:
 *
 * Image: fades in (+ 1.04 → 1 scale, 1s) on load, then onReady() fires so the
 *   parent starts its hold timer (useStageSplash). The parent unmounts the
 *   splash to dismiss it, and the exiting animation fades it out (0.5s).
 * Video: the splash fades in (0.5s); the video fades in once playing, plays
 *   once unmuted, and onReady() fires on end (pass delay=0 to useStageSplash).
 */

const VIDEO_STAGES = new Set([1, 2, 4, 7]);
const easeInOut = Easing.inOut(Easing.ease);

const CONTAINER_IN = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1, easing: easeInOut },
}).duration(500);
const CONTAINER_OUT = new Keyframe({
  0: { opacity: 1 },
  100: { opacity: 0, easing: easeInOut },
}).duration(500);

interface StageSplashProps {
  stage: number;
  /** Discover's portal (web, the prototype's): the video tinted (Android; React Native's
   *  `filter` is Android-only), with a cyan glow over it, and onReady fires 3 s after it shows
   *  even if it runs longer. Fitted like every stage video (not the prototype's cover, which
   *  zooms it). */
  portal?: boolean;
  onReady?: () => void;
}

/** How long the Discover portal plays before it moves on. */
const PORTAL_MS = 3000;

export default function StageSplash({
  stage,
  portal = false,
  onReady,
}: StageSplashProps) {
  const padded = String(stage).padStart(2, '0');
  const isVideo = VIDEO_STAGES.has(stage);
  const theme = 'dark';
  const base = `${env.CDN_BASE_URL}/app-assets/avatars/stage-${padded}-${theme}`;

  // A Portal, like the web's `fixed inset-0 z-[100]`: the splash covers the
  // Layout header too, not just the screen body. The exiting fade plays when
  // the parent unmounts the splash.
  return (
    <Portal>
      <Animated.View
        entering={isVideo ? CONTAINER_IN : undefined}
        exiting={CONTAINER_OUT}
        className="flex-1 bg-background"
      >
        {isVideo ? (
          <VideoSplash uri={`${base}.mp4`} portal={portal} onReady={onReady} />
        ) : (
          <ImageSplash uri={`${base}.png`} stage={stage} onReady={onReady} />
        )}
      </Animated.View>
    </Portal>
  );
}

/** web .stage-portal-video's tint (applied on Android) and .stage-portal-glow. */
const PORTAL_TINT = {
  filter: [{ hueRotate: '-8deg' }, { saturate: 1.15 }, { contrast: 1.05 }],
} as const;
const PORTAL_GLOW = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  experimental_backgroundImage: `radial-gradient(circle at 50% 50%, ${rgb(
    'constellation-cyan',
    0.1,
  )}, ${rgb('constellation-void-deep', 0.75)} 78%)`,
  mixBlendMode: 'screen',
} as const;

function VideoSplash({
  uri,
  portal,
  onReady,
}: {
  uri: string;
  portal: boolean;
  onReady?: () => void;
}) {
  const firedRef = useRef(false);
  const [videoReady, setVideoReady] = useState(false);

  const handleEnded = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.();
  }, [onReady]);

  const player = useVideoPlayer(uri, p => {
    p.loop = false;
    p.muted = false;
    p.play();
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (isPlaying) setVideoReady(true);
  });
  useEventListener(player, 'playToEnd', handleEnded);
  // A failed load would otherwise leave the caller's content hidden forever (web: onError).
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') handleEnded();
  });
  // The portal moves on 3 s after the video shows, as the prototype's does, however long the
  // video is. Counted from then, not from mount: a slow load would otherwise use up the 3 s
  // before anything is seen.
  useEffect(() => {
    if (!portal || !videoReady) return;
    const id = setTimeout(handleEnded, PORTAL_MS);
    return () => clearTimeout(id);
  }, [portal, videoReady, handleEnded]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: videoReady ? 1 : 0,
          transitionProperty: 'opacity',
          transitionDuration: '0.4s',
        },
      ]}
    >
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, portal && PORTAL_TINT]}
        contentFit="contain"
        nativeControls={false}
      />
      {portal ? <View pointerEvents="none" style={PORTAL_GLOW} /> : null}
    </Animated.View>
  );
}

function ImageSplash({
  uri,
  stage,
  onReady,
}: {
  uri: string;
  stage: number;
  onReady?: () => void;
}) {
  const [imageReady, setImageReady] = useState(false);
  const firedRef = useRef(false);

  const handleLoad = useCallback(() => {
    setImageReady(true);
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.();
  }, [onReady]);

  useEffect(() => () => void (firedRef.current = true), []);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: imageReady ? 1 : 0,
          transform: [{ scale: imageReady ? 1 : 1.04 }],
          transitionProperty: ['opacity', 'transform'],
          transitionDuration: '1s',
          transitionTimingFunction: 'ease-out',
        },
      ]}
    >
      <Image
        source={{ uri }}
        accessibilityLabel={`Stage ${stage}`}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        onLoad={handleLoad}
        onError={handleLoad}
      />
    </Animated.View>
  );
}
