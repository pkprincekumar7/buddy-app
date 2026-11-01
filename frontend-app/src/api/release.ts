// Release, the observation patterns (build plan 7.7), through the generated client.
// Release generates the patterns itself, from the onboarding answers and the growth
// areas it holds copies of, and validates them on the server: the app reads them,
// asks for a generation when there are none (or to refresh them), and saves what the
// parent watches. The first non-empty "Start tracking" makes Release done.

import type { components } from './generated/release';
import { runJob, type PollOptions } from './polling';
import { services, unwrap } from './services';

type Schemas = components['schemas'];

export type ObservationsDoc = Schemas['Observations'];
export type ObservationItem = Schemas['ObservationItem'];

const byId = (id: string) => ({ params: { path: { id } } });

export const release = {
  get: (childId: string): Promise<ObservationsDoc> =>
    unwrap(
      services.release.GET('/api/v1/children/{id}/observations', byId(childId)),
    ),
  /** "Start tracking": the watched pattern ids and the span; release sets `started_at`. */
  watch: (
    childId: string,
    watching: string[],
    span: string,
  ): Promise<ObservationsDoc> =>
    unwrap(
      services.release.PATCH('/api/v1/children/{id}/observations', {
        ...byId(childId),
        body: { watching, span },
      }),
    ),
  generate: (childId: string) =>
    unwrap(
      services.release.POST(
        '/api/v1/children/{id}/observations/generation',
        byId(childId),
      ),
    ),
  job: (childId: string, jobId: string) =>
    unwrap(
      services.release.GET(
        '/api/v1/children/{id}/observations/generation/{job_id}',
        {
          params: { path: { id: childId, job_id: jobId } },
        },
      ),
    ),
};

/** Generates the patterns (or joins the running generation) and polls it to its end. */
export function runObservationsGeneration(
  childId: string,
  options: PollOptions = {},
): Promise<'completed' | 'failed'> {
  return runJob(
    () => release.generate(childId),
    jobId => release.job(childId, jobId),
    options,
  );
}

/** What the Observations page shows for a refusal, matched on `detail.code`. */
export const RELEASE_ERRORS: Record<string, string> = {
  circle_locked: 'Finish the 90-day plan first, then come back.',
  observations_changed: 'The patterns changed meanwhile. Please try again.',
  unknown_pattern: 'Those patterns changed. Please pick again.',
  needs_evidence:
    'There isn’t enough to go on yet: complete a growth area first.',
  llm_limit: 'Lots of requests right now. Please try again in a little while.',
  generation_unavailable: 'We couldn’t start that just now. Please try again.',
};
