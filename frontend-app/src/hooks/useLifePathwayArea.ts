import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort } from '@/api/polling';
import { ApiError } from '@/api/errors';
import {
  runTransformGeneration,
  transform,
  TRANSFORM_ERRORS,
  type TransformArea,
} from '@/api/transform';
import { toast } from '@/lib/toast';
import { jobProgressMessage } from '@/lib/jobProgress';
import { normalizeLifePathwayArea } from '@/lib/lifePathwayData';
import type { MilestoneCopy } from '@/lib/lifePathwayData';
import type { GrowthArea } from '@/lib/growthAreaData';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';
import { httpErrorMessage } from '@/lib/apiError';

/** One entry per milestone slot; null where that slot has no generated content. */
type SlotContent = (MilestoneCopy | null)[];

interface UseLifePathwayAreaOptions {
  childId: string | undefined;
  /** Currently selected growth area, or null when none is available. */
  area: GrowthArea | null;
  /**
   * Every completed area, as transform returned it to the page. Seeds the cache:
   * transform stores each area's milestones and returns them with the area.
   */
  areas: TransformArea[];
  /** The concrete years the slots map to — also used to read the legacy blob shape. */
  ages: readonly number[];
  /** Gate generation until the page is actually visible (splash finished, data loaded). */
  enabled: boolean;
}

/**
 * Content state of the *selected* area.
 *
 *   ready       — content is cached; render it.
 *   loading     — nothing cached yet, but generation is running or queued behind
 *                 another area's job. Callers show a loading state rather than
 *                 templated copy, so a parent never reads placeholder text that
 *                 silently rewrites itself moments later.
 *   unavailable — nothing cached and nothing more coming (generation failed, or
 *                 there is no area selected). Callers fall back to templated copy
 *                 so the page is never dead.
 */
export type AreaStatus = 'ready' | 'loading' | 'unavailable';

export interface UseLifePathwayAreaResult {
  /** Per-slot generated content for the selected area, or null when not ready. */
  generated: SlotContent | null;
  status: AreaStatus;
  /** Elapsed-time note for long waits; '' when there is nothing worth saying. */
  progressMessage: string;
}

/**
 * Lazily generates and caches Life Pathway milestone copy, one growth area at a
 * time, as the parent moves through the dropdown.
 *
 * Transform builds the prompt from its own copies of the child, the personality and
 * the area's answers and recommendations (build plan 7.7): this hook asks for
 * `life_pathway` with the area, polls the job, and reads the area back. Generation is
 * serialised — one area at a time, with the latest requested area picked up when the
 * current one settles — so a parent flicking through the dropdown doesn't start a job
 * per change against the hourly limit.
 *
 * A failed area is not retried within the session — the caller's fallback copy
 * is complete and on-message, so a retry loop would burn quota for no visible
 * gain.
 */
export function useLifePathwayArea({
  childId,
  area,
  areas,
  ages,
  enabled,
}: UseLifePathwayAreaOptions): UseLifePathwayAreaResult {
  const [cache, setCache] = useState<Record<string, SlotContent>>({});
  const attemptedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<string | null>(null);
  // Mirrors the in-flight area into state purely so status re-renders; the ref is
  // what the enqueue effect reads, to stay free of render timing.
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // Areas whose generation will not resolve. Held in state (not a ref) because
  // status has to re-render the moment one lands here, to swap a spinner for
  // fallback copy instead of waiting forever.
  const [failed, setFailed] = useState<Record<string, true>>({});
  // Own elapsed clock for the progress note, started when the area is asked for, so
  // switching area never flashes the previous one's "taking longer than usual" note.
  const startedAtRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Seed from the milestones already stored on each area's document. Runs whenever
  // the list changes and only fills gaps, so a completed job's merge is never
  // overwritten by a subsequent re-fetch.
  useEffect(() => {
    if (areas.length === 0) return;
    setCache(prev => {
      const next = { ...prev };
      let changed = false;
      for (const doc of areas) {
        const id = doc.area_id;
        if (!id || next[id]) continue;
        const ms = normalizeLifePathwayArea(doc.life_pathway_milestones, ages);
        if (ms) {
          next[id] = ms;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [areas, ages]);

  useEffect(() => {
    if (!generatingId) return;
    const id = setInterval(
      () => setElapsedMs(Date.now() - startedAtRef.current),
      1000,
    );
    return () => clearInterval(id);
  }, [generatingId]);

  const settle = useCallback(() => {
    inFlightRef.current = null;
    setGeneratingId(null);
  }, []);

  const handleCompleted = useCallback(async () => {
    const finished = inFlightRef.current;
    settle();
    if (!finished || !childId) return;
    try {
      const fresh = await transform.get(childId);
      const doc = fresh.areas.find(a => a.area_id === finished);
      const ms = normalizeLifePathwayArea(doc?.life_pathway_milestones, ages);
      if (ms) setCache(prev => ({ ...prev, [finished]: ms }));
    } catch (err) {
      // The content is on the document either way — the next page load picks it
      // up. Falling back to templated copy for now is the correct degradation.
      console.warn(
        '[useLifePathwayArea] Could not read generated content:',
        err,
      );
    }
  }, [childId, ages, settle]);

  const markFailed = useCallback(
    (areaId: string) => {
      setFailed(prev => (prev[areaId] ? prev : { ...prev, [areaId]: true }));
      settle();
    },
    [settle],
  );

  // Stops polling when the page goes away.
  const abortRef = useUnmountSignal();

  useEffect(() => {
    if (!enabled || !childId || !area) return;
    const areaId = area.id;
    if (cache[areaId]) return;
    // Serialised: whatever is selected when this frees up gets picked up, because
    // the completion merge into `cache` re-runs this effect.
    if (inFlightRef.current) return;
    if (attemptedRef.current.has(areaId)) return;

    attemptedRef.current.add(areaId);
    inFlightRef.current = areaId;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setGeneratingId(areaId);

    void (async () => {
      try {
        const outcome = await runTransformGeneration(childId, 'life_pathway', {
          areaId,
          signal: abortRef.current.signal,
        });
        if (outcome === 'completed') await handleCompleted();
        else markFailed(areaId);
      } catch (err) {
        if (isAbort(err)) return;
        console.warn('[useLifePathwayArea] Generation failed:', err);
        // The template copy stands in either way; the hourly limit is worth saying.
        if (err instanceof ApiError && err.code === 'llm_limit')
          toast.error(
            httpErrorMessage(err, { codeMessages: TRANSFORM_ERRORS }),
          );
        markFailed(areaId);
      }
    })();
  }, [abortRef, enabled, childId, area, cache, handleCompleted, markFailed]);

  const cached = area ? cache[area.id] ?? null : null;
  let status: AreaStatus;
  if (!area) {
    status = 'unavailable';
  } else if (cached) {
    status = 'ready';
  } else if (failed[area.id]) {
    status = 'unavailable';
  } else {
    // Covers both "a job is running for this area" and "this area is queued
    // behind another area's job" — from the parent's point of view those are the
    // same wait, and generation is serialised so a queued area always gets a turn.
    status = 'loading';
  }

  return {
    generated: cached,
    status,
    // Only meaningful for the area actually in flight; a queued area has no
    // elapsed time of its own yet.
    progressMessage:
      status === 'loading' && area?.id === generatingId
        ? jobProgressMessage(elapsedMs, 'life_pathway')
        : '',
  };
}
