import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';
import { api } from '@/api/client';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import Spinner from '@/components/shared/Spinner';
import {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import {
  sanitizeViewModelAvatars,
  stripViewModelImages,
} from '@/lib/avatarUtils';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import { useJob } from '@/hooks/useJob';
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
  const [mergedData, setMergedData] = useState<Record<string, unknown>>({});
  const [childName, setChildName] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [initError, setInitError] = useState(false);
  const [showDiscoverSplash, setShowDiscoverSplash] = useState(false);
  const [discoverCompleted, setDiscoverCompleted] = useState(false);
  const [growCompleted, setGrowCompleted] = useState(false);
  const [transformVisited, setTransformVisited] = useState(false);
  const [releaseVisited, setReleaseVisited] = useState(false);
  const [connectVisited, setConnectVisited] = useState(false);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const { doStartOver, isStartingOver } = useStartOver(childId);

  const handleDiscoverSplashReady = useCallback(() => {
    setShowDiscoverSplash(false);
    if (childId && !discoverCompleted) {
      setDiscoverCompleted(true);
      api.entities.Child.markProgress(childId, 'discover_completed').catch(
        console.error,
      );
    }
    void navigate(`/PersonalityProfile/${childId ?? ''}`);
  }, [navigate, childId, discoverCompleted]);
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const mergedDataRef = useRef<Record<string, unknown> | null>(null);

  // Grow unlocks Transform once at least one of the six growth areas is completed.
  // `growCompleted` (child.grow_completed) is itself computed live server-side
  // from the growth_areas collection (backend/app/services/journey_progress.py) —
  // it can no longer go stale or be forged. `hasCompletedGrowthArea` re-runs the
  // same check client-side via completedGrowthAreas.list; the two are redundant
  // today (kept as belt-and-suspenders) rather than each independently necessary.
  const { data: completedGrowthAreasData } = useQuery({
    queryKey: ['completedGrowthAreas', childId],
    queryFn: () => api.completedGrowthAreas.list(childId ?? ''),
    enabled: phase === 2 && Boolean(childId),
  });
  const hasCompletedGrowthArea =
    completedGrowthAreasData?.areas?.some(a => a.status === 'completed') ??
    false;
  const growUnlocksTransform = growCompleted && hasCompletedGrowthArea;

  // The frontier circle the hub's glow/dots should point to: the next step the
  // user hasn't reached yet in Discover → Grow → Transform → Release → Connect.
  // null once Connect has been visited too — nothing left to point at.
  const currentDimension: ActiveDimension = !discoverCompleted
    ? 'discover'
    : !growUnlocksTransform
    ? 'grow'
    : !transformVisited
    ? 'transform'
    : !releaseVisited
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

  const markJourneyComplete = useCallback(async () => {
    if (!childId) return;
    try {
      await api.entities.Child.update(childId, {
        onboarding_phase: 3,
        onboarding_completed: true,
      });
    } catch {
      /* non-fatal */
    }
  }, [childId]);

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ??
        personality?.pending_view_model) as Record<string, unknown> | undefined;
      const merged = mergedDataRef.current;

      let vm: Record<string, unknown> | null = null;
      if (pendingVm && merged) {
        const adapted = adaptAiPersonalityToViewModel(
          pendingVm,
          merged.name as string,
        );
        vm = sanitizeViewModelAvatars(adapted);
        api.entities.Child.update(childId, {
          personality: {
            source: 'llm',
            view_model: stripViewModelImages(adapted),
          },
          onboarding_phase: 2,
        }).catch(err =>
          console.error(
            '[PersonalityJourney] Failed to persist personality:',
            err,
          ),
        );
      } else if (personality?.view_model?.profile?.name) {
        vm = sanitizeViewModelAvatars(
          maybeClampStoredPersonalityDescription(personality.view_model, {
            analysisSource: personality?.source,
          }),
        );
      }

      void vm;
      setIsAnalyzing(false);
      await markJourneyComplete();
    } catch (err) {
      console.error(
        '[PersonalityJourney] Failed to finalize personality:',
        err,
      );
      setIsAnalyzing(false);
      setInitError(true);
    }
  }, [childId, markJourneyComplete]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_personality_analysis',
    onCompleted: finalizePersonality,
  });

  const { enqueue: enqueueJob } = job;

  // Surface job failures as page error
  useEffect(() => {
    if (job.isFailed) {
      setIsAnalyzing(false);
      setInitError(true);
    }
  }, [job.isFailed]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }

        const personality = child.personality;
        const vm = personality?.view_model;
        const merged = mergeChildDraft(
          normalizeOnboardingChildDataBlob(child) ?? {},
        );
        mergedDataRef.current = merged;
        setChildName(merged.name || '');
        setMergedData(merged);
        setDiscoverCompleted(Boolean(child.discover_completed));
        setGrowCompleted(Boolean(child.grow_completed));
        setTransformVisited(Boolean(child.transform_visited));
        setReleaseVisited(Boolean(child.release_visited));
        setConnectVisited(Boolean(child.connect_visited));

        if (vm?.profile?.name) {
          // Personality already analysed — show orb immediately, fully interactive
          setIsInitializing(false);
          if (!child.onboarding_completed) {
            await markJourneyComplete();
          }
          return;
        }

        // No complete personality yet — need to run or resume analysis
        if (!merged.name?.trim()) {
          void navigate(`/ConversationalOnboarding/${childId}`, {
            replace: true,
          });
          return;
        }

        // Check for pending_personality_vm (LLM done but write-back not yet saved as view_model)
        const pendingVm = (child.pending_personality_vm ??
          personality?.pending_view_model) as
          | Record<string, unknown>
          | undefined;
        if (pendingVm) {
          const adapted = adaptAiPersonalityToViewModel(pendingVm, merged.name);
          if (cancelled) return;
          setIsInitializing(false);
          api.entities.Child.update(childId, {
            personality: {
              source: 'llm',
              view_model: stripViewModelImages(adapted),
            },
            onboarding_phase: 2,
          }).catch(console.error);
          await markJourneyComplete();
          return;
        }

        // Show orb in analyzing state while job runs in background
        setChildData(child);
        setIsAnalyzing(true);
        setIsInitializing(false);

        // Only enqueue if no job is already running
        const activeJobId = child.active_jobs?.generate_personality_analysis;
        if (!activeJobId) {
          await enqueueJob({
            type: 'generate_personality_analysis',
            child_id: childId,
            payload: {
              prompt: buildPersonalityAnalysisPrompt({
                childData: merged,
                personalityTypeKeys: PERSONALITY_TYPE_KEYS,
              }),
              response_json_schema: personalityLlmSchema(),
            },
            write_back: {
              collection: 'children',
              filter: {},
              field: 'pending_personality_vm',
            },
          });
        }
        // else: useJob picks up activeJobId from setChildData(child) and polls automatically
      } catch (err) {
        console.warn('[PersonalityJourney] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isLoadingAuth,
    isAuthenticated,
    childId,
    navigate,
    markJourneyComplete,
    enqueueJob,
  ]);

  const status =
    isLoadingAuth || isInitializing ? 'loading' : initError ? 'error' : 'ready';

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
          <Text className="text-muted-foreground">
            Something went wrong. Please try again.
          </Text>
          <Button
            onPress={() => void navigate('/Home')}
            className="rounded-2xl px-8 font-semibold text-primary-foreground"
            style={recipe.btnPrimary}
          >
            Go Back
          </Button>
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
                mergedData={mergedData}
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
                  release: transformVisited,
                  connect: transformVisited,
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
