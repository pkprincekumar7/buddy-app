import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import { jobProgressMessage, useJob } from '@/hooks/useJob';
import { normalizeGeneratedQuestions, normalizeGeneratedRounds } from '@/lib/growthAreaData';
import type { GameRound, GrowthArea, Question } from '@/lib/growthAreaData';
import {
  buildGrowthChildRoundsPrompt,
  buildGrowthParentQuestionsPrompt,
  growthChildRoundsSchema,
  growthParentQuestionsSchema,
} from '@/lib/growthQuestionsPrompt';
import type { GrowthQuestionsContext, QAPair } from '@/lib/growthQuestionsPrompt';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import type { ChildRecord, CompletedArea, EnqueueJobPayload, JobType } from '@/types/api';

/**
 * Content state of one stage for the area currently open.
 *
 *   idle    — nothing asked for yet.
 *   loading — generation is running, or queued behind another area's job.
 *   ready   — questions are cached; render them.
 *   error   — generation failed or came back unusable. The caller shows a retry;
 *             there is deliberately no fallback to the hardcoded set, so a parent
 *             never answers questions that were not written for their child.
 */
export type StageStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface StageState {
  status: StageStatus;
  /** Elapsed-time note for long waits; '' when there is nothing worth saying. */
  progressMessage: string;
  retry: () => void;
}

export interface UseGrowthAreaQuestionsResult {
  /** The parent's five reflections for the open area, or null when not ready. */
  questions: Question[] | null;
  /** The child's six either/or rounds for the open area, or null when not ready. */
  rounds: GameRound[] | null;
  parent: StageState;
  child: StageState;
  /** Start (or no-op on) generation of the parent's reflections for an area. */
  ensureParent: (area: GrowthArea) => void;
  /** Start (or no-op on) generation of the child's rounds, grounded in the answers. */
  ensureChild: (area: GrowthArea, qa: QAPair[]) => void;
  /** Cached questions for any area, for callers building prompt context. */
  questionsFor: (areaId: string) => Question[] | null;
  /** Cached rounds for any area, for callers resolving saved picks. */
  roundsFor: (areaId: string) => GameRound[] | null;
}

interface UseGrowthAreaQuestionsOptions {
  childId: string | undefined;
  /** Child record — the prompt context (profile, questionnaire, personality). */
  child: Record<string, unknown> | null;
  /**
   * The child's growth_areas documents, as already loaded by the page. Seeds the
   * cache: each area's stored question sets sit on its own document, next to the
   * answers and picks that reference them.
   */
  areas: CompletedArea[];
  /** The area whose sheet is open, or null when none is. Drives which status is reported. */
  area: GrowthArea | null;
  /** goals.parent_concern, when the page managed to load it. */
  parentConcern: string | null;
  /** Gate generation until the page is actually visible (splash finished, data loaded). */
  enabled: boolean;
}

type Stage = 'parent' | 'child';

const JOB_TYPE: Record<Stage, JobType> = {
  parent: 'generate_growth_parent_questions',
  child: 'generate_growth_child_rounds',
};

/**
 * Lazily generates and caches both Growth Areas question sets, one area at a
 * time, as the parent works through the map.
 *
 * The two stages are separate jobs run in sequence, because the child's rounds
 * are grounded in the answers the parent has just given. Each stage therefore
 * gets its own useJob instance: independent polling, independent retry, and a
 * write-back allowlist that keeps one stage out of the other's field.
 *
 * Two constraints shape the rest:
 *
 *   1. `children.active_jobs` holds a single slot per job type, and the enqueue
 *      route caps in-flight jobs at 2 per (user, child, type). A parent who opens
 *      three areas in a row would blow that cap, so each stage runs one job at a
 *      time and remembers the latest request to pick up when the current settles.
 *   2. For the same reason `activeJobs` is deliberately passed as undefined to
 *      useJob: its server-sync effect would otherwise repoint polling at whichever
 *      job_id landed in the shared slot last, which for same-type sequential jobs
 *      is not necessarily the one we are waiting on. The durable record of this
 *      work is the growth_areas document, not active_jobs, so the only thing given
 *      up is resuming across a mid-flight page reload — which re-enqueues instead,
 *      and the orphaned job writes the same field harmlessly.
 */
export function useGrowthAreaQuestions({
  childId,
  child,
  areas,
  area,
  parentConcern,
  enabled,
}: UseGrowthAreaQuestionsOptions): UseGrowthAreaQuestionsResult {
  const [questionCache, setQuestionCache] = useState<Record<string, Question[]>>({});
  const [roundCache, setRoundCache] = useState<Record<string, GameRound[]>>({});
  // Areas whose generation will not resolve without a deliberate retry. Held in
  // state (not a ref) because status has to re-render the moment one lands here,
  // to swap a spinner for the error and its retry button.
  const [failed, setFailed] = useState<Record<Stage, Record<string, true>>>({
    parent: {},
    child: {},
  });

  const inFlightRef = useRef<Record<Stage, string | null>>({ parent: null, child: null });
  // The request to run once the current one settles, so an area opened while
  // another is generating still gets its turn without exceeding the in-flight cap.
  const pendingRef = useRef<Record<Stage, (() => void) | null>>({ parent: null, child: null });
  // The last payload sent per stage, so retry() can re-send it without the caller
  // having to rebuild the prompt context.
  const lastPayloadRef = useRef<Record<Stage, EnqueueJobPayload | null>>({
    parent: null,
    child: null,
  });
  // Which area each stage is working on, and which is waiting its turn. Both in
  // state rather than alongside the refs above, because status is derived from
  // them during render and has to change the moment either does — a queued area
  // that reported 'idle' would render as though nothing had been asked for.
  const [generating, setGenerating] = useState<Record<Stage, string | null>>({
    parent: null,
    child: null,
  });
  const [queued, setQueued] = useState<Record<Stage, string | null>>({
    parent: null,
    child: null,
  });

  // Own elapsed clock per stage, rather than useJob's. useJob resets its
  // elapsedMs when the *job id* changes, which only happens once the enqueue POST
  // returns — so for those few hundred milliseconds it still reports the previous
  // stage's elapsed time, long enough to flash a "taking longer than usual" note
  // the instant a parent moves on.
  const startedAtRef = useRef<Record<Stage, number>>({ parent: 0, child: 0 });
  const [elapsedMs, setElapsedMs] = useState<Record<Stage, number>>({ parent: 0, child: 0 });

  // Seed from the question sets already stored on each area's document. Runs
  // whenever the list changes and only fills gaps, so a completed job's merge is
  // never overwritten by a subsequent re-fetch.
  useEffect(() => {
    if (areas.length === 0) return;
    setQuestionCache((prev) =>
      mergeStored(prev, areas, 'parent_questions', normalizeGeneratedQuestions),
    );
    setRoundCache((prev) => mergeStored(prev, areas, 'child_rounds', normalizeGeneratedRounds));
  }, [areas]);

  useEffect(() => {
    const running = generating.parent ?? generating.child;
    if (!running) return;
    const id = setInterval(() => {
      setElapsedMs({
        parent: generating.parent ? Date.now() - startedAtRef.current.parent : 0,
        child: generating.child ? Date.now() - startedAtRef.current.child : 0,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [generating]);

  const settle = useCallback((stage: Stage) => {
    inFlightRef.current[stage] = null;
    setGenerating((prev) => ({ ...prev, [stage]: null }));
    const next = pendingRef.current[stage];
    pendingRef.current[stage] = null;
    setQueued((prev) => ({ ...prev, [stage]: null }));
    // Draining here is what makes the queue a queue: the waiting area enqueues
    // immediately, inside the same settle, so the slot is never idle.
    next?.();
  }, []);

  const markFailed = useCallback(
    (stage: Stage, areaId: string) => {
      setFailed((prev) =>
        prev[stage][areaId] ? prev : { ...prev, [stage]: { ...prev[stage], [areaId]: true } },
      );
      settle(stage);
    },
    [settle],
  );

  /**
   * Read the stage's freshly written field off the area's document and merge it.
   *
   * The worker stores raw provider output, so an unusable payload only shows up
   * here — which is why a null normalisation is treated exactly like a job
   * failure rather than caching an empty set the sheet cannot render.
   */
  const handleCompleted = useCallback(
    async (stage: Stage) => {
      const finished = inFlightRef.current[stage];
      if (!finished || !childId) {
        settle(stage);
        return;
      }
      try {
        const fresh = await api.completedGrowthAreas.list(childId);
        const doc = (fresh.areas ?? []).find((a) => a.area_id === finished);
        if (stage === 'parent') {
          const questions = normalizeGeneratedQuestions(doc?.parent_questions, finished);
          if (!questions) {
            markFailed('parent', finished);
            return;
          }
          setQuestionCache((prev) => ({ ...prev, [finished]: questions }));
        } else {
          const rounds = normalizeGeneratedRounds(doc?.child_rounds, finished);
          if (!rounds) {
            markFailed('child', finished);
            return;
          }
          setRoundCache((prev) => ({ ...prev, [finished]: rounds }));
        }
        settle(stage);
      } catch (err) {
        console.warn(`[useGrowthAreaQuestions] Could not read generated ${stage} content:`, err);
        markFailed(stage, finished);
      }
    },
    [childId, settle, markFailed],
  );

  const onParentCompleted = useCallback(() => handleCompleted('parent'), [handleCompleted]);
  const onChildCompleted = useCallback(() => handleCompleted('child'), [handleCompleted]);

  const parentJob = useJob({
    activeJobs: undefined,
    jobType: JOB_TYPE.parent,
    onCompleted: onParentCompleted,
  });
  const childJob = useJob({
    activeJobs: undefined,
    jobType: JOB_TYPE.child,
    onCompleted: onChildCompleted,
  });

  // Free the slot on failure so a later area still gets its turn, and remember
  // which area it was so its sheet stops waiting and offers a retry.
  useEffect(() => {
    const id = inFlightRef.current.parent;
    if (parentJob.isFailed && id) markFailed('parent', id);
  }, [parentJob.isFailed, markFailed]);

  useEffect(() => {
    const id = inFlightRef.current.child;
    if (childJob.isFailed && id) markFailed('child', id);
  }, [childJob.isFailed, markFailed]);

  /** Prompt context shared by both stages, derived from the child record. */
  const baseContext = useMemo((): Omit<GrowthQuestionsContext, 'area'> => {
    const c = (child ?? {}) as ChildRecord;
    const vm = c.personality?.view_model;
    const profile = onboardingProfileFromViewModel(vm);
    const rawTraits = vm?.profile?.traits;
    return {
      childName: typeof c.name === 'string' ? c.name : null,
      childGender: typeof c.gender === 'string' ? c.gender : null,
      childData: c,
      archetype: profile?.personality_type ?? null,
      personalityNarrative: profile?.summary ?? null,
      traits: Array.isArray(rawTraits) ? rawTraits.map((v) => String(v)).filter(Boolean) : [],
      parentConcern,
    };
  }, [child, parentConcern]);

  const enqueueStage = useCallback(
    (
      stage: Stage,
      areaId: string,
      payload: EnqueueJobPayload,
      send: (payload: EnqueueJobPayload) => Promise<void>,
      /** Runs before the enqueue; a rejection fails the stage without a job. */
      prepare?: () => Promise<void>,
    ) => {
      // Claimed synchronously, before any awaiting below, so a second call for
      // the same stage queues behind this one instead of racing it.
      inFlightRef.current[stage] = areaId;
      lastPayloadRef.current[stage] = payload;
      startedAtRef.current[stage] = Date.now();
      setElapsedMs((prev) => ({ ...prev, [stage]: 0 }));
      setGenerating((prev) => ({ ...prev, [stage]: areaId }));
      setFailed((prev) => {
        if (!prev[stage][areaId]) return prev;
        const next = { ...prev[stage] };
        delete next[areaId];
        return { ...prev, [stage]: next };
      });
      void (async () => {
        try {
          await prepare?.();
          await send(payload);
        } catch {
          markFailed(stage, areaId);
        }
      })();
    },
    [markFailed],
  );

  /**
   * Make sure the area has a document before the worker writes questions into it.
   *
   * The write-back upserts, and its $setOnInsert carries only _id and created_at —
   * so a worker-created document would have no `status`, which both this page and
   * the Life Pathway page read as "completed" (a deliberate allowance for
   * pre-status legacy documents). The parent would get a checkmark on an area they
   * had merely clicked.
   *
   * Only ever creates when the area has no document at all. Creating
   * unconditionally would be destructive: append always writes `answers`, so
   * passing {} would erase the reflections of an area that already had some.
   *
   * `areas` is a snapshot from page load and goes stale the moment this creates
   * something, so a session-local record of what it has already created backs it
   * up. Without that, a second call in the same session sees a list that predates
   * its own write and creates again — over the top of real answers.
   */
  const createdRef = useRef<Set<string>>(new Set());
  const ensureAreaDoc = useCallback(
    async (target: GrowthArea) => {
      if (!childId) return;
      if (createdRef.current.has(target.id)) return;
      if (areas.some((a) => a.area_id === target.id)) return;
      createdRef.current.add(target.id);
      await api.completedGrowthAreas.append(childId, {
        area_id: target.id,
        area_name: target.name,
        answers: {},
        status: 'in_progress',
        step: 'activity_summary',
      });
    },
    [childId, areas],
  );

  const ensureParent = useCallback(
    (target: GrowthArea) => {
      if (!enabled || !childId) return;
      const areaId = target.id;
      if (questionCache[areaId]) return;
      if (inFlightRef.current.parent === areaId) return;
      if (failed.parent[areaId]) return;
      const run = () => {
        // Re-checked on drain: the queued area may have been generated, or
        // already be running, by the time the slot frees up.
        if (questionCache[areaId] || inFlightRef.current.parent) return;
        enqueueStage(
          'parent',
          areaId,
          {
            type: JOB_TYPE.parent,
            child_id: childId,
            payload: {
              prompt: buildGrowthParentQuestionsPrompt({ ...baseContext, area: target }),
              response_json_schema: growthParentQuestionsSchema(),
            },
            write_back: {
              collection: 'growth_areas',
              // area_id scopes the write to this area's document; child_id,
              // user_id and location are injected by the enqueue route.
              filter: { area_id: areaId },
              field: 'parent_questions',
            },
          },
          parentJob.enqueue,
          () => ensureAreaDoc(target),
        );
      };
      if (inFlightRef.current.parent) {
        pendingRef.current.parent = run;
        setQueued((prev) => ({ ...prev, parent: areaId }));
        return;
      }
      run();
    },
    [
      enabled,
      childId,
      questionCache,
      failed.parent,
      baseContext,
      enqueueStage,
      parentJob.enqueue,
      ensureAreaDoc,
    ],
  );

  const ensureChild = useCallback(
    (target: GrowthArea, qa: QAPair[]) => {
      if (!enabled || !childId) return;
      const areaId = target.id;
      if (roundCache[areaId]) return;
      if (inFlightRef.current.child === areaId) return;
      if (failed.child[areaId]) return;
      const run = () => {
        if (roundCache[areaId] || inFlightRef.current.child) return;
        enqueueStage(
          'child',
          areaId,
          {
            type: JOB_TYPE.child,
            child_id: childId,
            payload: {
              prompt: buildGrowthChildRoundsPrompt({ ...baseContext, area: target, qa }),
              response_json_schema: growthChildRoundsSchema(areaId),
            },
            write_back: {
              collection: 'growth_areas',
              filter: { area_id: areaId },
              field: 'child_rounds',
            },
          },
          childJob.enqueue,
          // Deliberately no ensureAreaDoc: every route into stage two runs after
          // the answers have been written, so the document already exists — and
          // calling it here would be actively harmful, since append rewrites
          // `answers` and the {} it would send erases the parent's reflections.
        );
      };
      if (inFlightRef.current.child) {
        pendingRef.current.child = run;
        setQueued((prev) => ({ ...prev, child: areaId }));
        return;
      }
      run();
    },
    [enabled, childId, roundCache, failed.child, baseContext, enqueueStage, childJob.enqueue],
  );

  const retryStage = useCallback(
    (stage: Stage) => {
      const areaId = area?.id;
      const payload = lastPayloadRef.current[stage];
      if (!areaId || !payload || inFlightRef.current[stage]) return;
      enqueueStage(stage, areaId, payload, stage === 'parent' ? parentJob.retry : childJob.retry);
    },
    [area?.id, enqueueStage, parentJob.retry, childJob.retry],
  );

  const retryParent = useCallback(() => retryStage('parent'), [retryStage]);
  const retryChild = useCallback(() => retryStage('child'), [retryStage]);

  const questionsFor = useCallback(
    (areaId: string) => questionCache[areaId] ?? null,
    [questionCache],
  );
  const roundsFor = useCallback((areaId: string) => roundCache[areaId] ?? null, [roundCache]);

  const stateFor = (stage: Stage, cached: unknown): StageState => {
    const areaId = area?.id;
    let status: StageStatus;
    if (!areaId) {
      status = 'idle';
    } else if (cached) {
      status = 'ready';
    } else if (failed[stage][areaId]) {
      status = 'error';
    } else if (generating[stage] === areaId || queued[stage] === areaId) {
      // Covers both "a job is running for this area" and "this area is queued
      // behind another one" — from the parent's point of view those are the same
      // wait, and each stage is serialised so a queued area always gets a turn.
      status = 'loading';
    } else {
      status = 'idle';
    }
    return {
      status,
      // Only meaningful for the area actually in flight; a queued area has no
      // elapsed time of its own yet.
      progressMessage:
        status === 'loading' && areaId === generating[stage]
          ? jobProgressMessage(elapsedMs[stage], JOB_TYPE[stage])
          : '',
      retry: stage === 'parent' ? retryParent : retryChild,
    };
  };

  const questions = area ? (questionCache[area.id] ?? null) : null;
  const rounds = area ? (roundCache[area.id] ?? null) : null;

  return {
    questions,
    rounds,
    parent: stateFor('parent', questions),
    child: stateFor('child', rounds),
    ensureParent,
    ensureChild,
    questionsFor,
    roundsFor,
  };
}

/** Gap-filling merge of one stage's stored payloads into a cache. */
function mergeStored<T>(
  prev: Record<string, T[]>,
  areas: CompletedArea[],
  field: 'parent_questions' | 'child_rounds',
  normalize: (raw: unknown, areaId: string) => T[] | null,
): Record<string, T[]> {
  const next = { ...prev };
  let changed = false;
  for (const doc of areas) {
    const areaId = doc.area_id;
    if (!areaId || next[areaId]) continue;
    const parsed = normalize(doc[field], areaId);
    if (parsed) {
      next[areaId] = parsed;
      changed = true;
    }
  }
  return changed ? next : prev;
}
