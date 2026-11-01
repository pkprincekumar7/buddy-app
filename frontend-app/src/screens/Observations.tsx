/**
 * Observations ("Release") — RN port of frontend/src/pages/Observations.tsx.
 * Data loading, generation and save logic and copy are kept identical to the
 * web; the view is split into components/observations/*.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigate, useParams } from '@/lib/router';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { children, type Child } from '@/api/children';
import { ApiError } from '@/api/errors';
import { isAbort } from '@/api/polling';
import {
  release,
  RELEASE_ERRORS,
  runObservationsGeneration,
} from '@/api/release';
import { jobProgressMessage } from '@/lib/jobProgress';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';
import { httpErrorMessage } from '@/lib/apiError';
import Spinner from '@/components/shared/Spinner';
import PageBackRow from '@/components/layout/PageBackRow';
import PageScroll from '@/components/layout/PageScroll';
import {
  normalizeObservations,
  type ObservationItem,
} from '@/lib/observationsData';
import {
  SPANS,
  type ObservationSpan,
} from '@/components/observations/protocol';
import {
  PAGE_BACKGROUND,
  bodyText,
  em,
  fadeUp,
} from '@/components/observations/styles';
import ObservationsSection from '@/components/observations/ObservationsSection';
import WatchOverTime from '@/components/observations/WatchOverTime';
import StartTrackingCard from '@/components/observations/StartTrackingCard';
import NextSteps from '@/components/observations/NextSteps';
import TrackingStartedModal from '@/components/observations/TrackingStartedModal';
import { font, rgb } from '@/theme';

const SPINNER_RING = {
  borderColor: rgb('constellation-cyan-bright', 0.6),
  borderTopColor: 'transparent',
};

const DEFAULT_SPAN = SPANS[0] as ObservationSpan;

export default function Observations() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { height: windowHeight } = useWindowDimensions();
  const [isLoading, setIsLoading] = useState(true);
  const [childData, setChildData] = useState<Child | null>(null);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [tracked, setTracked] = useState<string[]>([]);
  const [span, setSpan] = useState(0);
  const [started, setStarted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Release generates the patterns from its own copies of the onboarding answers and
  // the growth areas, and validates them on the server (build plan 7.7).
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Stops polling when the page goes away.
  const abortRef = useUnmountSignal();

  const childName = childData?.name ?? '';
  const childAge = childData?.age == null ? '' : String(childData.age);
  const childGender = childData?.gender ?? '';

  useEffect(() => {
    if (!isGenerating) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [isGenerating, startedAt]);

  /** Shows a stored set: ticks only for ids still on screen, and the saved span. */
  const show = useCallback(
    (doc: { items: unknown; watching: string[]; span: string | null }) => {
      const items = normalizeObservations(doc.items);
      setObservations(items);
      const valid = new Set(items.map(o => o.id));
      setTracked(doc.watching.filter(id => valid.has(id)));
      const storedSpan = SPANS.findIndex(s => s.label === doc.span);
      if (storedSpan >= 0) setSpan(storedSpan);
    },
    [],
  );

  /**
   * Generates the patterns (or joins the generation already running) and shows them.
   * A new set clears what was watched: a tick against older cards means nothing.
   */
  const generate = useCallback(async () => {
    if (!childId) return;
    setGenError(null);
    setIsGenerating(true);
    setStartedAt(Date.now());
    setElapsedMs(0);
    try {
      const outcome = await runObservationsGeneration(childId, {
        signal: abortRef.current.signal,
      });
      const doc = await release.get(childId);
      if (outcome === 'completed' && doc.items.length > 0) show(doc);
      else setGenError('Nothing in that set could be shown. Please try again.');
    } catch (err) {
      if (isAbort(err)) return;
      // Nothing to ground patterns in yet: the empty state says so.
      if (err instanceof ApiError && err.code === 'needs_evidence') return;
      console.error('[Observations] Generation failed:', err);
      setGenError(
        httpErrorMessage(err as Error, {
          codeMessages: RELEASE_ERRORS,
          fallback:
            'Could not start generating observations. Please try again.',
        }),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [abortRef, childId, show]);

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
        const [child, doc] = await Promise.all([
          children.get(childId),
          release.get(childId),
        ]);
        if (cancelled) return;
        setChildData(child);
        if (doc.items.length > 0) show(doc);
        // None yet, or one still running (another device, a reload mid-run): start or
        // join it. A failed one waits for the parent's "Try again".
        if (doc.status === 'not_started' || doc.status === 'generating')
          void generate();
        else if (doc.status === 'failed' && doc.items.length === 0)
          setGenError(
            'Something went wrong on our side. Your answers are safe.',
          );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'circle_locked') {
          // Transform isn't done yet: back to the journey.
          void navigate(`/PersonalityJourney/${childId}`, { replace: true });
          return;
        }
        if (err instanceof ApiError && err.code === 'child_not_found') {
          void navigate('/Home', { replace: true });
          return;
        }
        console.error('[Observations] Load failed:', err);
        setGenError('We could not load this page. Please try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate, show, generate]);

  const toggleTracked = (id: string) => {
    setTracked(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id],
    );
  };

  const activeSpan = SPANS[span] ?? DEFAULT_SPAN;
  const chosen = useMemo(
    () => observations.filter(o => tracked.includes(o.id)),
    [observations, tracked],
  );

  const handleStartTracking = useCallback(async () => {
    if (!childId || tracked.length === 0) return;
    setIsSaving(true);
    try {
      // What's watched and for how long; release dates it, and the first one makes
      // Release done (which unlocks Connect).
      await release.watch(childId, tracked, activeSpan.label);
      setStarted(true);
    } catch (err) {
      console.error('[Observations] Failed to save watch list:', err);
      toast.error(
        httpErrorMessage(err as Error, {
          codeMessages: RELEASE_ERRORS,
          fallback: 'Could not save your watch list. Please try again.',
        }),
      );
    } finally {
      setIsSaving(false);
    }
  }, [childId, tracked, activeSpan.label]);

  const generationFailed = genError !== null;
  const progressMessage = jobProgressMessage(elapsedMs, 'observations');

  const trackedLabel =
    observations.length === 0
      ? ''
      : tracked.length === 0
      ? 'Nothing selected yet'
      : `${tracked.length} of ${observations.length} being watched`;
  const startTitle =
    tracked.length === 0
      ? 'Pick at least one observation to watch'
      : `Watch these for ${activeSpan.label}`;
  const startLine =
    tracked.length === 0
      ? 'Tick the ones that match what you see at home.'
      : 'Same few questions, on this rhythm. Every answer dated. Change the list whenever you like.';
  // NOTE: the three-day interval is fixed copy, not a computed date — there is no
  // check-in scheduler behind it yet.
  const startedLine = `${chosen.length} observation${
    chosen.length === 1 ? ' is' : 's are'
  } now being watched for ${
    activeSpan.label
  }. Your first check-in arrives in three days.`;

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <PageBackRow />
        <View className="flex-1 items-center justify-center bg-constellation-navy-deepest">
          <Spinner style={SPINNER_RING} />
        </View>
      </View>
    );
  }

  const heroLabel = `${childName || 'Your child'}${
    childAge ? ` · Age ${childAge}` : ''
  } · Observations`;

  return (
    <View className="flex-1">
      <PageScroll>
        <View
          className="bg-constellation-navy-deepest"
          style={{
            minHeight: windowHeight,
            experimental_backgroundImage: PAGE_BACKGROUND,
          }}
        >
          <View
            style={{ paddingTop: 48, paddingHorizontal: 40, paddingBottom: 90 }}
          >
            {/* Hero */}
            <Animated.View {...fadeUp(0)} className="items-center">
              <Text
                style={{
                  ...font('rajdhani', 700),
                  letterSpacing: em(11, 0.4),
                  fontSize: 11,
                  textTransform: 'uppercase',
                  textAlign: 'center',
                  color: rgb('constellation-gold'),
                }}
              >
                {heroLabel}
              </Text>
              <Text
                accessibilityRole="header"
                style={{
                  ...font('orbitron', 900),
                  marginTop: 16,
                  maxWidth: 780,
                  fontSize: 28,
                  lineHeight: 28 * 1.12,
                  textAlign: 'center',
                  color: rgb('constellation-text-frost'),
                }}
              >
                What we have noticed so far
              </Text>
              <Text
                style={[
                  bodyText(17, 1.55, 'constellation-slate-pale'),
                  { marginTop: 16, maxWidth: 560, textAlign: 'center' },
                ]}
              >
                Patterns that came up more than once. Pick the ones to keep an
                eye on.
              </Text>
            </Animated.View>

            <ObservationsSection
              isGenerating={isGenerating}
              generationFailed={generationFailed}
              statusLabel={isGenerating ? progressMessage : trackedLabel}
              errorMessage={
                genError ??
                'Something went wrong on our side. Your answers are safe.'
              }
              observations={observations}
              tracked={tracked}
              childName={childName}
              onToggle={toggleTracked}
              onRetry={() => {
                void generate();
              }}
              onGoToGrow={() => {
                void navigate(`/GrowthAreas/${childId ?? ''}`);
              }}
            />

            <WatchOverTime
              span={span}
              onSelectSpan={setSpan}
              activeSpan={activeSpan}
              childName={childName}
              childGender={childGender}
            />

            {observations.length > 0 && (
              <StartTrackingCard
                title={startTitle}
                line={startLine}
                chosen={chosen}
                disabled={tracked.length === 0 || isSaving}
                isSaving={isSaving}
                onStart={() => {
                  void handleStartTracking();
                }}
              />
            )}

            <NextSteps childName={childName} childGender={childGender} />
          </View>
        </View>
      </PageScroll>

      <TrackingStartedModal
        open={started}
        onClose={() => setStarted(false)}
        line={startedLine}
      />
    </View>
  );
}
