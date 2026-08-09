import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useJob } from '@/hooks/useJob';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/api/client';
import {
  AREA_QUESTIONS,
  GROWTH_AREAS,
  fillTemplate,
  normalizeRecommendations,
  pickedOptions,
  topArchetype,
} from '@/lib/growthAreaData';
import type { GrowthArea, GrowthRecommendation } from '@/lib/growthAreaData';
import type { StoredRecommendation } from '@/types/api';
import { buildGrowthAreaRecommendationsPrompt } from '@/lib/prompts';
import { SPINNER } from '@/lib/animations';
import Starfield from '@/components/shared/Starfield';
import GrowthAreaSheet from '@/components/growth/GrowthAreaSheet';

// Node geometry. `pos` on each area is the design's desktop arc; on narrow
// screens the arc collapses to a two-column ladder, because six nodes spread
// across an arc overlap badly under ~640px.
const NODE = 66;
const MOBILE_NODE = 58;

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
  marginTop: 10,
  fontWeight: 700,
  fontSize: 13.5,
  whiteSpace: 'nowrap',
  transition: 'color .3s ease',
};

const CHECK_BADGE: React.CSSProperties = {
  position: 'absolute',
  top: -2,
  right: -2,
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: '#05070f',
  border: '1.5px solid rgba(240,201,138,.8)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 3,
};

export default function GrowthAreas() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth, ttsEnabled } = useAuth();
  const isMobile = useIsMobile();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [childGender, setChildGender] = useState('');
  const [completedAreaIds, setCompletedAreaIds] = useState<Set<string | undefined>>(new Set());
  const [savedAnswers, setSavedAnswers] = useState<Record<string, Record<string, unknown>>>({});
  // Lets a finished area open straight into its result (constellation +
  // recommendations) instead of forcing a full redo just to look at it again.
  // Sourced from `child_activity.selections` — a durable field the backend
  // never clears — unlike `child_activity_selections`, which it unsets on
  // every completion. Only populated for areas completed after this durable
  // copy started being written; older completed areas fall back to the
  // original "start at question 1" behaviour since their picks are gone.
  const [completedResults, setCompletedResults] = useState<
    Record<string, { picks: string[]; recommendations: GrowthRecommendation[] }>
  >({});
  const [hydrated, setHydrated] = useState(false);
  const [activeArea, setActiveArea] = useState<GrowthArea | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recsStatus, setRecsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [recommendations, setRecommendations] = useState<GrowthRecommendation[]>([]);
  const [showSplash, startTimer] = useStageSplash(0);
  const ambientRef = useRef<HTMLAudioElement | null>(null);
  // Which area the in-flight/last recommendations job belongs to — the sheet
  // only ever shows results for the area it's currently open on, but the job
  // itself is anchored here so it survives the parent closing the sheet.
  const recsAreaRef = useRef<GrowthArea | null>(null);
  // Mirrors the answers just persisted for the area a recs job is running for,
  // so finalizeRecommendations can re-include them in the same request that
  // marks the area complete (the backend unsets interactive_answers on
  // completion — writing the same values under `answers` is what survives).
  const recsAnswersRef = useRef<Record<string, unknown>>({});
  // The exact picks the CURRENT `recommendations` state was generated for.
  // Lets a same-session replay (Play Again → identical six choices) reuse
  // what's already showing instead of re-billing the LLM for no-op input.
  // Only meaningful while recsStatus is 'ready' for this same area — cleared
  // implicitly by recsAreaRef changing to a different area.
  const recsPicksRef = useRef<string[] | null>(null);

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
        if (!child.personality?.view_model?.type && !child.personality?.view_model?.profile?.name) {
          void navigate(`/PersonalityType/${childId}`, { replace: true });
          return;
        }
        setChildData(child);
        setChildName(child.name ?? '');
        setChildAge(child.age != null ? String(child.age) : '');
        setChildGender(typeof child.gender === 'string' ? child.gender : '');

        const areas = await api.completedGrowthAreas.list(childId);
        if (cancelled) return;
        const allDocs = areas.areas ?? [];
        const done = new Set(
          allDocs
            .filter(
              (a) =>
                a.status === 'completed' ||
                !a.status ||
                (Array.isArray(a.ai_three_month_recommendations) &&
                  a.ai_three_month_recommendations.length > 0),
            )
            .map((a) => a.area_id),
        );
        setCompletedAreaIds(done);

        // Prefill a redo of an area the parent already answered. The reflection
        // sheet filters these down to the current question ids itself.
        const byArea: Record<string, Record<string, unknown>> = {};
        for (const doc of allDocs) {
          const prev = doc.interactive_answers ?? doc.answers;
          if (doc.area_id && prev && typeof prev === 'object') byArea[doc.area_id] = prev;
        }
        setSavedAnswers(byArea);

        const results: Record<
          string,
          { picks: string[]; recommendations: GrowthRecommendation[] }
        > = {};
        for (const doc of allDocs) {
          if (!doc.area_id || doc.status !== 'completed') continue;
          const recs = normalizeRecommendations(doc.ai_three_month_recommendations);
          const picks = (doc.child_activity as { selections?: unknown } | undefined)?.selections;
          if (
            recs.length > 0 &&
            Array.isArray(picks) &&
            picks.every((p) => typeof p === 'string')
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

  // Ambient track, gated on the same sound preference as the rest of the app.
  // Starts once the splash video has finished so the two never overlap.
  useEffect(() => {
    if (showSplash || !hydrated) return;
    if (!ttsEnabled) {
      ambientRef.current?.pause();
      return;
    }
    const audio = ambientRef.current ?? new Audio('/growth-ambient.mp3');
    audio.loop = true;
    audio.volume = 0.32;
    ambientRef.current = audio;
    // Autoplay may be blocked until the page has been interacted with; retry on
    // the first pointer event rather than leaving it silently stopped.
    const play = () => void audio.play().catch(() => {});
    play();
    const onPointerDown = () => {
      play();
      document.removeEventListener('pointerdown', onPointerDown);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showSplash, hydrated, ttsEnabled]);

  useEffect(
    () => () => {
      ambientRef.current?.pause();
      ambientRef.current = null;
    },
    [],
  );

  /**
   * The one and only write for the reflection step, on Finish at question five.
   * Returns whether it landed so the sheet can hold position on failure rather
   * than handing a device to the child with the parent's answers lost.
   */
  const handleSaveAnswers = useCallback(
    async (area: GrowthArea, answers: Record<string, string>): Promise<boolean> => {
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
        setSavedAnswers((prev) => ({ ...prev, [area.id]: answers }));
        return true;
      } catch (err) {
        console.error('[GrowthAreas] Saving reflection failed:', err);
        toast.error('Could not save your answers. Please try again.');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [childId],
  );

  /**
   * Runs once the recs job reports 'completed'. Reads the worker's staged
   * output and, in the same request, both promotes it to the canonical field
   * and marks the area complete — matching the write pattern the old
   * GreatInsights page used, now driven from here since there's no longer a
   * separate results page to land on.
   */
  const finalizeRecommendations = useCallback(async () => {
    const area = recsAreaRef.current;
    if (!childId || !area) return;
    try {
      const completedData = await api.completedGrowthAreas.list(childId);
      const areaDoc = (completedData.areas ?? []).find((a) => a.area_id === area.id);
      const pendingRaw = areaDoc?.pending_recommendations as Record<string, unknown> | undefined;
      const pending: StoredRecommendation[] | undefined = Array.isArray(pendingRaw)
        ? (pendingRaw as StoredRecommendation[])
        : Array.isArray(pendingRaw?.recommendations)
          ? (pendingRaw.recommendations as StoredRecommendation[])
          : undefined;

      if (pending && pending.length > 0) {
        setRecommendations(normalizeRecommendations(pending));
        setRecsStatus('ready');
        // The backend unsets interactive_answers on status:'completed' — writing
        // the same values under `answers` (which is never unset) is what keeps
        // the parent's reflections attached to the finished area.
        await api.completedGrowthAreas.append(childId, {
          area_id: area.id,
          area_name: area.name,
          answers: recsAnswersRef.current,
          status: 'completed',
          step: 'activity_summary',
          ai_three_month_recommendations: pending,
        });
        setCompletedAreaIds((prev) => new Set(prev).add(area.id));
        // Lets this area open straight into its result if reopened later in
        // the same visit — `recsPicksRef` still holds the picks this exact
        // generation ran for.
        if (recsPicksRef.current) {
          setCompletedResults((prev) => ({
            ...prev,
            [area.id]: {
              picks: recsPicksRef.current as string[],
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
   * immediately by kicking off recommendation generation. The sheet moves to
   * its result phase optimistically (the archetype is derived client-side, no
   * network needed); recsStatus/recommendations stream back down as this job
   * progresses.
   */
  const handleCompleteRounds = useCallback(
    async (area: GrowthArea, pickedIds: string[]) => {
      if (!childId) return;

      // A same-session replay with the exact same parent answers AND the exact
      // same six picks (e.g. Play Again, then choosing identically) already has
      // valid recommendations sitting in state — reuse them instead of
      // re-billing the LLM for input that hasn't changed. This only covers the
      // current sheet session: once an area is finalised, the backend clears
      // child_activity_selections (by design, on every completion, unrelated to
      // this change), so there's nothing to compare against on a fresh reopen —
      // that always regenerates, which is correct, since a genuine redo may
      // carry different answers.
      const currentAnswers = savedAnswers[area.id] ?? {};
      const answersUnchanged =
        JSON.stringify(recsAnswersRef.current) === JSON.stringify(currentAnswers);
      const isIdenticalReplay =
        recsAreaRef.current?.id === area.id &&
        recsStatus === 'ready' &&
        answersUnchanged &&
        recsPicksRef.current !== null &&
        recsPicksRef.current.length === pickedIds.length &&
        recsPicksRef.current.every((id, i) => id === pickedIds[i]);
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
          // Durable — the same field the pre-redesign image-pick flow used for
          // this exact purpose. Writing it here, before completion, means it
          // survives the unset above and lets a finished area be reopened
          // straight into its result later (see `completedResults`).
          child_activity: { selections: pickedIds },
        });

        const questions = AREA_QUESTIONS[area.id] ?? [];
        const answers = savedAnswers[area.id] ?? {};
        const qaContext = questions
          .filter((q) => answers[q.id])
          .map(
            (q) =>
              `Q: ${fillTemplate(q.question, childName, childGender)}\n` +
              `   (${fillTemplate(q.hint, childName, childGender)})\n` +
              `A: ${String(answers[q.id])}`,
          )
          .join('\n\n');
        const archetype = topArchetype(area.id, pickedIds)?.archetype;

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
              childChoices: pickedOptions(area.id, pickedIds).map((o) => o.text),
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
    [childId, savedAnswers, childName, childAge, childGender, jobEnqueue, recsStatus],
  );

  // Mirrors the guard the old GreatInsights page used: job.isComplete fires
  // before finalizeRecommendations' async write lands, which would otherwise
  // flash the sheet from "generating" to "no recs yet" for a moment.
  const isGeneratingRecs = job.isLoading || (job.isComplete && recsStatus !== 'ready');
  const recsPhase: 'idle' | 'loading' | 'ready' | 'error' = isGeneratingRecs
    ? 'loading'
    : job.isFailed
      ? 'error'
      : recsStatus;

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
      }
      setActiveArea(area);
    },
    [completedResults, savedAnswers],
  );

  const size = isMobile ? MOBILE_NODE : NODE;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || !hydrated ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
            />
          </div>
        ) : (
          <div
            key={showSplash ? 'splash' : 'content'}
            // The design composes this screen as a single fixed viewport. The
            // app's sticky nav is h-16, so subtract it rather than using
            // min-h-screen — otherwise the arc pushes the actions past the fold.
            className="relative min-h-[calc(100vh-4rem)] overflow-hidden"
            style={{ background: '#05070f' }}
          >
            <Starfield />

            {/* Nebula wash — lifts the centre of the arc out of the flat black */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                background:
                  'radial-gradient(ellipse at 50% 45%,rgba(30,196,232,.13),rgba(5,7,15,0) 58%),radial-gradient(circle at 50% 50%,rgba(5,7,15,0) 42%,rgba(2,3,9,.82) 100%)',
              }}
            />

            <div className="relative z-[2] mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col px-4 py-6 md:py-8">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                className="flex-shrink-0 text-center"
              >
                <div
                  className="mb-2 text-[10.5px] font-bold uppercase"
                  style={{ letterSpacing: '.4em', color: '#1ec4e8' }}
                >
                  {childName ? `${childName} · Growth Map` : 'Growth Map'}
                </div>
                <h1
                  className="m-0 text-[clamp(22px,2.6vw,32px)] font-bold"
                  style={{ fontFamily: 'Orbitron, sans-serif', color: '#eafdff' }}
                >
                  Growth Areas
                </h1>
                <div
                  className="mt-1.5 text-sm font-semibold"
                  style={{ letterSpacing: '.05em', color: '#84a0b2' }}
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
                    maxWidth: 900,
                    height: isMobile ? 560 : 260,
                  }}
                >
                  {/* Arc guides — stretched to the container, so they track the nodes */}
                  {!isMobile && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 1000 200"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      <path
                        d="M80 124 Q 500 -4 920 124"
                        fill="none"
                        stroke="rgba(75,233,255,.22)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d="M80 152 Q 500 24 920 152"
                        fill="none"
                        stroke="rgba(75,233,255,.08)"
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
                              background: 'linear-gradient(150deg,#1c2b46,#0a1220)',
                              border: `1.5px solid ${done ? 'rgba(240,201,138,.95)' : 'rgba(240,201,138,.75)'}`,
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
                              style={{ width: 26, height: 26 }}
                            >
                              <path d={area.iconPath} />
                            </svg>
                          </span>

                          {done && (
                            <span style={CHECK_BADGE}>
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#f0c98a"
                                strokeWidth="3"
                                style={{ width: 12, height: 12 }}
                              >
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          )}

                          <span style={{ ...LABEL, color: done ? '#f2fdff' : '#84a0b2' }}>
                            {area.name}
                          </span>
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
        {activeArea &&
          (() => {
            const cached = completedResults[activeArea.id];
            return (
              <GrowthAreaSheet
                key={activeArea.id}
                area={activeArea}
                childName={childName}
                childGender={childGender}
                initialAnswers={savedAnswers[activeArea.id]}
                initialPhase={cached ? 'result' : 'questions'}
                initialPicks={cached?.picks}
                isSaving={isSaving}
                recsPhase={recsPhase}
                recommendations={recommendations}
                onClose={() => {
                  if (!isSaving) setActiveArea(null);
                }}
                onSaveAnswers={(answers) => handleSaveAnswers(activeArea, answers)}
                onCompleteRounds={(pickedIds) => {
                  void handleCompleteRounds(activeArea, pickedIds);
                }}
              />
            );
          })()}
      </AnimatePresence>

      <AnimatePresence>
        {showSplash && <StageSplash stage={7} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
