// Grow, the six growth areas (build plan 7.6), through the generated client. One document
// per area holds the parent's answers, the child's picks and the generated parts (the
// parent's questions, the child's rounds, the three-month recommendations). Grow writes
// the generated parts itself, from prompts it builds: the app only asks for a `kind` and
// polls the job. Completing the first area makes Grow done, which unlocks Transform.

import { ApiError } from './errors';
import type { components } from './generated/grow';
import { runJob, type PollOptions } from './polling';
import { services, unwrap } from './services';

type Schemas = components['schemas'];

export type GrowthAreaDoc = Schemas['Area'];
export type AreaSave = Schemas['AreaIn'];
export type GrowKind = Schemas['GenerationIn']['kind'];
export type GrowJob = Schemas['Job'];

const areaPath = (childId: string, areaId: string) => ({
  params: { path: { id: childId, area_id: areaId } },
});

export const grow = {
  /** All of the child's areas, in the order they were started. */
  list: async (childId: string): Promise<GrowthAreaDoc[]> =>
    (
      await unwrap(
        services.grow.GET('/api/v1/children/{id}/growth-areas', {
          params: { path: { id: childId } },
        }),
      )
    ).areas,
  /** Saves the area. Every saved field is replaced, so send them all (see `areaSave`). */
  save: (childId: string, areaId: string, area: AreaSave): Promise<GrowthAreaDoc> =>
    unwrap(
      services.grow.PUT('/api/v1/children/{id}/growth-areas/{area_id}', {
        ...areaPath(childId, areaId),
        body: area,
      }),
    ),
  /** Starts a generation, or returns the one already running for that kind. */
  generate: (childId: string, areaId: string, kind: GrowKind, areaName?: string) =>
    unwrap(
      services.grow.POST('/api/v1/children/{id}/growth-areas/{area_id}/generation', {
        ...areaPath(childId, areaId),
        body: { kind, ...(areaName === undefined ? {} : { area_name: areaName }) },
      }),
    ),
  job: (childId: string, areaId: string, jobId: string): Promise<GrowJob> =>
    unwrap(
      services.grow.GET('/api/v1/children/{id}/growth-areas/{area_id}/generation/{job_id}', {
        params: { path: { id: childId, area_id: areaId, job_id: jobId } },
      }),
    ),
};

/**
 * What a save sends: the area's stored fields with `changes` on top. The PUT replaces
 * every saved field, so anything left out would be cleared. A completed area stays
 * completed (grow refuses to take it back).
 */
export function areaSave(
  stored: GrowthAreaDoc | undefined,
  areaName: string,
  changes: Partial<AreaSave>,
): AreaSave {
  const save: AreaSave = {
    area_name: stored?.area_name ?? areaName,
    status: stored?.status ?? 'in_progress',
    step: stored?.step ?? null,
    answers: stored?.answers ?? {},
    child_activity: stored?.child_activity ?? null,
    recommendations: stored?.recommendations ?? null,
    feedback: stored?.feedback ?? null,
    ...changes,
  };
  if (stored?.status === 'completed') save.status = 'completed';
  return save;
}

/**
 * Runs one generation to its end: starts it (or joins the one running) and polls its
 * job. A part that's already there (`409 already_generated`) counts as done.
 */
export async function runGrowGeneration(
  childId: string,
  areaId: string,
  kind: GrowKind,
  { areaName, ...options }: { areaName?: string } & PollOptions = {},
): Promise<'completed' | 'failed'> {
  try {
    return await runJob(
      () => grow.generate(childId, areaId, kind, areaName),
      (jobId) => grow.job(childId, areaId, jobId),
      options,
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === 'already_generated') return 'completed';
    throw err;
  }
}

/** What the Growth Areas page shows for a refusal, matched on `detail.code`. */
export const GROW_ERRORS: Record<string, string> = {
  circle_locked: 'Discover comes first: see your child’s personality, then come back.',
  area_changed: 'This area changed meanwhile. Please try again.',
  area_completed: 'This area is already complete.',
  area_too_large: 'That’s too much to save for one area. Please shorten your answers.',
  unknown_question: 'These answers don’t match the questions. Please reopen the area.',
  needs_answers: 'Please answer the questions first.',
  llm_limit: 'Lots of requests right now. Please try again in a little while.',
  generation_paused: 'Generating is paused for a little while. Please try again later.',
  generation_unavailable: 'We couldn’t start that just now. Please try again.',
};
