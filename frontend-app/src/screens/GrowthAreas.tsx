import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { Button } from '@/components/ui/button';
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
import { useGrowthAreaQuestions } from '@/hooks/useGrowthAreaQuestions';
import { useAuth } from '@/lib/AuthContext';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { children } from '@/api/children';
import { ApiError } from '@/api/errors';
import {
  areaSave,
  grow,
  GROW_ERRORS,
  recommendationsAreCurrent,
  runGrowGeneration,
  type GrowthAreaDoc,
} from '@/api/grow';
import { isAbort } from '@/api/polling';
import { httpErrorMessage } from '@/lib/apiError';
import { GROWTH_AREAS, normalizeRecommendations } from '@/lib/growthAreaData';
import type { GrowthArea, GrowthRecommendation } from '@/lib/growthAreaData';
import PageLoader from '@/components/shared/PageLoader';
import Starfield from '@/components/shared/Starfield';
import PageBackRow from '@/components/layout/PageBackRow';
import { HEADER_HEIGHT } from '@/components/layout/AppHeader';
import GrowthAreaSheet, {
  type RecsPhase,
} from '@/components/growth/GrowthAreaSheet';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';
import { useKidWorlds } from '@/hooks/useKidWorlds';
import { worldSummary } from '@/api/kidWorlds';
import {
  EASE_OUT,
  EASE_OUT_EXPO,
  PathIcon,
  fadeUp,
  hueAlpha,
  scalePath,
} from '@/components/growth/shared';
import { GROWTH_VIGNETTE } from '@/components/growth/palette';
import { css, font, recipe, rgb } from '@/theme';

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

/** How many of an area's reflections the parent has saved. */
const answeredCount = (doc: GrowthAreaDoc | undefined) =>
  Object.values(doc?.answers ?? {}).filter(
    v => typeof v === 'string' && v.trim(),
  ).length;

export default function GrowthAreas() {
  const navigate = useNavigate();
  const { childId } = useParams();
  // The child's world runs in child view (3.6): a score under each area, and its insights.
  const {
    worlds: kidWorlds,
    isLoading: worldsLoading,
    isLoadingError: worldsFailed,
  } = useKidWorlds(childId);
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [childName, setChildName] = useState('');
  const [childGender, setChildGender] = useState('');
  const [hydrated, setHydrated] = useState(false);
  // A failed load is not "no areas yet": it would show finished areas as not started.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * The child's areas as grow stores them (build plan 7.6), which also carry the
   * generated question sets. Each save's answer replaces its entry, so everything
   * below derived from these stays current.
   */
  const [areaDocs, setAreaDocs] = useState<GrowthAreaDoc[]>([]);
  const [activeArea, setActiveArea] = useState<GrowthArea | null>(null);
  // The area whose sheet is on its insights, and a tick to look again when shown anew.
  const [insightsFor, setInsightsFor] = useState<string | null>(null);
  const [insightsTick, setInsightsTick] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [recsStatus, setRecsStatus] = useState<RecsPhase>('idle');
  const [recommendations, setRecommendations] = useState<
    GrowthRecommendation[]
  >([]);
  const [showSplash, startTimer] = useStageSplash(0);
  // Which area the shown recommendations belong to: a generation outlives the sheet,
  // and must not show its result in another area's sheet.
  const recsAreaRef = useRef<string | null>(null);
  // Areas with a recommendations job running, and the input a generation last failed on
  // (not retried by itself). Whether the answers or feedback changed since an area's
  // recommendations is grow's to say (`recommendations_current`).
  const recsRunningRef = useRef(new Set<string>());
  const failedRef = useRef(new Map<string, string>());
  // The input each area's recommendations were last written from here. Grow records
  // the run it used, which can be newer than this page's worlds; without this a
  // success would look stale against them and be written again, and again.
  const writtenRef = useRef(new Map<string, string>());
  // Stops polling when the page goes away.
  const abortRef = useUnmountSignal();

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
        // The child's own fields from children, the areas from grow.
        const [child, areas] = await Promise.all([
          children.get(childId),
          grow.list(childId),
        ]);
        if (cancelled) return;
        setChildName(child.name);
        setChildGender(child.gender ?? '');
        setAreaDocs(areas);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'circle_locked') {
          // Discover isn't done yet: back to the journey.
          void navigate(`/PersonalityJourney/${childId}`, { replace: true });
          return;
        }
        if (err instanceof ApiError && err.code === 'child_not_found') {
          void navigate('/Home', { replace: true });
          return;
        }
        console.warn('[GrowthAreas] Load failed:', err);
        setLoadFailed(true);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate, reloadKey]);

  // Ambient track is shared across the whole journey (see AmbientAudioContext) —
  // keep it silent while the splash video plays its own audio, same as before.
  useEffect(() => {
    setAmbientSuppressed(showSplash || !hydrated);
    return () => setAmbientSuppressed(false);
  }, [showSplash, hydrated, setAmbientSuppressed]);

  const docOf = useCallback(
    (areaId: string) => areaDocs.find(doc => doc.area_id === areaId),
    [areaDocs],
  );
  const keep = useCallback((saved: GrowthAreaDoc) => {
    setAreaDocs(prev =>
      prev.some(doc => doc.area_id === saved.area_id)
        ? prev.map(doc => (doc.area_id === saved.area_id ? saved : doc))
        : [...prev, saved],
    );
  }, []);

  const completedAreaIds = useMemo(
    () =>
      new Set(
        areaDocs
          .filter(doc => doc.status === 'completed')
          .map(doc => doc.area_id),
      ),
    [areaDocs],
  );
  // Prefill a redo of an area the parent already answered. The reflection sheet
  // filters these down to the current question ids itself.
  const savedAnswers = useMemo(
    () => Object.fromEntries(areaDocs.map(doc => [doc.area_id, doc.answers])),
    [areaDocs],
  );

  const generated = useGrowthAreaQuestions({
    childId,
    areas: areaDocs,
    area: activeArea,
    enabled: hydrated,
  });
  const { ensureParent } = generated;

  /** The child's latest run of an area's world; null until played (or while unknown). */
  const worldOf = useCallback(
    (area: GrowthArea) =>
      kidWorlds ? worldSummary(kidWorlds, area.name) : null,
    [kidWorlds],
  );
  // Until the runs are known, a missing world can't be told from an unplayed one.
  const worldsReady = !worldsLoading;

  /**
   * The one write for the reflections, on Finish at question five. Returns whether it
   * landed, so the sheet holds position on failure rather than losing the answers.
   */
  const handleSaveAnswers = useCallback(
    async (
      area: GrowthArea,
      answers: Record<string, string>,
    ): Promise<boolean> => {
      if (!childId) return false;
      setIsSaving(true);
      try {
        const stored = docOf(area.id);
        keep(
          await grow.save(
            childId,
            area.id,
            areaSave(stored, area.name, { answers, step: 'activity_summary' }),
          ),
        );
        setInsightsFor(area.id);
        setInsightsTick(t => t + 1);
        return true;
      } catch (err) {
        console.error('[GrowthAreas] Saving reflection failed:', err);
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: GROW_ERRORS,
            fallback: 'Could not save your answers. Please try again.',
          }),
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [childId, docOf, keep],
  );

  /**
   * Generates the area's recommendations from its answers and the child's latest run of
   * its world, and shows them. Grow completes an answered area when they're written, and
   * publishes the first completion, which unlocks Transform.
   */
  const generateRecommendations = useCallback(
    async (area: GrowthArea, input: string) => {
      if (!childId) return;
      const isCurrent = () => recsAreaRef.current === area.id;
      setRecsStatus('loading');
      if (recsRunningRef.current.has(area.id)) return;
      recsRunningRef.current.add(area.id);
      try {
        const outcome = await runGrowGeneration(
          childId,
          area.id,
          'recommendations',
          { signal: abortRef.current.signal },
        );
        const doc =
          outcome === 'completed'
            ? (await grow.list(childId)).find(a => a.area_id === area.id)
            : undefined;
        const recs = normalizeRecommendations(
          doc?.ai_three_month_recommendations,
        );
        if (!doc || recs.length === 0) {
          failedRef.current.set(area.id, input);
          if (isCurrent()) setRecsStatus('error');
          return;
        }
        writtenRef.current.set(area.id, input);
        if (isCurrent()) {
          setRecommendations(recs);
          setRecsStatus('ready');
        }
        // Grow completed an answered area in the job itself (the first one unlocks
        // Transform), so this page leaving now loses nothing: no save of its own.
        keep(doc);
      } catch (err) {
        if (isAbort(err)) return;
        console.error('[GrowthAreas] Recommendations failed:', err);
        failedRef.current.set(area.id, input);
        if (isCurrent()) setRecsStatus('error');
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: GROW_ERRORS,
            fallback: 'Recommendations could not be written. Please try again.',
          }),
        );
      } finally {
        recsRunningRef.current.delete(area.id);
      }
    },
    [abortRef, childId, keep],
  );

  /**
   * Shows the area's stored recommendations when they are current, and writes new ones
   * when they aren't: none yet, the answers or feedback changed (grow says so), or the
   * child played the world again since (grow records the run they were written from).
   * With neither answers nor a run there is nothing to write them from.
   */
  const refreshRecommendations = useCallback(
    (area: GrowthArea, { retry = false } = {}) => {
      if (!worldsReady) return;
      recsAreaRef.current = area.id;
      const doc = docOf(area.id);
      const world = worldOf(area);
      if (answeredCount(doc) === 0 && !world) {
        setRecommendations([]);
        setRecsStatus('idle');
        return;
      }
      const stored = normalizeRecommendations(
        doc?.ai_three_month_recommendations,
      );
      // What they'd be written from: a failed attempt isn't repeated by itself.
      const input = `${world?.at ?? ''}|${JSON.stringify(doc?.answers ?? {})}`;
      const fresh =
        stored.length > 0 &&
        recommendationsAreCurrent(doc, world?.at, {
          runsUnknown: worldsFailed,
          writtenHere: writtenRef.current.get(area.id) === input,
        });
      if (fresh) {
        setRecommendations(stored);
        setRecsStatus('ready');
        return;
      }
      if (!retry && failedRef.current.get(area.id) === input) {
        setRecsStatus('error');
        return;
      }
      failedRef.current.delete(area.id);
      void generateRecommendations(area, input);
    },
    [worldsReady, worldsFailed, docOf, worldOf, generateRecommendations],
  );

  useEffect(() => {
    const area = GROWTH_AREAS.find(a => a.id === insightsFor);
    if (area) refreshRecommendations(area);
  }, [insightsFor, insightsTick, refreshRecommendations]);

  /** An answered area opens on its insights; one that isn't, on its questions. */
  const handleAreaClick = useCallback(
    (area: GrowthArea) => {
      // The questions are wanted either way: the Reflection tab shows them.
      ensureParent(area);
      setRecommendations([]);
      setRecsStatus('idle');
      setInsightsFor(answeredCount(docOf(area.id)) > 0 ? area.id : null);
      setInsightsTick(t => t + 1);
      setActiveArea(area);
    },
    [docOf, ensureParent],
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

  return (
    <View className="flex-1 bg-background">
      <Animated.View style={[{ flex: 1 }, pageStyle]}>
        {isLoadingAuth || !hydrated ? (
          <>
            <PageBackRow />
            <PageLoader />
          </>
        ) : loadFailed ? (
          <>
            <PageBackRow />
            <View
              className="flex-1 items-center justify-center gap-4 px-4"
              style={{ backgroundColor: rgb('constellation-navy-deep') }}
            >
              <Text className="text-center text-muted-foreground">
                We could not load this page. Please try again.
              </Text>
              <Button
                onPress={() => {
                  setLoadFailed(false);
                  setHydrated(false);
                  setReloadKey(k => k + 1);
                }}
                className="rounded-2xl px-8 font-semibold text-primary-foreground"
                style={recipe.btnPrimary}
              >
                Try again
              </Button>
            </View>
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
                            {kidWorlds && worldSummary(kidWorlds, area.name) ? (
                              <Text
                                numberOfLines={1}
                                style={{
                                  position: 'absolute',
                                  top: NODE + 30,
                                  left: (NODE - LABEL_W) / 2,
                                  width: LABEL_W,
                                  textAlign: 'center',
                                  fontWeight: '700',
                                  // The prototype's 10.5px, uppercase, .16em (reads "KIDS 78").
                                  fontSize: 10.5,
                                  letterSpacing: 10.5 * 0.16,
                                  textTransform: 'uppercase',
                                  color: rgb('constellation-gold'),
                                }}
                              >
                                Kids {worldSummary(kidWorlds, area.name)?.total}
                              </Text>
                            ) : null}
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
          initialAnswers={savedAnswers[activeArea.id]}
          initialPhase={
            insightsFor === activeArea.id ? 'insights' : 'questions'
          }
          answered={answeredCount(docOf(activeArea.id))}
          world={worldOf(activeArea)}
          isSaving={isSaving}
          recsPhase={recsStatus}
          recommendations={recommendations}
          onClose={() => {
            if (isSaving) return;
            setActiveArea(null);
            setInsightsFor(null);
          }}
          onSaveAnswers={answers => handleSaveAnswers(activeArea, answers)}
          onShowInsights={() => {
            setInsightsFor(activeArea.id);
            setInsightsTick(t => t + 1);
          }}
          onRetryRecommendations={() =>
            refreshRecommendations(activeArea, { retry: true })
          }
          onExploreTransform={() => {
            // The web unmounts this page on navigate; a stack screen stays mounted
            // underneath, so close the sheet's Modal explicitly before pushing.
            setActiveArea(null);
            setInsightsFor(null);
            navigate(`/LifePathway/${childId ?? ''}`);
          }}
        />
      )}

      {showSplash && <StageSplash stage={7} onReady={startTimer} />}
    </View>
  );
}
