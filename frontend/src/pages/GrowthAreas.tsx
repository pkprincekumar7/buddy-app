import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useJob } from '@/hooks/useJob';
import { useGrowthAreaQuestions } from '@/hooks/useGrowthAreaQuestions';
import { useAuth } from '@/lib/AuthContext';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { useIsMobile } from '@/hooks/use-mobile';
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
import GrowthAreaSheet from '@/components/growth/GrowthAreaSheet';

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
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();
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
  /** The raw growth_areas documents, which also carry the generated question sets. */
  const [areaDocs, setAreaDocs] = useState<CompletedArea[]>([]);
  // What the parent said worries them most, from the goals document. Prompt
  // context only — the highest-signal single field for aiming the generated
  // reflections at what this parent actually came here for.
  const [parentConcern, setParentConcern] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<GrowthArea | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recsStatus, setRecsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [recommendations, setRecommendations] = useState<GrowthRecommendation[]>([]);
  const [showSplash, startTimer] = useStageSplash(0);
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
        // Held as-is for useGrowthAreaQuestions, which reads each area's stored
        // question sets off these same documents.
        setAreaDocs(allDocs);
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

        // Prompt context only, and the page is fully usable without it — so it
        // gets its own guard rather than sharing the fate of the loads above.
        try {
          const goals = await api.goals.get(childId);
          if (cancelled) return;
          const concern =
            typeof goals.parent_concern === 'string' ? goals.parent_concern.trim() : '';
          if (concern) setParentConcern(concern);
        } catch (err) {
          console.warn('[GrowthAreas] Could not load the parent concern:', err);
        }
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

  // Ambient track is shared across the whole journey (see AmbientAudioContext) —
  // keep it silent while the splash video plays its own audio, same as before.
  useEffect(() => {
    setAmbientSuppressed(showSplash || !hydrated);
    return () => setAmbientSuppressed(false);
  }, [showSplash, hydrated, setAmbientSuppressed]);

  /**
   * Both question sets, generated per child per area and cached on the child
   * document. Anchored on the page rather than in the sheet so a job survives the
   * parent closing the sheet mid-generation.
   */
  const generated = useGrowthAreaQuestions({
    childId,
    child: childData,
    areas: areaDocs,
    area: activeArea,
    parentConcern,
    enabled: hydrated,
  });
  const { ensureParent, ensureChild, questionsFor, roundsFor } = generated;

  /**
   * The reflections an area's saved answers belong to.
   *
   * Prefers this child's generated set, falling back to the hardcoded one for an
   * area answered before questions were generated — for those documents the
   * hardcoded wording is the accurate record of what the parent was asked, not a
   * substitute for it.
   */
  const askedQuestions = useCallback(
    (areaId: string) => questionsFor(areaId) ?? AREA_QUESTIONS[areaId] ?? [],
    [questionsFor],
  );

  /** An area's answers as question/answer pairs, for prompt context. */
  const qaPairsFor = useCallback(
    (areaId: string, answers: Record<string, unknown>) =>
      askedQuestions(areaId).flatMap((q) => {
        const answer = typeof answers[q.id] === 'string' ? (answers[q.id] as string).trim() : '';
        return answer
          ? [{ question: fillTemplate(q.question, childName, childGender), answer }]
          : [];
      }),
    [askedQuestions, childName, childGender],
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
        // Stage two starts here, not on the click that opened this area: the
        // child's choices are built from the answers just written, and the wait
        // then runs underneath the handoff beat the parent is about to read.
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

        // The questions this child was actually asked, not a template — they are
        // what makes the answers below interpretable.
        const answers = savedAnswers[area.id] ?? {};
        const qaContext = askedQuestions(area.id)
          .filter((q) => answers[q.id])
          .map(
            (q) =>
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
              childChoices: pickedOptions(rounds, pickedIds).map((o) => o.text),
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
    (area: GrowthArea) => {
      ensureChild(area, qaPairsFor(area.id, savedAnswers[area.id] ?? {}));
    },
    [ensureChild, qaPairsFor, savedAnswers],
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
                  className="m-0 font-bold"
                  style={{
                    // The clamp is wrapped rather than replaced: it still does the
                    // fluid work between 22 and 32px, the scale then lifts the
                    // whole range. Passing the clamp raw would opt the one heading
                    // on the page out of --ga-type-scale.
                    fontSize: 'calc(clamp(22px,2.6vw,32px) * var(--ga-type-scale, 1))',
                    fontFamily: 'Orbitron, sans-serif',
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
                              background: 'linear-gradient(150deg,#1c2b46,#0a1220)',
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
                initialPhase={cached ? 'result' : 'questions'}
                initialPicks={cached?.picks}
                isSaving={isSaving}
                recsPhase={recsPhase}
                recommendations={recommendations}
                onClose={() => {
                  if (!isSaving) setActiveArea(null);
                }}
                onSaveAnswers={(answers) => handleSaveAnswers(activeArea, answers)}
                onReplayRounds={() => handleReplayRounds(activeArea)}
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
