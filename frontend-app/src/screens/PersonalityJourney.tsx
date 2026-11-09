import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';
import Spinner from '@/components/shared/Spinner';
import { discover } from '@/api/discover';
import { useJourney } from '@/hooks/useJourney';
import { useStartOver } from '@/hooks/useStartOver';
import { useNavigate, useParams } from '@/lib/router';
import StageSplash from '@/components/shared/StageSplash';
import { ConfirmModal as StartOverConfirmModal } from '@/components/shared/StartOverButton';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import PageBackRow from '@/components/layout/PageBackRow';
import BuddyOrbScreen from '@/components/personalityJourney/BuddyOrbScreen';
import DimensionCirclesScreen from '@/components/personalityJourney/DimensionCirclesScreen';
import WarpOverlay from '@/components/personalityJourney/WarpOverlay';
import {
  SCOPE_DOLLY,
  fadeIn,
} from '@/components/personalityJourney/animations';
import type { ActiveDimension } from '@/components/personalityJourney/geometry';
import { useJourneyViewport } from '@/components/personalityJourney/viewport';
import { css, recipe, rgb } from '@/theme';

type Phase = 1 | 2;

const ORB_VOICE = require('../../assets/audio/orb-voice.mp3');
/** Height of the Layout's Back row (pt-4 + h-8 sm button) above the page content. */
const BACK_ROW_H = 48;
const NAVY_DEEP = rgb('constellation-navy-deep');
const AMBIENT_BLOB = css(
  'radial-gradient(circle, rgb(var(--constellation-teal-deep-rgb) / 0.35) 0%, transparent 60%)',
);
const PHASE1_FADE = fadeIn(0.3);

function pausePlayer(p: VideoPlayer | null) {
  try {
    p?.pause();
  } catch {
    /* player already released */
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PersonalityJourney() {
  const navigate = useNavigate();
  const { childId, sub } = useParams<{ childId?: string; sub?: string }>();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const viewport = useJourneyViewport();
  const isFocused = useIsFocused();
  const phase: Phase = sub === 'DimensionCircles' ? 2 : 1;
  const [showDiscoverSplash, setShowDiscoverSplash] = useState(false);
  const [discoverViewed, setDiscoverViewed] = useState(false);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const { doStartOver, isStartingOver } = useStartOver(childId);

  // The child and its personality (build plan 7.5): discover generates the personality on
  // its own once the chat is saved, so the hub only waits for it (or retries a failure).
  const { journey, retry } = useJourney(
    childId,
    !isLoadingAuth && isAuthenticated,
  );
  const child = 'child' in journey ? journey.child : null;
  const childName = child?.name ?? '';
  const isAnalyzing = journey.status === 'analyzing';

  // Each circle's state, set by the services when it's completed (build plan 7.4).
  const discoverCompleted = discoverViewed || Boolean(child?.progress.discover);
  const growCompleted = Boolean(child?.progress.grow);
  const transformCompleted = Boolean(child?.progress.transform);
  const releaseCompleted = Boolean(child?.progress.release);
  const connectVisited = Boolean(child?.progress.connect);

  const handleDiscoverSplashReady = useCallback(() => {
    setShowDiscoverSplash(false);
    void (async () => {
      if (childId && !discoverCompleted) {
        setDiscoverViewed(true);
        // Passing the reveal makes Discover done; children then unlocks Grow.
        await discover
          .viewed(childId)
          .catch((err: unknown) =>
            console.warn('[PersonalityJourney] viewed failed:', err),
          );
      }
      void navigate(`/PersonalityProfile/${childId ?? ''}`);
    })();
  }, [navigate, childId, discoverCompleted]);

  // Grow unlocks Transform once one of the six growth areas is completed: grow publishes
  // `grow.completed` then, and children sets `progress.grow`, so the client can't forge it.
  const growUnlocksTransform = growCompleted;

  // The frontier circle the hub's glow/dots should point to: the next step the
  // user hasn't reached yet in Discover → Grow → Transform → Release → Connect.
  // null once Connect has been visited too — nothing left to point at.
  const currentDimension: ActiveDimension = !discoverCompleted
    ? 'discover'
    : !growUnlocksTransform
    ? 'grow'
    : !transformCompleted
    ? 'transform'
    : !releaseCompleted
    ? 'release'
    : !connectVisited
    ? 'connect'
    : null;

  // ── Sound + warp-enter ────────────────────────────────────────────────────────
  const { ttsEnabled: soundOn } = useTts();
  const [isEntering, setIsEntering] = useState(false);
  const enterTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Play intro voice when orb screen (phase 1) is active — mirrors HTML's playVoice().
  // `isFocused` stands in for the web page unmounting/remounting as the user
  // navigates away and back (the RN stack keeps this screen mounted underneath).
  const orbVoiceRef = useRef<VideoPlayer | null>(null);
  useEffect(() => {
    if (phase !== 1 || !soundOn || !isFocused) {
      pausePlayer(orbVoiceRef.current);
      return;
    }
    const audio = createVideoPlayer(ORB_VOICE);
    audio.volume = 0.9;
    audio.audioMixingMode = 'mixWithOthers';
    orbVoiceRef.current = audio;
    const timer = setTimeout(() => {
      try {
        audio.play();
      } catch {
        /* noop */
      }
    }, 800);
    return () => {
      clearTimeout(timer);
      pausePlayer(audio);
      audio.release();
      if (orbVoiceRef.current === audio) orbVoiceRef.current = null;
    };
  }, [phase, soundOn, isFocused]);

  // Looping ambient bed — shared across the whole journey (see
  // AmbientAudioContext) so it keeps playing uninterrupted as the user moves
  // between this page and the pages it leads to, rather than restarting per page.
  const { duck: duckAmbient, setSuppressed: setAmbientSuppressed } =
    useAmbientAudio();

  // The Discover splash (stage 2) plays its own unmuted video — keep the
  // ambient bed silent for that beat so the two don't overlap.
  useEffect(() => {
    setAmbientSuppressed(showDiscoverSplash);
    return () => setAmbientSuppressed(false);
  }, [showDiscoverSplash, setAmbientSuppressed]);

  // Cleanup warp on unmount (the streak canvas stops itself when WarpOverlay unmounts)
  useEffect(
    () => () => {
      enterTimersRef.current.forEach(clearTimeout);
    },
    [],
  );

  const handleEnterNav = () => {
    if (isEntering) return;
    setIsEntering(true);
    // web: whoosh() — a Web Audio-synthesized noise sweep + sub drop. RN has no
    // audio-synthesis API in this app's dependencies, so the warp runs silent.
    duckAmbient(0.12, 1600);
    pausePlayer(orbVoiceRef.current);
    enterTimersRef.current.forEach(clearTimeout);
    // Match HTML timing: phase:'nav' at 3350ms, warp:false at 5100ms, scope:false at 5700ms
    const t1 = setTimeout(
      () =>
        void navigate(`/PersonalityJourney/${childId ?? ''}/DimensionCircles`),
      3350,
    );
    const t2 = setTimeout(() => setIsEntering(false), 5700);
    const t3 = setTimeout(() => duckAmbient(0.5, 1800), 5700);
    enterTimersRef.current = [t1, t2, t3];
  };
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
    } else if (!childId || journey.status === 'missing') {
      void navigate('/Home', { replace: true });
    } else if (journey.status === 'locked') {
      // The chat isn't done yet: back to it.
      void navigate(`/ConversationalOnboarding/${childId}`, { replace: true });
    }
  }, [isLoadingAuth, isAuthenticated, childId, journey.status, navigate]);

  const status =
    journey.status === 'failed'
      ? 'error'
      : isLoadingAuth || !child
      ? 'loading'
      : 'ready';

  if (status === 'loading') {
    return (
      <View className="flex-1 bg-background">
        <PageBackRow />
        <View
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: NAVY_DEEP }}
        >
          <Spinner
            style={{
              borderColor: rgb('constellation-cyan-bright', 0.6),
              borderTopColor: 'transparent',
            }}
          />
        </View>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View className="flex-1 bg-background">
        <PageBackRow />
        <View className="flex-1 items-center justify-center gap-4 px-4">
          <Text className="text-center text-muted-foreground">
            {journey.status === 'failed'
              ? journey.message
              : 'Something went wrong. Please try again.'}
          </Text>
          <View className="flex-row gap-3">
            <Button
              onPress={retry}
              className="rounded-2xl px-8 font-semibold text-primary-foreground"
              style={recipe.btnPrimary}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              onPress={() => void navigate('/Home')}
              className="rounded-2xl px-8"
            >
              Go Back
            </Button>
          </View>
        </View>
      </View>
    );
  }

  const { width, vh } = viewport;

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <PageBackRow />
        <View
          style={{
            minHeight: vh,
            backgroundColor: NAVY_DEEP,
            overflow: 'hidden',
          }}
        >
          {/* Ambient background blob — web: fixed, centered on the viewport */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: width / 2 - 350,
              top: vh / 2 - 64 - BACK_ROW_H - 350,
              width: 700,
              height: 700,
              borderRadius: 350,
              experimental_backgroundImage: AMBIENT_BLOB,
            }}
          />

          <View style={{ zIndex: 10 }}>
            {phase === 1 && (
              <Animated.View
                style={[
                  { minHeight: vh },
                  isEntering ? SCOPE_DOLLY : PHASE1_FADE,
                ]}
              >
                <BuddyOrbScreen
                  childName={childName}
                  isAnalyzing={isAnalyzing}
                  onTap={handleEnterNav}
                  viewport={viewport}
                />
              </Animated.View>
            )}

            {phase === 2 && (
              <DimensionCirclesScreen
                childName={childName}
                onConnect={() => void navigate(`/Connect/${childId ?? ''}`)}
                onDiscover={() => setShowDiscoverSplash(true)}
                onGoHome={() =>
                  void navigate(`/PersonalityJourney/${childId ?? ''}`)
                }
                onGrow={() => void navigate(`/GrowthAreas/${childId ?? ''}`)}
                onTransform={() =>
                  void navigate(`/LifePathway/${childId ?? ''}`)
                }
                onRelease={() =>
                  void navigate(`/Observations/${childId ?? ''}`)
                }
                onStartAgain={() => setConfirmingStartOver(true)}
                enabled={{
                  grow: discoverCompleted,
                  transform: growUnlocksTransform,
                  release: transformCompleted,
                  connect: releaseCompleted,
                }}
                current={currentDimension}
                viewport={viewport}
              />
            )}
          </View>
        </View>
      </ScrollView>

      {/* Warp enter overlays */}
      {isEntering && <WarpOverlay />}

      {showDiscoverSplash && (
        <StageSplash stage={2} onReady={handleDiscoverSplashReady} />
      )}

      <StartOverConfirmModal
        open={confirmingStartOver}
        onCancel={() => setConfirmingStartOver(false)}
        onConfirm={() => {
          setConfirmingStartOver(false);
          void doStartOver();
        }}
        isStartingOver={isStartingOver}
      />
    </View>
  );
}
