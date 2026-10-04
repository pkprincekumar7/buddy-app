import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, {
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useNavigate, useParams } from '@/lib/router';
import { toast } from '@/lib/toast';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useJob } from '@/hooks/useJob';
import { useGrowthAreaQuestions } from '@/hooks/useGrowthAreaQuestions';
import { useAuth } from '@/lib/AuthContext';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { api } from '@/api/client';
import {
  // Not what a parent answers any more — kept as the accurate record of the
  // wording used by areas answered before questions were generated.
  AREA_QUESTIONS,
  GROWTH_AREAS,
  fillTemplate,
  normalizeRecommendations,
  pickedOptions,
  resolveRounds,
  topArchetype,
} from '@/lib/growthAreaData';
import type { GrowthArea, GrowthRecommendation } from '@/lib/growthAreaData';
import type { CompletedArea, StoredRecommendation } from '@/types/api';
import { buildGrowthAreaRecommendationsPrompt } from '@/lib/prompts';
import PageLoader from '@/components/shared/PageLoader';
import Starfield from '@/components/shared/Starfield';
import PageBackRow from '@/components/layout/PageBackRow';
import { HEADER_HEIGHT } from '@/components/layout/AppHeader';
import GrowthAreaSheet from '@/components/growth/GrowthAreaSheet';
import {
  EASE_OUT,
  EASE_OUT_EXPO,
  PathIcon,
  fadeUp,
  hueAlpha,
  scalePath,
} from '@/components/growth/shared';
import { GROWTH_VIGNETTE } from '@/components/growth/palette';
import { css, font, rgb } from '@/theme';

/**
 * RN port of the web Growth Map at its phone layout (useIsMobile → true): the
 * two-column ladder of six nodes with the vertical zigzag guide. The web's
 * `--ga-type-scale` is 1 below 768px, so every type size is the design px.
 *
 * The web composes this as one fixed viewport under the Layout's Back row
 * (`min-h-[calc(100vh-4rem)]`), so the screen renders <PageBackRow /> itself
 * and sizes the scene to the window minus the header.
 */

// Node geometry (web MOBILE_* values).
const NODE = 58;
const ICON = 26;
const BADGE = 22;
const ARC_H = 560;
/** Label box either side of a node — wide enough for the longest name on one line. */
const LABEL_W = 180;

const MOBILE_POS = [
  { left: 27, top: 8 },
  { left: 73, top: 22 },
  { left: 27, top: 36 },
  { left: 73, top: 50 },
  { left: 27, top: 64 },
  { left: 73, top: 78 },
];

const GUIDE_SOLID =
  'M27 8 C27 15 73 15 73 22 C73 29 27 29 27 36 C27 43 73 43 73 50 C73 57 27 57 27 64 C27 71 73 71 73 78';
const GUIDE_DASHED =
  'M33 8 C33 15 67 15 67 22 C67 29 33 29 33 36 C33 43 67 43 67 50 C67 57 33 57 33 64 C33 71 67 71 67 78';
const CHECK_PATH = 'M5 13l4 4L19 7';

const NEBULA = `${css(
  'radial-gradient(ellipse at 50% 45%,rgb(var(--constellation-cyan-bright-rgb) / .13),rgb(var(--constellation-navy-deep-rgb) / 0) 58%)',
)},${css(
  `radial-gradient(circle at 50% 50%,rgb(var(--constellation-navy-deep-rgb) / 0) 42%,${GROWTH_VIGNETTE} 100%)`,
)}`;
const NODE_BG = css(
  'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
);

const HEADER_IN = fadeUp(16, 700);
const ARC_IN = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1, easing: EASE_OUT },
})
  .duration(1000)
  .delay(150);
const nodeIn = (i: number) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.8 }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT_EXPO },
  })
    .duration(550)
    .delay(250 + i * 80);
const NODE_IN = GROWTH_AREAS.map((_, i) => nodeIn(i));

export default function GrowthAreas() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [childGender, setChildGender] = useState('');
  const [completedAreaIds, setCompletedAreaIds] = useState<
    Set<string | undefined>
  >(new Set());
  const [savedAnswers, setSavedAnswers] = useState<
    Record<string, Record<string, unknown>>
  >({});
  // Lets a finished area open straight into its result (constellation +
  // recommendations) instead of forcing a full redo just to look at it again.
  // Sourced from `child_activity.selections` — a durable field the backend
  // never clears — unlike `child_activity_selections`, which it unsets on
  // every completion.
  const [completedResults, setCompletedResults] = useState<
    Record<string, { picks: string[]; recommendations: GrowthRecommendation[] }>
  >({});
  const [hydrated, setHydrated] = useState(false);
  /** The raw growth_areas documents, which also carry the generated question sets. */
  const [areaDocs, setAreaDocs] = useState<CompletedArea[]>([]);
  const [activeArea, setActiveArea] = useState<GrowthArea | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recsStatus, setRecsStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [recommendations, setRecommendations] = useState<
    GrowthRecommendation[]
  >([]);
  const [showSplash, startTimer] = useStageSplash(0);
  // Which area the in-flight/last recommendations job belongs to — anchored
  // here so the job survives the parent closing the sheet.
  const recsAreaRef = useRef<GrowthArea | null>(null);
  // Mirrors the answers just persisted for the area a recs job is running for,
  // so finalizeRecommendations can re-include them in the completing write.
  const recsAnswersRef = useRef<Record<string, unknown>>({});
  // The exact picks the CURRENT `recommendations` state was generated for, so a
  // same-session identical replay reuses them instead of re-billing the LLM.
  const recsPicksRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          navigate('/Home', { replace: true });
          return;
        }
        if (
          !child.personality?.view_model?.type &&
          !child.personality?.view_model?.profile?.name
        ) {
          navigate(`/PersonalityType/${childId}`, { replace: true });
          return;
        }
        setChildData(child);
        setChildName(child.name ?? '');
        setChildAge(child.age != null ? String(child.age) : '');
        setChildGender(typeof child.gender === 'string' ? child.gender : '');

        const areas = await api.completedGrowthAreas.list(childId);
        if (cancelled) return;
        const allDocs = areas.areas ?? [];
        // Held as-is for useGrowthAreaQuestions, which reads each area's stored
        // question sets off these same documents.
        setAreaDocs(allDocs);
        const done = new Set(
          allDocs
            .filter(
              a =>
                a.status === 'completed' ||
                !a.status ||
                (Array.isArray(a.ai_three_month_recommendations) &&
                  a.ai_three_month_recommendations.length > 0),
            )
            .map(a => a.area_id),
        );
        setCompletedAreaIds(done);

        // Prefill a redo of an area the parent already answered.
        const byArea: Record<string, Record<string, unknown>> = {};
        for (const doc of allDocs) {
          const prev = doc.interactive_answers ?? doc.answers;
          if (doc.area_id && prev && typeof prev === 'object')
            byArea[doc.area_id] = prev;
        }
        setSavedAnswers(byArea);

        const results: Record<
          string,
          { picks: string[]; recommendations: GrowthRecommendation[] }
        > = {};
        for (const doc of allDocs) {
          if (!doc.area_id || doc.status !== 'completed') continue;
          const recs = normalizeRecommendations(
            doc.ai_three_month_recommendations,
          );
          const picks = (
            doc.child_activity as { selections?: unknown } | undefined
          )?.selections;
          if (
            recs.length > 0 &&
            Array.isArray(picks) &&
            picks.every((p): p is string => typeof p === 'string')
          ) {
            results[doc.area_id] = { picks, recommendations: recs };
          }
        }
        setCompletedResults(results);
      } catch (err) {
        console.warn('[GrowthAreas] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  // Ambient track is shared across the whole journey — keep it silent while the
  // splash video plays its own audio.
  useEffect(() => {
    setAmbientSuppressed(showSplash || !hydrated);
    return () => setAmbientSuppressed(false);
  }, [showSplash, hydrated, setAmbientSuppressed]);

  /**
   * Both question sets, generated per child per area and cached on the child
   * document. Anchored on the page so a job survives the sheet closing.
   */
  const generated = useGrowthAreaQuestions({
    childId,
    child: childData,
    areas: areaDocs,
    area: activeArea,
    enabled: hydrated,
  });
  const { ensureParent, ensureChild, questionsFor, roundsFor } = generated;

  /** The reflections an area's saved answers belong to (generated, else the hardcoded record). */
  const askedQuestions = useCallback(
    (areaId: string) => questionsFor(areaId) ?? AREA_QUESTIONS[areaId] ?? [],
    [questionsFor],
  );

  /** An area's answers as question/answer pairs, for prompt context. */
  const qaPairsFor = useCallback(
    (areaId: string, answers: Record<string, unknown>) =>
      askedQuestions(areaId).flatMap(q => {
        const raw = answers[q.id];
        const answer = typeof raw === 'string' ? raw.trim() : '';
        return answer
          ? [
              {
                question: fillTemplate(q.question, childName, childGender),
                answer,
              },
            ]
          : [];
      }),
    [askedQuestions, childName, childGender],
  );

  /** The one and only write for the reflection step, on Finish at question five. */
  const handleSaveAnswers = useCallback(
    async (
      area: GrowthArea,
      answers: Record<string, string>,
    ): Promise<boolean> => {
      if (!childId) return false;
      setIsSaving(true);
      try {
        await api.completedGrowthAreas.append(childId, {
          area_id: area.id,
          area_name: area.name,
          answers,
          status: 'in_progress',
          step: 'activity_summary',
          interactive_answers: answers,
        });
        setSavedAnswers(prev => ({ ...prev, [area.id]: answers }));
        // Stage two starts here: the child's choices are built from the answers
        // just written, and the wait runs underneath the handoff beat.
        ensureChild(area, qaPairsFor(area.id, answers));
        return true;
      } catch (err) {
        console.error('[GrowthAreas] Saving reflection failed:', err);
        toast.error('Could not save your answers. Please try again.');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [childId, ensureChild, qaPairsFor],
  );

  /**
   * Runs once the recs job reports 'completed'. Reads the worker's staged
   * output and, in the same request, both promotes it to the canonical field
   * and marks the area complete.
   */
  const finalizeRecommendations = useCallback(async () => {
    const area = recsAreaRef.current;
    if (!childId || !area) return;
    try {
      const completedData = await api.completedGrowthAreas.list(childId);
      const areaDoc = (completedData.areas ?? []).find(
        a => a.area_id === area.id,
      );
      const pendingRaw = areaDoc?.pending_recommendations as
        | Record<string, unknown>
        | undefined;
      const pending: StoredRecommendation[] | undefined = Array.isArray(
        pendingRaw,
      )
        ? (pendingRaw as StoredRecommendation[])
        : Array.isArray(pendingRaw?.recommendations)
        ? (pendingRaw.recommendations as StoredRecommendation[])
        : undefined;

      if (pending && pending.length > 0) {
        setRecommendations(normalizeRecommendations(pending));
        setRecsStatus('ready');
        // The backend unsets interactive_answers on status:'completed' — writing
        // the same values under `answers` keeps them attached to the finished area.
        await api.completedGrowthAreas.append(childId, {
          area_id: area.id,
          area_name: area.name,
          answers: recsAnswersRef.current,
          status: 'completed',
          step: 'activity_summary',
          ai_three_month_recommendations: pending,
        });
        setCompletedAreaIds(prev => new Set(prev).add(area.id));
        // grow_completed is derived server-side from this same growth_areas write.
        const picks = recsPicksRef.current;
        if (picks) {
          setCompletedResults(prev => ({
            ...prev,
            [area.id]: {
              picks,
              recommendations: normalizeRecommendations(pending),
            },
          }));
        }
      } else {
        setRecsStatus('error');
      }
    } catch (err) {
      console.error('[GrowthAreas] Failed to finalize recommendations:', err);
      setRecsStatus('error');
      toast.error('Recommendations could not be saved. Please try again.');
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_recommendations',
    onCompleted: finalizeRecommendations,
  });
  const { enqueue: jobEnqueue } = job;

  /**
   * The one and only write for the child's rounds, after round six — followed
   * immediately by kicking off recommendation generation.
   */
  const handleCompleteRounds = useCallback(
    async (area: GrowthArea, pickedIds: string[]) => {
      if (!childId) return;

      // A same-session replay with identical parent answers AND identical picks
      // already has valid recommendations in state — reuse them.
      const currentAnswers = savedAnswers[area.id] ?? {};
      const answersUnchanged =
        JSON.stringify(recsAnswersRef.current) ===
        JSON.stringify(currentAnswers);
      const prevPicks = recsPicksRef.current;
      const isIdenticalReplay =
        recsAreaRef.current?.id === area.id &&
        recsStatus === 'ready' &&
        answersUnchanged &&
        prevPicks !== null &&
        prevPicks.length === pickedIds.length &&
        prevPicks.every((id, i) => id === pickedIds[i]);
      if (isIdenticalReplay) return;

      recsAreaRef.current = area;
      recsAnswersRef.current = savedAnswers[area.id] ?? {};
      recsPicksRef.current = pickedIds;
      setRecsStatus('loading');
      setRecommendations([]);
      setIsSaving(true);
      try {
        await api.completedGrowthAreas.append(childId, {
          area_id: area.id,
          area_name: area.name,
          answers: savedAnswers[area.id] ?? {},
          status: 'in_progress',
          step: 'activity_summary',
          // Transient — the backend unsets this on completion.
          child_activity_selections: pickedIds,
          // Durable — lets a finished area be reopened straight into its result.
          child_activity: { selections: pickedIds },
        });

        // The questions this child was actually asked, not a template.
        const answers = savedAnswers[area.id] ?? {};
        const qaContext = askedQuestions(area.id)
          .filter(q => answers[q.id])
          .map(
            q =>
              `Q: ${fillTemplate(q.question, childName, childGender)}\n` +
              `   (${fillTemplate(q.hint, childName, childGender)})\n` +
              `A: ${String(answers[q.id])}`,
          )
          .join('\n\n');
        const rounds = resolveRounds(area.id, roundsFor(area.id), pickedIds);
        const archetype = topArchetype(area.id, rounds, pickedIds)?.archetype;

        await jobEnqueue({
          type: 'generate_recommendations',
          child_id: childId,
          payload: {
            prompt: buildGrowthAreaRecommendationsPrompt({
              childName: childName || 'the child',
              childAge: childAge || null,
              childGender: childGender || null,
              areaName: area.name,
              qaContext,
              childChoices: pickedOptions(rounds, pickedIds).map(o => o.text),
              childArchetype: archetype
                ? {
                    title: archetype.title,
                    line: fillTemplate(archetype.line, childName, childGender),
                  }
                : null,
            }),
            response_json_schema: {
              type: 'object',
              properties: {
                recommendations: {
                  type: 'array',
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    properties: {
                      title: {
                        type: 'string',
                        maxLength: 70,
                        description:
                          'At most 10 words. A short label for the action, not a sentence.',
                      },
                      detail: {
                        type: 'string',
                        maxLength: 190,
                        description:
                          'At most 25 words. One instruction: the action plus its frequency.',
                      },
                    },
                    required: ['title', 'detail'],
                  },
                },
              },
            },
          },
          write_back: {
            collection: 'growth_areas',
            filter: { area_id: area.id },
            field: 'pending_recommendations',
          },
        });
      } catch (err) {
        console.error('[GrowthAreas] Saving child rounds failed:', err);
        setRecsStatus('error');
        toast.error('Could not save the answers. Please try again.');
      } finally {
        setIsSaving(false);
      }
    },
    [
      childId,
      savedAnswers,
      childName,
      childAge,
      childGender,
      jobEnqueue,
      recsStatus,
      askedQuestions,
      roundsFor,
    ],
  );

  // job.isComplete fires before finalizeRecommendations' async write lands,
  // which would otherwise flash "generating" → "no recs yet" for a moment.
  const isGeneratingRecs =
    job.isLoading || (job.isComplete && recsStatus !== 'ready');
  const recsPhase: 'idle' | 'loading' | 'ready' | 'error' = isGeneratingRecs
    ? 'loading'
    : job.isFailed
    ? 'error'
    : recsStatus;

  /** A finished area with a durable picks record opens straight into its result. */
  const handleAreaClick = useCallback(
    (area: GrowthArea) => {
      const cached = completedResults[area.id];
      if (cached) {
        recsAreaRef.current = area;
        recsAnswersRef.current = savedAnswers[area.id] ?? {};
        recsPicksRef.current = cached.picks;
        setRecsStatus('ready');
        setRecommendations(cached.recommendations);
      } else {
        // Stage one. Skipped for a finished area, which never shows a question.
        ensureParent(area);
      }
      setActiveArea(area);
    },
    [completedResults, savedAnswers, ensureParent],
  );

  /** Play Again on an area finished before its rounds were ever generated. */
  const handleReplayRounds = useCallback(
    (area: GrowthArea) => {
      ensureChild(area, qaPairsFor(area.id, savedAnswers[area.id] ?? {}));
    },
    [ensureChild, qaPairsFor, savedAnswers],
  );

  // web: motion.div initial opacity 0 → animate opacity (showSplash ? 0 : 1), 0.8s easeOut.
  const pageOpacity = useSharedValue(0);
  useEffect(() => {
    pageOpacity.value = withTiming(showSplash ? 0 : 1, {
      duration: 800,
      easing: EASE_OUT,
    });
  }, [showSplash, pageOpacity]);
  const pageStyle = useAnimatedStyle(() => ({ opacity: pageOpacity.value }));

  // The scene fills the viewport under the header (web: min-h-[calc(100vh-4rem)]).
  const sceneMinH = winH - (HEADER_HEIGHT + insets.top);
  // Arc box: the page's px-4 container.
  const arcW = winW - 32;

  const cachedActive = activeArea ? completedResults[activeArea.id] : undefined;

  return (
    <View className="flex-1 bg-background">
      <Animated.View style={[{ flex: 1 }, pageStyle]}>
        {isLoadingAuth || !hydrated ? (
          <>
            <PageBackRow />
            <PageLoader />
          </>
        ) : (
          <ScrollView
            className="flex-1 bg-background"
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <PageBackRow />
            <View
              key={showSplash ? 'splash' : 'content'}
              style={{
                minHeight: sceneMinH,
                overflow: 'hidden',
                backgroundColor: rgb('constellation-navy-deep'),
              }}
            >
              <Starfield />

              {/* Nebula wash — lifts the centre of the arc out of the flat black */}
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1,
                  experimental_backgroundImage: NEBULA,
                }}
              />

              <View
                style={{
                  zIndex: 2,
                  flexGrow: 1,
                  minHeight: sceneMinH,
                  paddingHorizontal: 16,
                  paddingTop: 24,
                  paddingBottom: 24 + insets.bottom,
                }}
              >
                <Animated.View
                  entering={HEADER_IN}
                  style={{ flexShrink: 0, alignItems: 'center' }}
                >
                  <Text
                    style={{
                      marginBottom: 8,
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      fontSize: 10.5,
                      letterSpacing: 10.5 * 0.4,
                      textAlign: 'center',
                      color: rgb('constellation-cyan-bright'),
                    }}
                  >
                    {childName ? `${childName} · Growth Map` : 'Growth Map'}
                  </Text>
                  <Text
                    accessibilityRole="header"
                    style={[
                      font('orbitron', 700),
                      {
                        fontSize: 22,
                        textAlign: 'center',
                        color: rgb('constellation-cyan-pale'),
                      },
                    ]}
                  >
                    Growth Areas
                  </Text>
                  <Text
                    style={{
                      marginTop: 6,
                      fontWeight: '600',
                      fontSize: 14,
                      letterSpacing: 14 * 0.05,
                      textAlign: 'center',
                      color: rgb('constellation-slate-dark'),
                    }}
                  >
                    Choose an area to explore
                  </Text>
                </Animated.View>

                <Animated.View
                  entering={ARC_IN}
                  style={{
                    flex: 1,
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 24,
                  }}
                >
                  <View
                    style={{ position: 'relative', width: arcW, height: ARC_H }}
                  >
                    {/* Arc guide — a vertical zigzag through the ladder's node positions. */}
                    <Svg
                      pointerEvents="none"
                      width={arcW}
                      height={ARC_H}
                      style={{ position: 'absolute', left: 0, top: 0 }}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Path
                        d={scalePath(GUIDE_SOLID, arcW / 100, ARC_H / 100)}
                        fill="none"
                        stroke={rgb('constellation-cyan', 0.22)}
                        strokeWidth={1}
                      />
                      <Path
                        d={scalePath(GUIDE_DASHED, arcW / 100, ARC_H / 100)}
                        fill="none"
                        stroke={rgb('constellation-cyan', 0.08)}
                        strokeWidth={1}
                        strokeDasharray="3 10"
                      />
                    </Svg>

                    {GROWTH_AREAS.map((area, i) => {
                      const done = completedAreaIds.has(area.id);
                      const pos = MOBILE_POS[i] ?? area.pos;
                      return (
                        // The wrapper owns the centring offset; the entrance scale lives on it too.
                        <Animated.View
                          key={area.id}
                          entering={NODE_IN[i]}
                          style={{
                            position: 'absolute',
                            left: (pos.left / 100) * arcW - NODE / 2,
                            top: (pos.top / 100) * ARC_H - NODE / 2,
                            width: NODE,
                            height: NODE,
                          }}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${area.name}${
                              done ? ' (completed)' : ''
                            } — ${area.description}`}
                            onPress={() => handleAreaClick(area)}
                            style={({ pressed }) => [
                              {
                                width: NODE,
                                height: NODE,
                                borderRadius: NODE / 2,
                              },
                              pressed ? { transform: [{ scale: 0.97 }] } : null,
                            ]}
                          >
                            <View
                              style={{
                                width: NODE,
                                height: NODE,
                                borderRadius: NODE / 2,
                                alignItems: 'center',
                                justifyContent: 'center',
                                experimental_backgroundImage: NODE_BG,
                                borderWidth: 1.5,
                                borderColor: done
                                  ? rgb('constellation-gold', 0.95)
                                  : rgb('constellation-gold', 0.75),
                                boxShadow: done
                                  ? `0 0 0 2px ${hueAlpha(
                                      area.hue,
                                      0.5,
                                    )}, 0 0 30px ${hueAlpha(area.hue, 0.45)}`
                                  : `0 0 18px ${hueAlpha(area.hue, 0.18)}`,
                              }}
                            >
                              <PathIcon
                                d={area.iconPath}
                                size={ICON}
                                stroke={area.iconColor}
                                strokeWidth={1.8}
                              />
                            </View>

                            {done && (
                              <View
                                style={{
                                  position: 'absolute',
                                  top: -2,
                                  right: -2,
                                  width: BADGE,
                                  height: BADGE,
                                  borderRadius: BADGE / 2,
                                  backgroundColor: rgb(
                                    'constellation-navy-deep',
                                  ),
                                  borderWidth: 1.5,
                                  borderColor: rgb('constellation-gold', 0.8),
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  zIndex: 3,
                                }}
                              >
                                {/* The mockup's 12-in-22 tick, held as a ratio. */}
                                <PathIcon
                                  d={CHECK_PATH}
                                  size={BADGE * (12 / 22)}
                                  stroke={rgb('constellation-gold')}
                                  strokeWidth={3}
                                />
                              </View>
                            )}

                            <Text
                              numberOfLines={1}
                              style={{
                                position: 'absolute',
                                top: NODE + 10,
                                left: (NODE - LABEL_W) / 2,
                                width: LABEL_W,
                                textAlign: 'center',
                                fontWeight: '700',
                                fontSize: 13.5,
                                color: done
                                  ? rgb('constellation-cyan-paler')
                                  : rgb('constellation-slate-dark'),
                              }}
                            >
                              {area.name}
                            </Text>
                          </Pressable>
                        </Animated.View>
                      );
                    })}
                  </View>
                </Animated.View>
              </View>
            </View>
          </ScrollView>
        )}
      </Animated.View>

      {activeArea && (
        <GrowthAreaSheet
          key={activeArea.id}
          area={activeArea}
          childName={childName}
          childGender={childGender}
          parentQuestions={{
            data: generated.questions,
            status: generated.parent.status,
            progress: generated.parent.progressMessage,
            onRetry: generated.parent.retry,
          }}
          childRounds={{
            data: generated.rounds,
            status: generated.child.status,
            progress: generated.child.progressMessage,
            onRetry: generated.child.retry,
          }}
          initialAnswers={savedAnswers[activeArea.id]}
          initialPhase={cachedActive ? 'result' : 'questions'}
          initialPicks={cachedActive?.picks}
          isSaving={isSaving}
          recsPhase={recsPhase}
          recommendations={recommendations}
          onClose={() => {
            if (!isSaving) setActiveArea(null);
          }}
          onSaveAnswers={answers => handleSaveAnswers(activeArea, answers)}
          onReplayRounds={() => handleReplayRounds(activeArea)}
          onCompleteRounds={pickedIds => {
            void handleCompleteRounds(activeArea, pickedIds);
          }}
          onExploreTransform={() => {
            // The web unmounts this page on navigate; a stack screen stays mounted
            // underneath, so close the sheet's Modal explicitly before pushing.
            setActiveArea(null);
            navigate(`/LifePathway/${childId ?? ''}`);
          }}
        />
      )}

      {showSplash && <StageSplash stage={7} onReady={startTimer} />}
    </View>
  );
}
