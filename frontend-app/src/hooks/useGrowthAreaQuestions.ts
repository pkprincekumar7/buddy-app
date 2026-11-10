import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/errors';
import {
  grow,
  GROW_ERRORS,
  runGrowGeneration,
  type GrowKind,
  type GrowthAreaDoc,
} from '@/api/grow';
import { toast } from '@/lib/toast';
import { isAbort } from '@/api/polling';
import { jobProgressMessage } from '@/lib/jobProgress';
import {
  normalizeGeneratedQuestions,
  normalizeGeneratedRounds,
} from '@/lib/growthAreaData';
import type { GameRound, GrowthArea, Question } from '@/lib/growthAreaData';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';
import { httpErrorMessage } from '@/lib/apiError';

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
  /** Start (or no-op on) generation of the child's rounds, grounded in the saved answers. */
  ensureChild: (area: GrowthArea) => void;
  /** Cached questions for any area, for callers building prompt context. */
  questionsFor: (areaId: string) => Question[] | null;
  /** Cached rounds for any area, for callers resolving saved picks. */
  roundsFor: (areaId: string) => GameRound[] | null;
}

interface UseGrowthAreaQuestionsOptions {
  childId: string | undefined;
  /**
   * The child's growth_areas documents, as already loaded by the page. Seeds the
   * cache: each area's stored question sets sit on its own document, next to the
   * answers and picks that reference them.
   */
  areas: GrowthAreaDoc[];
  /** The area whose sheet is open, or null when none is. Drives which status is reported. */
  area: GrowthArea | null;
  /** Gate generation until the page is actually visible (splash finished, data loaded). */
  enabled: boolean;
}

type Stage = 'parent' | 'child';

const KIND: Record<Stage, GrowKind> = {
  parent: 'parent_questions',
  child: 'child_rounds',
};

/**
 * Lazily generates and caches both Growth Areas question sets, one area at a
 * time, as the parent works through the map.
 *
 * The two stages are separate generations run in sequence, because grow grounds the
 * child's rounds in the answers the parent has just saved. Grow builds the prompts and
 * writes the results to the area's document (build plan 7.6); this hook asks for a
 * `kind`, polls the job, and reads the area back. It creates the area too, when the
 * parent's questions are generated for it the first time.
 *
 * Each stage runs one generation at a time and remembers the latest request, to pick
 * up when the current one settles: a parent who opens three areas in a row gets them
 * one after the other, without a pile of jobs counting against the hourly limit.
 */
export function useGrowthAreaQuestions({
  childId,
  areas,
  area,
  enabled,
}: UseGrowthAreaQuestionsOptions): UseGrowthAreaQuestionsResult {
  const [questionCache, setQuestionCache] = useState<
    Record<string, Question[]>
  >({});
  const [roundCache, setRoundCache] = useState<Record<string, GameRound[]>>({});
  // Areas whose generation will not resolve without a deliberate retry. Held in
  // state (not a ref) because status has to re-render the moment one lands here,
  // to swap a spinner for the error and its retry button.
  const [failed, setFailed] = useState<Record<Stage, Record<string, true>>>({
    parent: {},
    child: {},
  });

  const inFlightRef = useRef<Record<Stage, string | null>>({
    parent: null,
    child: null,
  });
  // The request to run once the current one settles, so an area opened while
  // another is generating still gets its turn without exceeding the in-flight cap.
  const pendingRef = useRef<Record<Stage, (() => void) | null>>({
    parent: null,
    child: null,
  });
  // The area each stage last ran for, so retry() can run it again.
  const lastAreaRef = useRef<Record<Stage, GrowthArea | null>>({
    parent: null,
    child: null,
  });
  // Stops polling when the page goes away.
  const abortRef = useUnmountSignal();
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

  // Own elapsed clock per stage, started when the stage is asked for, so a parent who
  // moves on never sees the previous stage's "taking longer than usual" note.
  const startedAtRef = useRef<Record<Stage, number>>({ parent: 0, child: 0 });
  const [elapsedMs, setElapsedMs] = useState<Record<Stage, number>>({
    parent: 0,
    child: 0,
  });

  // Seed from the question sets already stored on each area's document. Runs
  // whenever the list changes and only fills gaps, so a completed job's merge is
  // never overwritten by a subsequent re-fetch.
  useEffect(() => {
    if (areas.length === 0) return;
    setQuestionCache(prev =>
      mergeStored(prev, areas, 'parent_questions', normalizeGeneratedQuestions),
    );
    setRoundCache(prev =>
      mergeStored(prev, areas, 'child_rounds', normalizeGeneratedRounds),
    );
  }, [areas]);

  useEffect(() => {
    const running = generating.parent ?? generating.child;
    if (!running) return;
    const id = setInterval(() => {
      setElapsedMs({
        parent: generating.parent
          ? Date.now() - startedAtRef.current.parent
          : 0,
        child: generating.child ? Date.now() - startedAtRef.current.child : 0,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [generating]);

  const settle = useCallback((stage: Stage) => {
    inFlightRef.current[stage] = null;
    setGenerating(prev => ({ ...prev, [stage]: null }));
    const next = pendingRef.current[stage];
    pendingRef.current[stage] = null;
    setQueued(prev => ({ ...prev, [stage]: null }));
    // Draining here is what makes the queue a queue: the waiting area enqueues
    // immediately, inside the same settle, so the slot is never idle.
    next?.();
  }, []);

  const markFailed = useCallback(
    (stage: Stage, areaId: string) => {
      setFailed(prev =>
        prev[stage][areaId]
          ? prev
          : { ...prev, [stage]: { ...prev[stage], [areaId]: true } },
      );
      settle(stage);
    },
    [settle],
  );

  /**
   * Read the stage's freshly written field off the area's document and merge it.
   *
   * Grow stores it normalised already; normalising again is harmless, and a null
   * result is treated exactly like a job failure rather than caching an empty set
   * the sheet cannot render.
   */
  const handleCompleted = useCallback(
    async (stage: Stage) => {
      const finished = inFlightRef.current[stage];
      if (!finished || !childId) {
        settle(stage);
        return;
      }
      try {
        const fresh = await grow.list(childId);
        const doc = fresh.find(a => a.area_id === finished);
        if (stage === 'parent') {
          const questions = normalizeGeneratedQuestions(
            doc?.parent_questions,
            finished,
          );
          if (!questions) {
            markFailed('parent', finished);
            return;
          }
          setQuestionCache(prev => ({ ...prev, [finished]: questions }));
        } else {
          const rounds = normalizeGeneratedRounds(doc?.child_rounds, finished);
          if (!rounds) {
            markFailed('child', finished);
            return;
          }
          setRoundCache(prev => ({ ...prev, [finished]: rounds }));
        }
        settle(stage);
      } catch (err) {
        console.warn(
          `[useGrowthAreaQuestions] Could not read generated ${stage} content:`,
          err,
        );
        markFailed(stage, finished);
      }
    },
    [childId, settle, markFailed],
  );

  const runStage = useCallback(
    (stage: Stage, target: GrowthArea) => {
      if (!childId) return;
      const areaId = target.id;
      // Claimed synchronously, before any awaiting below, so a second call for
      // the same stage queues behind this one instead of racing it.
      inFlightRef.current[stage] = areaId;
      lastAreaRef.current[stage] = target;
      startedAtRef.current[stage] = Date.now();
      setElapsedMs(prev => ({ ...prev, [stage]: 0 }));
      setGenerating(prev => ({ ...prev, [stage]: areaId }));
      setFailed(prev => {
        if (!prev[stage][areaId]) return prev;
        const next = { ...prev[stage] };
        delete next[areaId];
        return { ...prev, [stage]: next };
      });
      void (async () => {
        try {
          const outcome = await runGrowGeneration(
            childId,
            areaId,
            KIND[stage],
            {
              // Creates the area with its name on the first question set.
              ...(stage === 'parent' ? { areaName: target.name } : {}),
              signal: abortRef.current.signal,
            },
          );
          if (outcome === 'completed') await handleCompleted(stage);
          else markFailed(stage, areaId);
        } catch (err) {
          if (isAbort(err)) return;
          console.warn(
            `[useGrowthAreaQuestions] ${stage} generation failed:`,
            err,
          );
          // The hourly limit gets its own word; the stage still offers "Try again".
          if (err instanceof ApiError && err.code === 'llm_limit')
            toast.error(httpErrorMessage(err, { codeMessages: GROW_ERRORS }));
          markFailed(stage, areaId);
        }
      })();
    },
    [abortRef, childId, handleCompleted, markFailed],
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
        runStage('parent', target);
      };
      if (inFlightRef.current.parent) {
        pendingRef.current.parent = run;
        setQueued(prev => ({ ...prev, parent: areaId }));
        return;
      }
      run();
    },
    [enabled, childId, questionCache, failed.parent, runStage],
  );

  const ensureChild = useCallback(
    (target: GrowthArea) => {
      if (!enabled || !childId) return;
      const areaId = target.id;
      if (roundCache[areaId]) return;
      if (inFlightRef.current.child === areaId) return;
      if (failed.child[areaId]) return;
      const run = () => {
        if (roundCache[areaId] || inFlightRef.current.child) return;
        // Grow grounds the rounds in the answers already saved on the area.
        runStage('child', target);
      };
      if (inFlightRef.current.child) {
        pendingRef.current.child = run;
        setQueued(prev => ({ ...prev, child: areaId }));
        return;
      }
      run();
    },
    [enabled, childId, roundCache, failed.child, runStage],
  );

  const retryStage = useCallback(
    (stage: Stage) => {
      const target = lastAreaRef.current[stage];
      if (!area || target?.id !== area.id || inFlightRef.current[stage]) return;
      runStage(stage, target);
    },
    [area, runStage],
  );

  const retryParent = useCallback(() => retryStage('parent'), [retryStage]);
  const retryChild = useCallback(() => retryStage('child'), [retryStage]);

  const questionsFor = useCallback(
    (areaId: string) => questionCache[areaId] ?? null,
    [questionCache],
  );
  const roundsFor = useCallback(
    (areaId: string) => roundCache[areaId] ?? null,
    [roundCache],
  );

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
          ? jobProgressMessage(elapsedMs[stage], KIND[stage])
          : '',
      retry: stage === 'parent' ? retryParent : retryChild,
    };
  };

  const questions = area ? questionCache[area.id] ?? null : null;
  const rounds = area ? roundCache[area.id] ?? null : null;

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
  areas: GrowthAreaDoc[],
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
