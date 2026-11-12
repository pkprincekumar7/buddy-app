import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useGrowthAreaQuestions } from '@/hooks/useGrowthAreaQuestions';
import { useAuth } from '@/lib/AuthContext';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { useIsMobile } from '@/hooks/use-mobile';
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
import { Button } from '@/components/ui/button';
import Starfield from '@/components/shared/Starfield';
import GrowthAreaSheet, { type RecsPhase } from '@/components/growth/GrowthAreaSheet';
import { useKidWorlds } from '@/hooks/useKidWorlds';
import { worldSummary } from '@/api/kidWorlds';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';

/**
 * Multiplies a design-time pixel value by `--ga-type-scale` — 1 on phones, 1.2
 * from the tablet breakpoint up (see the style block in the component).
 *
 * The design mockups for this app carry NO media queries — fixed pixel type at
 * every width. Scaling by viewport is a deliberate departure, matching what the
 * Connect, LifePathway and Observations pages already do. Do not "restore mockup
 * fidelity" here without checking that intent first.
 */
const gafs = (px: number) => `calc(${px}px * var(--ga-type-scale, 1))`;

// Node geometry. `pos` on each area is the design's desktop arc; on narrow
// screens the arc collapses to a two-column ladder, because six nodes spread
// across an arc overlap badly under ~640px.
//
// The desktop figures carry the same +20% as --ga-type-scale, so the nodes, their
// labels and the box all grow as one composition. ARC_W/ARC_H have to move with
// the node: `pos` is in percentages, so the distance between two nodes is a share
// of the box, and a bigger node in an unchanged box would close the arc up rather
// than open it out. Mobile is deliberately untouched — the ladder is already
// tight at 375px.
const NODE = 78;
const MOBILE_NODE = 58;
const ICON = 31;
const MOBILE_ICON = 26;
const BADGE = 26;
const MOBILE_BADGE = 22;
/** The box the percentage `pos` values resolve against. */
const ARC_W = 1040;
const ARC_H = 300;
const MOBILE_ARC_H = 560;

const MOBILE_POS = [
  { left: 27, top: 8 },
  { left: 73, top: 22 },
  { left: 27, top: 36 },
  { left: 73, top: 50 },
  { left: 27, top: 64 },
  { left: 73, top: 78 },
];

const LABEL: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  // Scaled with the label so the gap under a larger node stays proportional.
  marginTop: gafs(10),
  fontWeight: 700,
  fontSize: gafs(13.5),
  whiteSpace: 'nowrap',
  transition: 'color .3s ease',
};

/** How many of an area's reflections the parent has saved. */
const answeredCount = (doc: GrowthAreaDoc | undefined) =>
  Object.values(doc?.answers ?? {}).filter((v) => typeof v === 'string' && v.trim()).length;

const checkBadge = (size: number): React.CSSProperties => ({
  position: 'absolute',
  top: -2,
  right: -2,
  width: size,
  height: size,
  borderRadius: '50%',
  background: 'rgb(var(--constellation-navy-deep-rgb))',
  border: '1.5px solid rgb(var(--constellation-gold-rgb) / .8)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 3,
});

export default function GrowthAreas() {
  const navigate = useNavigate();
  const { childId } = useParams();
  // The child's world runs in child view (3.6): a score under each area, and its panel.
  const {
    worlds: kidWorlds,
    isLoading: worldsLoading,
    isLoadingError: worldsFailed,
  } = useKidWorlds(childId);
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();
  const isMobile = useIsMobile();
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
  const [recommendations, setRecommendations] = useState<GrowthRecommendation[]>([]);
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
        const [child, areas] = await Promise.all([children.get(childId), grow.list(childId)]);
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
    (areaId: string) => areaDocs.find((doc) => doc.area_id === areaId),
    [areaDocs],
  );
  const keep = useCallback((saved: GrowthAreaDoc) => {
    setAreaDocs((prev) =>
      prev.some((doc) => doc.area_id === saved.area_id)
        ? prev.map((doc) => (doc.area_id === saved.area_id ? saved : doc))
        : [...prev, saved],
    );
  }, []);

  const completedAreaIds = useMemo(
    () => new Set(areaDocs.filter((doc) => doc.status === 'completed').map((doc) => doc.area_id)),
    [areaDocs],
  );
  // Prefill a redo of an area the parent already answered. The reflection sheet
  // filters these down to the current question ids itself.
  const savedAnswers = useMemo(
    () => Object.fromEntries(areaDocs.map((doc) => [doc.area_id, doc.answers])),
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
    (area: GrowthArea) => (kidWorlds ? worldSummary(kidWorlds, area.name) : null),
    [kidWorlds],
  );
  // Until the runs are known, a missing world can't be told from an unplayed one.
  const worldsReady = !worldsLoading;

  /**
   * The one write for the reflections, on Finish at question five. Returns whether it
   * landed, so the sheet holds position on failure rather than losing the answers.
   */
  const handleSaveAnswers = useCallback(
    async (area: GrowthArea, answers: Record<string, string>): Promise<boolean> => {
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
        setInsightsTick((t) => t + 1);
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
        const outcome = await runGrowGeneration(childId, area.id, 'recommendations', {
          signal: abortRef.current.signal,
        });
        const doc =
          outcome === 'completed'
            ? (await grow.list(childId)).find((a) => a.area_id === area.id)
            : undefined;
        const recs = normalizeRecommendations(doc?.ai_three_month_recommendations);
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
      const stored = normalizeRecommendations(doc?.ai_three_month_recommendations);
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
    const area = GROWTH_AREAS.find((a) => a.id === insightsFor);
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
      setInsightsTick((t) => t + 1);
      setActiveArea(area);
    },
    [docOf, ensureParent],
  );

  const size = isMobile ? MOBILE_NODE : NODE;
  const iconSize = isMobile ? MOBILE_ICON : ICON;
  const badgeSize = isMobile ? MOBILE_BADGE : BADGE;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || !hydrated ? (
          <PageLoader />
        ) : loadFailed ? (
          <div
            className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-4"
            style={{ background: 'rgb(var(--constellation-navy-deep-rgb))' }}
          >
            <p className="text-muted-foreground">We could not load this page. Please try again.</p>
            <Button
              onClick={() => {
                setLoadFailed(false);
                setHydrated(false);
                setReloadKey((k) => k + 1);
              }}
              className="btn-primary rounded-2xl px-8"
            >
              Try again
            </Button>
          </div>
        ) : (
          <div
            key={showSplash ? 'splash' : 'content'}
            // The design composes this screen as a single fixed viewport. The
            // app's sticky nav is h-16, so subtract it rather than using
            // min-h-screen — otherwise the arc pushes the actions past the fold.
            className="ga-root relative min-h-[calc(100vh-4rem)] overflow-hidden"
            style={{ background: 'rgb(var(--constellation-navy-deep-rgb))' }}
          >
            <style>{`
              /* A flat +20% from the tablet breakpoint up, matching Connect,
                 LifePathway and Observations. 768px is also useIsMobile's
                 breakpoint, so the node geometry above steps at the same width
                 and type never grows out of step with the circles it labels.
                 Phones stay at 1: the eyebrow is already at 10.5px. */
              .ga-root { --ga-type-scale: 1; }
              @media (min-width: 768px) { .ga-root { --ga-type-scale: 1.2; } }
            `}</style>

            <Starfield />

            {/* Nebula wash — lifts the centre of the arc out of the flat black */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                background:
                  'radial-gradient(ellipse at 50% 45%,rgb(var(--constellation-cyan-bright-rgb) / .13),rgb(var(--constellation-navy-deep-rgb) / 0) 58%),radial-gradient(circle at 50% 50%,rgb(var(--constellation-navy-deep-rgb) / 0) 42%,rgba(2,3,9,.82) 100%)',
              }}
            />

            {/* max-w-6xl, not 5xl: 5xl (1024px) minus the padding capped the arc
                box below ARC_W, so the wider spacing would never have shown. */}
            <div className="relative z-[2] mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col px-4 py-6 md:py-8">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                className="flex-shrink-0 text-center"
              >
                <div
                  className="mb-2 font-bold uppercase"
                  style={{
                    fontSize: gafs(10.5),
                    letterSpacing: '.4em',
                    color: 'rgb(var(--constellation-cyan-bright-rgb))',
                  }}
                >
                  {childName ? `${childName} · Growth Map` : 'Growth Map'}
                </div>
                <h1
                  className="m-0 font-orbitron font-bold"
                  style={{
                    // The clamp is wrapped rather than replaced: it still does the
                    // fluid work between 22 and 32px, the scale then lifts the
                    // whole range. Passing the clamp raw would opt the one heading
                    // on the page out of --ga-type-scale.
                    fontSize: 'calc(clamp(22px,2.6vw,32px) * var(--ga-type-scale, 1))',
                    color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  }}
                >
                  Growth Areas
                </h1>
                <div
                  className="mt-1.5 font-semibold"
                  style={{
                    fontSize: gafs(14),
                    letterSpacing: '.05em',
                    color: 'rgb(var(--constellation-slate-dark-rgb))',
                  }}
                >
                  Choose an area to explore
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1, delay: 0.15, ease: 'easeOut' }}
                className="flex w-full flex-1 items-center justify-center py-6"
              >
                <div
                  className="relative w-full"
                  style={{
                    maxWidth: ARC_W,
                    height: isMobile ? MOBILE_ARC_H : ARC_H,
                  }}
                >
                  {/* Arc guides — stretched to the container, so they track the nodes.
                      Desktop is a single horizontal wave; mobile mirrors the two-column
                      ladder with a vertical zigzag through the same node positions. */}
                  {isMobile ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      <path
                        d="M27 8 C27 15 73 15 73 22 C73 29 27 29 27 36 C27 43 73 43 73 50 C73 57 27 57 27 64 C27 71 73 71 73 78"
                        fill="none"
                        stroke="rgb(var(--constellation-cyan-rgb) / .22)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d="M33 8 C33 15 67 15 67 22 C67 29 33 29 33 36 C33 43 67 43 67 50 C67 57 33 57 33 64 C33 71 67 71 67 78"
                        fill="none"
                        stroke="rgb(var(--constellation-cyan-rgb) / .08)"
                        strokeWidth="1"
                        strokeDasharray="3 10"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 1000 200"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      <path
                        d="M80 124 Q 500 -4 920 124"
                        fill="none"
                        stroke="rgb(var(--constellation-cyan-rgb) / .22)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d="M80 152 Q 500 24 920 152"
                        fill="none"
                        stroke="rgb(var(--constellation-cyan-rgb) / .08)"
                        strokeWidth="1"
                        strokeDasharray="3 10"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  )}

                  {GROWTH_AREAS.map((area, i) => {
                    const done = completedAreaIds.has(area.id);
                    const pos = isMobile ? (MOBILE_POS[i] ?? area.pos) : area.pos;
                    return (
                      // Plain wrapper owns the centring translate. It cannot live on
                      // the motion.button: Framer writes `transform` for scale, which
                      // would clobber translate(-50%,-50%) and leave every node
                      // positioned by its top-left corner instead of its centre —
                      // knocking the nodes off the arc by half a diameter.
                      <div
                        key={area.id}
                        className="absolute"
                        style={{
                          left: `${pos.left}%`,
                          top: `${pos.top}%`,
                          width: size,
                          height: size,
                          transform: 'translate(-50%,-50%)',
                        }}
                      >
                        <motion.button
                          type="button"
                          aria-label={`${area.name}${done ? ' (completed)' : ''} — ${area.description}`}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{
                            duration: 0.55,
                            delay: 0.25 + i * 0.08,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                          whileHover={{ scale: 1.08 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => handleAreaClick(area)}
                          className="relative cursor-pointer rounded-full"
                          style={{ width: size, height: size }}
                        >
                          <span
                            className="flex items-center justify-center rounded-full"
                            style={{
                              width: size,
                              height: size,
                              background:
                                'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
                              border: `1.5px solid ${done ? 'rgb(var(--constellation-gold-rgb) / .95)' : 'rgb(var(--constellation-gold-rgb) / .75)'}`,
                              boxShadow: done
                                ? `0 0 0 2px rgba(${area.hue},.5), 0 0 30px rgba(${area.hue},.45)`
                                : `0 0 18px rgba(${area.hue},.18)`,
                              transition: 'box-shadow .3s ease',
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={area.iconColor}
                              strokeWidth="1.8"
                              style={{ width: iconSize, height: iconSize }}
                            >
                              <path d={area.iconPath} />
                            </svg>
                          </span>

                          {done && (
                            <span style={checkBadge(badgeSize)}>
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="rgb(var(--constellation-gold-rgb))"
                                strokeWidth="3"
                                // The mockup's 12-in-22 tick, held as a ratio so
                                // the larger badge keeps the same proportion.
                                style={{
                                  width: badgeSize * (12 / 22),
                                  height: badgeSize * (12 / 22),
                                }}
                              >
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          )}

                          <span
                            style={{
                              ...LABEL,
                              color: done
                                ? 'rgb(var(--constellation-cyan-paler-rgb))'
                                : 'rgb(var(--constellation-slate-dark-rgb))',
                            }}
                          >
                            {area.name}
                          </span>
                          {kidWorlds && worldSummary(kidWorlds, area.name) && (
                            <span
                              style={{
                                ...LABEL,
                                // Under the name (LABEL is absolute): its gap plus one line.
                                marginTop: gafs(30),
                                fontSize: gafs(11.5),
                                color: 'rgb(var(--constellation-gold-rgb))',
                              }}
                            >
                              Kids {worldSummary(kidWorlds, area.name)?.total}
                            </span>
                          )}
                        </motion.button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
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
            initialPhase={insightsFor === activeArea.id ? 'insights' : 'questions'}
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
            onSaveAnswers={(answers) => handleSaveAnswers(activeArea, answers)}
            onShowInsights={() => {
              setInsightsFor(activeArea.id);
              setInsightsTick((t) => t + 1);
            }}
            onRetryRecommendations={() => refreshRecommendations(activeArea, { retry: true })}
            onExploreTransform={() => void navigate(`/LifePathway/${childId ?? ''}`)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSplash && <StageSplash stage={7} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
