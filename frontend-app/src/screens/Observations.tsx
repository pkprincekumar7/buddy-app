/**
 * Observations ("Release") — RN port of frontend/src/pages/Observations.tsx.
 * Data loading, generation (useJob), finalize/save logic and copy are kept
 * identical to the web; the view is split into components/observations/*.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigate, useParams } from '@/lib/router';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { useJob, jobProgressMessage } from '@/hooks/useJob';
import Spinner from '@/components/shared/Spinner';
import PageBackRow from '@/components/layout/PageBackRow';
import PageScroll from '@/components/layout/PageScroll';
import {
  NO_QUESTIONNAIRE,
  buildObservationsPrompt,
  questionnaireMarkdown,
} from '@/lib/prompts';
import {
  SELECTABLE_ICON_KEYS,
  normalizeObservations,
  observationsLlmSchema,
  selectObservations,
  type ObservationItem,
  type ObservationSourceKey,
} from '@/lib/observationsData';
import {
  buildChildActivityContext,
  buildGrowthAreaContext,
} from '@/components/observations/evidence';
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
import type { ChildRecord, EnqueueJobPayload } from '@/types/api';

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
  const [childData, setChildData] = useState<ChildRecord | null>(null);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [hasEvidence, setHasEvidence] = useState(false);
  const [tracked, setTracked] = useState<string[]>([]);
  const [span, setSpan] = useState(0);
  const [started, setStarted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /**
   * Generation failures that useJob cannot represent. Two of them exist and both
   * used to strand the page on skeletons forever:
   *   - enqueue throws (network): useJob sets status back to null, so isLoading,
   *     isFailed and isComplete are ALL false and no branch renders an error.
   *   - the job completes but every candidate fails validation: isComplete is
   *     true with observations still empty, which is exactly the condition
   *     isGenerating uses to keep showing skeletons.
   */
  const [genError, setGenError] = useState<string | null>(null);

  const childName = typeof childData?.name === 'string' ? childData.name : '';
  const childAge = childData?.age != null ? String(childData.age) : '';
  const childGender =
    typeof childData?.gender === 'string' ? childData.gender : '';

  /**
   * The prompt inputs, held in a ref so enqueueing does not depend on render
   * order. Everything here is the parent's own writing — there is no other
   * source of observations today (see the source keys in `@/lib/observationsData`).
   */
  const evidenceRef = useRef<{
    questionnaireMd: string;
    growthAreaContext: string;
    childActivityContext: string;
    /** The exact choice lines in the prompt — the whitelist for child notes. */
    childChoiceLines: string[];
    /** Blocks the prompt will contain, in the order it presents them. */
    availableSources: ObservationSourceKey[];
  } | null>(null);

  const enqueueObservations = useCallback(
    async (enqueue: (payload: EnqueueJobPayload) => Promise<void>) => {
      const evidence = evidenceRef.current;
      if (!childId || !evidence) return;
      setGenError(null);
      await enqueue({
        type: 'generate_observations',
        child_id: childId,
        payload: {
          prompt: buildObservationsPrompt({
            childName: childName || 'the child',
            childAge: childAge || null,
            childGender: childGender || null,
            questionnaireMd: evidence.questionnaireMd,
            growthAreaContext: evidence.growthAreaContext,
            childActivityContext: evidence.childActivityContext,
            iconKeys: SELECTABLE_ICON_KEYS,
          }),
          response_json_schema: observationsLlmSchema(),
        },
        write_back: {
          collection: 'observations',
          filter: {},
          field: 'pending_observations',
        },
      });
    },
    [childId, childName, childAge, childGender],
  );

  /**
   * Promotes the worker's staged output to the canonical field once validated.
   * The watch list is reset here on purpose: a tick the parent made against an
   * older set of cards does not carry a defensible meaning against a new one.
   */
  const finalizeObservations = useCallback(async () => {
    if (!childId) return;
    try {
      const record = await api.observations.get(childId);
      const candidates = normalizeObservations(record?.pending_observations, {
        allowedChoiceNotes: evidenceRef.current?.childChoiceLines ?? [],
      });
      if (candidates.length === 0) {
        setGenError('Nothing in that set could be shown. Please try again.');
        return;
      }
      const { items, unrepresentedSources, dropped } = selectObservations(
        candidates,
        evidenceRef.current?.availableSources ?? [],
      );
      // Neither of these is worth failing the page over, but both are worth
      // knowing about: a silent cap reads as "covered everything" when it did not.
      if (dropped > 0) {
        console.info(
          `[Observations] ${dropped} valid observation(s) cut by the ${items.length}-card display cap.`,
        );
      }
      if (unrepresentedSources.length > 0) {
        console.warn(
          `[Observations] Provider returned no observation citing: ${unrepresentedSources.join(
            ', ',
          )}. ` + 'Selection can reorder candidates but cannot invent one.',
        );
      }
      setObservations(items);
      setTracked([]);
      // Clearing `watching` is what resets the parent's ticks alongside a fresh
      // set; the PATCH is field-wise, so it has to be sent explicitly.
      await api.observations.patch(childId, {
        source: 'llm',
        items,
        watching: [],
      });
    } catch (err) {
      console.error('[Observations] Failed to finalize observations:', err);
      setGenError('Observations could not be saved. Please try again.');
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs,
    jobType: 'generate_observations',
    onCompleted: finalizeObservations,
  });
  const { enqueue: jobEnqueue, retry: jobRetry } = job;

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
        setChildData(child);

        // Neither of these is fatal: an observation set built on the
        // questionnaire alone is still honest, it just cites fewer sources.
        const [completed, stored] = await Promise.all([
          api.completedGrowthAreas.list(childId).catch(() => null),
          api.observations.get(childId).catch(() => null),
        ]);
        if (cancelled) return;

        const name = typeof child.name === 'string' ? child.name : '';
        const gender = typeof child.gender === 'string' ? child.gender : '';
        const questionnaireRaw = questionnaireMarkdown(child);
        const questionnaireMd =
          questionnaireRaw === NO_QUESTIONNAIRE ? '' : questionnaireRaw;
        const areas = completed?.areas ?? [];
        const growthAreaContext = buildGrowthAreaContext(areas, name, gender);
        const childActivity = buildChildActivityContext(areas, name, gender);
        const childActivityContext = childActivity.text;

        // Order matters — selectObservations reserves slots in this order, and it
        // must match the order buildObservationsPrompt emits the blocks.
        const availableSources: ObservationSourceKey[] = [];
        if (questionnaireMd) availableSources.push('onboarding');
        if (growthAreaContext) availableSources.push('grow');
        if (childActivityContext) availableSources.push('child');

        evidenceRef.current = {
          questionnaireMd,
          growthAreaContext,
          childActivityContext,
          childChoiceLines: childActivity.choiceLines,
          availableSources,
        };
        setHasEvidence(availableSources.length > 0);

        const storedItems = normalizeObservations(stored?.items);
        if (storedItems.length > 0) {
          setObservations(storedItems);
          // Ticks are filtered against the ids that survived validation, so a
          // stale id in `watching` cannot select a card that is not on screen.
          const valid = new Set(storedItems.map(o => o.id));
          setTracked(
            (Array.isArray(stored?.watching) ? stored.watching : []).filter(
              id => valid.has(id),
            ),
          );
          const storedSpan = SPANS.findIndex(s => s.label === stored?.span);
          if (storedSpan >= 0) setSpan(storedSpan);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  // Once this page's content has loaded for the child, mark Release as visited
  // — this advances which circle the DimensionCircles hub points to next.
  useEffect(() => {
    if (!childId || !childData?.id || childData.release_visited) return;
    api.entities.Child.markProgress(childId, 'release_visited').catch(
      console.error,
    );
  }, [childId, childData?.id, childData?.release_visited]);

  // Kick off generation once, and only once there is something to ground it in.
  // A job already in flight (from another device, or a reload mid-run) is picked
  // up by useJob from active_jobs instead.
  const didEnqueueRef = useRef(false);
  useEffect(() => {
    if (isLoading || didEnqueueRef.current) return;
    if (observations.length > 0 || !hasEvidence) return;
    if (childData?.active_jobs?.generate_observations) return;
    didEnqueueRef.current = true;
    // useJob rethrows so callers can react; without this catch a failed enqueue is
    // an unhandled rejection AND the page falls through to the "nothing to group"
    // empty state, which is wrong — there is evidence, starting the job failed.
    void enqueueObservations(jobEnqueue).catch(() => {
      setGenError('Could not start generating observations. Please try again.');
    });
  }, [
    isLoading,
    observations.length,
    hasEvidence,
    childData,
    enqueueObservations,
    jobEnqueue,
  ]);

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
      // Only the three fields the parent actually changed.
      await api.observations.patch(childId, {
        watching: tracked,
        span: activeSpan.label,
        started_at: new Date().toISOString(),
      });
      setStarted(true);
    } catch (err) {
      console.error('[Observations] Failed to save watch list:', err);
      toast.error('Could not save your watch list. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [childId, tracked, activeSpan.label]);

  // job.isComplete fires before finalizeObservations' write lands, which would
  // otherwise flash the grid from skeletons to the empty state for a beat. The
  // genError term is what lets that window close when finalize fails instead of
  // holding the skeletons up indefinitely.
  const generationFailed = job.isFailed || genError !== null;
  const isGenerating =
    !generationFailed &&
    (job.isLoading || (job.isComplete && observations.length === 0));
  const progressMessage = jobProgressMessage(
    job.elapsedMs,
    'generate_observations',
  );

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
                job.error ??
                'Something went wrong on our side. Your answers are safe.'
              }
              observations={observations}
              tracked={tracked}
              childName={childName}
              onToggle={toggleTracked}
              onRetry={() => {
                void enqueueObservations(jobRetry).catch(() => {
                  setGenError(
                    'Could not start generating observations. Please try again.',
                  );
                });
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
