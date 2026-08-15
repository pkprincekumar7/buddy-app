import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { jobProgressMessage, useJob } from '@/hooks/useJob';
import { buildLifePathwayAreaPrompt, lifePathwayAreaSchema } from '@/lib/lifePathwayPrompt';
import { normalizeLifePathwayArea } from '@/lib/lifePathwayData';
import type { MilestoneCopy } from '@/lib/lifePathwayData';
import type { GrowthArea } from '@/lib/growthAreaData';
import type { ChildRecord, CompletedArea } from '@/types/api';

/** One entry per milestone slot; null where that slot has no generated content. */
type SlotContent = (MilestoneCopy | null)[];

interface UseLifePathwayAreaOptions {
  childId: string | undefined;
  child: ChildRecord | Record<string, unknown> | null;
  /** Currently selected growth area, or null when none is available. */
  area: GrowthArea | null;
  /** Stored answers/recommendations for the selected area, used to ground the prompt. */
  completedArea: CompletedArea | null;
  /**
   * Every completed area's document, as already loaded by the page. Seeds the
   * cache: each area's milestones are stored on its own document, beside the
   * answers and recommendations they were generated from.
   */
  areas: CompletedArea[];
  /** Prompt inputs the caller has already derived from the personality view model. */
  archetype: string | null;
  personalityNarrative: string | null;
  strengths: string[];
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
 * Two constraints shape this:
 *
 *   1. `children.active_jobs` holds a single slot per job type, and the enqueue
 *      route caps in-flight jobs at 2 per (user, child, type). Firing a job per
 *      dropdown change would clobber that slot and start returning 429s, so
 *      generation is serialised — one job at a time, with the latest requested
 *      area picked up when the current one settles.
 *   2. For the same reason `activeJobs` is deliberately passed as undefined to
 *      useJob: its server-sync effect would otherwise repoint polling at
 *      whichever job_id landed in the shared slot last, which for same-type
 *      concurrent jobs is not necessarily the one we are waiting on. The durable
 *      record of this work is the cache on each area's growth_areas document, not
 *      active_jobs, so nothing is lost by opting out of cross-device resume here.
 *
 * A failed area is not retried within the session — the caller's fallback copy
 * is complete and on-message, so a retry loop would burn quota for no visible
 * gain.
 */
export function useLifePathwayArea({
  childId,
  child,
  area,
  completedArea,
  areas,
  archetype,
  personalityNarrative,
  strengths,
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
  // Own elapsed clock for the progress note, rather than useJob's.
  // useJob resets its elapsedMs when the *job id* changes, which only happens
  // once the enqueue POST returns — so for those few hundred milliseconds it
  // still reports the previous area's elapsed time, long enough to flash a
  // "taking longer than usual" note the instant a parent switches area.
  const startedAtRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Seed from the milestones already stored on each area's document. Runs whenever
  // the list changes and only fills gaps, so a completed job's merge is never
  // overwritten by a subsequent re-fetch.
  useEffect(() => {
    if (areas.length === 0) return;
    setCache((prev) => {
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
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
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
      const fresh = await api.completedGrowthAreas.list(childId);
      const doc = (fresh.areas ?? []).find((a) => a.area_id === finished);
      const ms = normalizeLifePathwayArea(doc?.life_pathway_milestones, ages);
      if (ms) setCache((prev) => ({ ...prev, [finished]: ms }));
    } catch (err) {
      // The content is on the document either way — the next page load picks it
      // up. Falling back to templated copy for now is the correct degradation.
      console.warn('[useLifePathwayArea] Could not read generated content:', err);
    }
  }, [childId, ages, settle]);

  const { enqueue, isFailed } = useJob({
    activeJobs: undefined,
    jobType: 'generate_life_pathway',
    onCompleted: handleCompleted,
  });

  // Free the slot on failure so a later area still gets its turn, and remember
  // which area it was so its card stops waiting.
  useEffect(() => {
    const failedId = inFlightRef.current;
    if (!isFailed || !failedId) return;
    setFailed((prev) => (prev[failedId] ? prev : { ...prev, [failedId]: true }));
    settle();
  }, [isFailed, settle]);

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

    const c = (child ?? {}) as ChildRecord;
    const prompt = buildLifePathwayAreaPrompt({
      childName: typeof c.name === 'string' ? c.name : null,
      age: Number.parseInt(String(c.age ?? ''), 10) || 10,
      gender: typeof c.gender === 'string' ? c.gender : null,
      archetype,
      personalityNarrative,
      strengths,
      area,
      answers: completedArea?.answers ?? null,
      recommendations:
        Array.isArray(completedArea?.ai_three_month_recommendations) &&
        completedArea.ai_three_month_recommendations.length > 0
          ? completedArea.ai_three_month_recommendations
          : (completedArea?.recommendations ?? null),
    });

    void enqueue({
      type: 'generate_life_pathway',
      child_id: childId,
      payload: { prompt, response_json_schema: lifePathwayAreaSchema() },
      write_back: {
        collection: 'growth_areas',
        // area_id scopes the write to this area's document; child_id, user_id and
        // location are injected by the enqueue route.
        filter: { area_id: areaId },
        field: 'life_pathway_milestones',
      },
    }).catch(() => {
      setFailed((prev) => (prev[areaId] ? prev : { ...prev, [areaId]: true }));
      settle();
    });
  }, [
    enabled,
    childId,
    child,
    area,
    completedArea,
    archetype,
    personalityNarrative,
    strengths,
    cache,
    enqueue,
    settle,
  ]);

  const cached = area ? (cache[area.id] ?? null) : null;
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
        ? jobProgressMessage(elapsedMs, 'generate_life_pathway')
        : '',
  };
}
