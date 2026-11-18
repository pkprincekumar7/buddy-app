import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/errors';
import { grow, GROW_ERRORS, runGrowGeneration, type GrowthAreaDoc } from '@/api/grow';
import { toast } from 'sonner';
import { isAbort } from '@/api/polling';
import { jobProgressMessage } from '@/lib/jobProgress';
import { normalizeGeneratedQuestions } from '@/lib/growthAreaData';
import type { GrowthArea, Question } from '@/lib/growthAreaData';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';
import { httpErrorMessage } from '@/lib/apiError';

/**
 * Content state of the open area's questions.
 *
 *   idle    — nothing asked for yet.
 *   loading — generation is running, or queued behind another area's job.
 *   ready   — questions are cached; render them.
 *   error   — generation failed or came back unusable. The caller shows a retry;
 *             there is deliberately no fallback to a hardcoded set, so a parent
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
  parent: StageState;
  /** Start (or no-op on) generation of the parent's reflections for an area. */
  ensureParent: (area: GrowthArea) => void;
}

interface UseGrowthAreaQuestionsOptions {
  childId: string | undefined;
  /**
   * The child's growth_areas documents, as already loaded by the page. Seeds the
   * cache: each area's stored questions sit on its own document, next to the answers.
   */
  areas: GrowthAreaDoc[];
  /** The area whose sheet is open, or null when none is. Drives which status is reported. */
  area: GrowthArea | null;
  /** Gate generation until the page is actually visible (splash finished, data loaded). */
  enabled: boolean;
}

/**
 * Lazily generates and caches the parent's reflections, one area at a time, as the
 * parent works through the map. Grow builds the prompt and writes the result to the
 * area's document (build plan 7.6); this hook asks for `parent_questions`, polls the
 * job, and reads the area back. It creates the area too, the first time.
 *
 * One generation runs at a time and the latest request waits its turn: a parent who
 * opens three areas in a row gets them one after the other, without a pile of jobs
 * counting against the hourly limit.
 */
export function useGrowthAreaQuestions({
  childId,
  areas,
  area,
  enabled,
}: UseGrowthAreaQuestionsOptions): UseGrowthAreaQuestionsResult {
  const [questionCache, setQuestionCache] = useState<Record<string, Question[]>>({});
  // Areas whose generation will not resolve without a deliberate retry. Held in
  // state (not a ref) because status has to re-render the moment one lands here.
  const [failed, setFailed] = useState<Record<string, true>>({});

  const inFlightRef = useRef<string | null>(null);
  // The request to run once the current one settles.
  const pendingRef = useRef<(() => void) | null>(null);
  // The area last run for, so retry() can run it again.
  const lastAreaRef = useRef<GrowthArea | null>(null);
  // Stops polling when the page goes away.
  const abortRef = useUnmountSignal();
  // Which area is generating, and which is waiting its turn: in state because status
  // is derived from them during render.
  const [generating, setGenerating] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);

  const startedAtRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Seed from the questions already stored on each area's document. Only fills gaps,
  // so a completed job's merge is never overwritten by a later re-fetch.
  useEffect(() => {
    if (areas.length === 0) return;
    setQuestionCache((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const doc of areas) {
        if (!doc.area_id || next[doc.area_id]) continue;
        const parsed = normalizeGeneratedQuestions(doc.parent_questions, doc.area_id);
        if (parsed) {
          next[doc.area_id] = parsed;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [areas]);

  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [generating]);

  const settle = useCallback(() => {
    inFlightRef.current = null;
    setGenerating(null);
    const next = pendingRef.current;
    pendingRef.current = null;
    setQueued(null);
    // The waiting area starts inside the same settle, so the slot is never idle.
    next?.();
  }, []);

  const markFailed = useCallback(
    (areaId: string) => {
      setFailed((prev) => (prev[areaId] ? prev : { ...prev, [areaId]: true }));
      settle();
    },
    [settle],
  );

  /** Reads the freshly written questions off the area's document. An unusable set
   *  is treated exactly like a job failure. */
  const handleCompleted = useCallback(async () => {
    const finished = inFlightRef.current;
    if (!finished || !childId) {
      settle();
      return;
    }
    try {
      const doc = (await grow.list(childId)).find((a) => a.area_id === finished);
      const questions = normalizeGeneratedQuestions(doc?.parent_questions, finished);
      if (!questions) {
        markFailed(finished);
        return;
      }
      setQuestionCache((prev) => ({ ...prev, [finished]: questions }));
      settle();
    } catch (err) {
      console.warn('[useGrowthAreaQuestions] Could not read the generated questions:', err);
      markFailed(finished);
    }
  }, [childId, settle, markFailed]);

  const run = useCallback(
    (target: GrowthArea) => {
      if (!childId) return;
      const areaId = target.id;
      // Claimed synchronously, so a second call queues behind this one.
      inFlightRef.current = areaId;
      lastAreaRef.current = target;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setGenerating(areaId);
      setFailed((prev) => {
        if (!prev[areaId]) return prev;
        const next = { ...prev };
        delete next[areaId];
        return next;
      });
      void (async () => {
        try {
          const outcome = await runGrowGeneration(childId, areaId, 'parent_questions', {
            // Creates the area with its name on the first question set.
            areaName: target.name,
            signal: abortRef.current.signal,
          });
          if (outcome === 'completed') await handleCompleted();
          else markFailed(areaId);
        } catch (err) {
          if (isAbort(err)) return;
          console.warn('[useGrowthAreaQuestions] Generation failed:', err);
          // The hourly limit gets its own word; the sheet still offers "Try again".
          if (err instanceof ApiError && err.code === 'llm_limit')
            toast.error(httpErrorMessage(err, { codeMessages: GROW_ERRORS }));
          markFailed(areaId);
        }
      })();
    },
    [abortRef, childId, handleCompleted, markFailed],
  );

  const ensureParent = useCallback(
    (target: GrowthArea) => {
      if (!enabled || !childId) return;
      const areaId = target.id;
      if (questionCache[areaId] || inFlightRef.current === areaId || failed[areaId]) return;
      const start = () => {
        // Re-checked on drain: it may have been generated meanwhile.
        if (questionCache[areaId] || inFlightRef.current) return;
        run(target);
      };
      if (inFlightRef.current) {
        pendingRef.current = start;
        setQueued(areaId);
        return;
      }
      start();
    },
    [enabled, childId, questionCache, failed, run],
  );

  const retry = useCallback(() => {
    const target = lastAreaRef.current;
    if (!area || target?.id !== area.id || inFlightRef.current) return;
    run(target);
  }, [area, run]);

  const questions = area ? (questionCache[area.id] ?? null) : null;
  const areaId = area?.id;
  const status: StageStatus = !areaId
    ? 'idle'
    : questions
      ? 'ready'
      : failed[areaId]
        ? 'error'
        : generating === areaId || queued === areaId
          ? 'loading'
          : 'idle';

  return {
    questions,
    parent: {
      status,
      progressMessage:
        status === 'loading' && areaId === generating
          ? jobProgressMessage(elapsedMs, 'parent_questions')
          : '',
      retry,
    },
    ensureParent,
  };
}
