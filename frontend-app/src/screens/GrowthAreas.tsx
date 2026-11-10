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

export default function GrowthAreas() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [childName, setChildName] = useState('');
  const [childGender, setChildGender] = useState('');
  const [hydrated, setHydrated] = useState(false);
  // A load that failed for any reason other than a redirect: shows Try again.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * The child's areas as grow stores them (build plan 7.6), which also carry the
   * generated question sets. Each save's answer replaces its entry, so everything
   * below derived from these stays current.
   */
  const [areaDocs, setAreaDocs] = useState<GrowthAreaDoc[]>([]);
  const [activeArea, setActiveArea] = useState<GrowthArea | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recsStatus, setRecsStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [recommendations, setRecommendations] = useState<
    GrowthRecommendation[]
  >([]);
  const [showSplash, startTimer] = useStageSplash(0);
  // Which area the in-flight/last recommendations generation belongs to — the
  // sheet only ever shows results for the area it's currently open on, but the
  // generation itself is anchored here so it survives the parent closing the sheet.
  const recsAreaRef = useRef<GrowthArea | null>(null);
  // The answers and picks the CURRENT `recommendations` were generated for. Lets a
  // same-session replay (Play Again → identical six choices) reuse what's already
  // showing instead of generating again for no-op input.
  const recsAnswersRef = useRef<Record<string, string>>({});
  const recsPicksRef = useRef<string[] | null>(null);
  // Stops polling when the page goes away.
  const abortRef = useRef<AbortController>(new AbortController());
  useEffect(() => () => abortRef.current.abort(), []);

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
  // Lets a finished area open straight into its result (constellation +
  // recommendations) instead of forcing a full redo just to look at it again.
  const completedResults = useMemo(() => {
    const results: Record<
      string,
      { picks: string[]; recommendations: GrowthRecommendation[] }
    > = {};
    for (const doc of areaDocs) {
      if (doc.status !== 'completed') continue;
      const recs = normalizeRecommendations(doc.ai_three_month_recommendations);
      const picks = (doc.child_activity as { selections?: unknown } | null)
        ?.selections;
      if (
        recs.length > 0 &&
        Array.isArray(picks) &&
        picks.every(p => typeof p === 'string')
      ) {
        results[doc.area_id] = { picks, recommendations: recs };
      }
    }
    return results;
  }, [areaDocs]);

  /**
   * Both question sets, generated per child per area by grow and stored on the
   * area's document. Anchored on the page rather than in the sheet so a generation
   * survives the parent closing the sheet mid-way.
   */
  const generated = useGrowthAreaQuestions({
    childId,
    areas: areaDocs,
    area: activeArea,
    enabled: hydrated,
  });
  const { ensureParent, ensureChild } = generated;

  /**
   * The one and only write for the reflection step, on Finish at question five.
   * Returns whether it landed so the sheet can hold position on failure rather
   * than handing a device to the child with the parent's answers lost.
   */
  const handleSaveAnswers = useCallback(
    async (
      area: GrowthArea,
      answers: Record<string, string>,
    ): Promise<boolean> => {
      if (!childId) return false;
      setIsSaving(true);
      try {
        keep(
          await grow.save(
            childId,
            area.id,
            areaSave(docOf(area.id), area.name, {
              answers,
              step: 'activity_summary',
            }),
          ),
        );
        // Stage two starts here, not on the click that opened this area: grow builds
        // the child's choices from the answers just saved, and the wait then runs
        // underneath the handoff beat the parent is about to read.
        ensureChild(area);
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
    [childId, docOf, keep, ensureChild],
  );

  /**
   * Generates the area's recommendations from what's saved on it, shows them, then
   * completes the area. Grow publishes the first completion, which unlocks Transform.
   */
  const generateRecommendations = useCallback(
    async (area: GrowthArea) => {
      if (!childId) return;
      try {
        const outcome = await runGrowGeneration(
          childId,
          area.id,
          'recommendations',
          {
            signal: abortRef.current.signal,
          },
        );
        // The parent may have opened another area meanwhile: its sheet must not show
        // this one's result, but this area still gets completed below.
        const isCurrent = () => recsAreaRef.current?.id === area.id;
        const doc =
          outcome === 'completed'
            ? (await grow.list(childId)).find(a => a.area_id === area.id)
            : undefined;
        const recs = normalizeRecommendations(
          doc?.ai_three_month_recommendations,
        );
        if (!doc || recs.length === 0) {
          if (isCurrent()) setRecsStatus('error');
          return;
        }
        if (isCurrent()) {
          setRecommendations(recs);
          setRecsStatus('ready');
        }
        keep(
          await grow.save(
            childId,
            area.id,
            areaSave(doc, area.name, { status: 'completed' }),
          ),
        );
      } catch (err) {
        if (isAbort(err)) return;
        console.error('[GrowthAreas] Recommendations failed:', err);
        if (recsAreaRef.current?.id === area.id)
          setRecsStatus(status => (status === 'ready' ? status : 'error'));
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: GROW_ERRORS,
            fallback: 'Recommendations could not be saved. Please try again.',
          }),
        );
      }
    },
    [childId, keep],
  );

  /**
   * The one and only write for the child's rounds, after round six — followed
   * immediately by generating the recommendations. The sheet moves to its result
   * phase optimistically (the archetype is derived client-side, no network
   * needed); recsStatus/recommendations stream back down as the generation runs.
   */
  const handleCompleteRounds = useCallback(
    async (area: GrowthArea, pickedIds: string[]) => {
      if (!childId) return;

      // A same-session replay with the exact same parent answers AND the exact
      // same six picks (e.g. Play Again, then choosing identically) already has
      // valid recommendations sitting in state — reuse them instead of
      // generating again for input that hasn't changed.
      const currentAnswers = savedAnswers[area.id] ?? {};
      const answersUnchanged =
        JSON.stringify(recsAnswersRef.current) ===
        JSON.stringify(currentAnswers);
      const isIdenticalReplay =
        recsAreaRef.current?.id === area.id &&
        recsStatus === 'ready' &&
        answersUnchanged &&
        recsPicksRef.current !== null &&
        recsPicksRef.current.length === pickedIds.length &&
        recsPicksRef.current.every((id, i) => id === pickedIds[i]);
      if (isIdenticalReplay) return;

      recsAreaRef.current = area;
      recsAnswersRef.current = currentAnswers;
      recsPicksRef.current = pickedIds;
      setRecsStatus('loading');
      setRecommendations([]);
      setIsSaving(true);
      try {
        // The picks are what grow grounds the recommendations in, next to the answers.
        const stored = docOf(area.id);
        keep(
          await grow.save(
            childId,
            area.id,
            areaSave(stored, area.name, {
              step: 'activity_summary',
              child_activity: {
                ...stored?.child_activity,
                selections: pickedIds,
              },
            }),
          ),
        );
      } catch (err) {
        console.error('[GrowthAreas] Saving child rounds failed:', err);
        setRecsStatus('error');
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: GROW_ERRORS,
            fallback: 'Could not save the answers. Please try again.',
          }),
        );
        return;
      } finally {
        setIsSaving(false);
      }
      void generateRecommendations(area);
    },
    [childId, savedAnswers, recsStatus, docOf, keep, generateRecommendations],
  );

  const recsPhase = recsStatus;

  /**
   * A finished area with a durable picks record opens straight into its
   * result — no reason to make a parent redo five questions and a child redo
   * six rounds just to see what's already there. Play Again (inside the
   * result view) remains the way to redo the child's rounds on purpose.
   */
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
        // Stage one. Skipped for a finished area, which opens straight into its
        // result and never shows a question — generating a set it would not
        // display would only spend a parent's quota to fill a cache.
        ensureParent(area);
      }
      setActiveArea(area);
    },
    [completedResults, savedAnswers, ensureParent],
  );

  /**
   * Play Again on an area finished before its rounds were ever generated: the
   * result renders from the hardcoded set, but replaying deserves rounds of this
   * child's own, and the answers to ground them in are already saved.
   */
  const handleReplayRounds = useCallback(
    (area: GrowthArea) => ensureChild(area),
    [ensureChild],
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
