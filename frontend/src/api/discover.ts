// Discover, the child's AI personality (build plan 7.5), through the generated client.
// Discover generates it on its own once the chat is saved, and builds the view model the
// pages render on the server. The app only reads it, starts a generation when the page
// opens on `not_started` or to retry after `failed`, and records the reveal (`viewed`),
// which makes Discover done and unlocks Grow.

import { ApiError } from './errors';
import { isRateLimited, MAX_INTERVAL_MS, pause, slower } from './polling';
import type { components } from './generated/discover';
import { services, unwrap } from './services';

type Schemas = components['schemas'];

export type Personality = Schemas['Personality'];
export type PersonalityJob = Schemas['Job'];

/** The view model's shape: `{type, scores, profile}`, as the Discover pages render it. */
export interface PersonalityViewModel {
  type: string;
  scores: Record<string, number>;
  profile: Record<string, unknown> & { name?: string };
}

const byId = (id: string) => ({ params: { path: { id } } });

export const discover = {
  personality: (childId: string): Promise<Personality> =>
    unwrap(services.discover.GET('/api/v1/children/{id}/personality', byId(childId))),
  /** Starts a generation, or returns the one already running. */
  generate: (childId: string): Promise<Schemas['Started']> =>
    unwrap(services.discover.POST('/api/v1/children/{id}/personality/generation', byId(childId))),
  job: (childId: string, jobId: string): Promise<PersonalityJob> =>
    unwrap(
      services.discover.GET('/api/v1/children/{id}/personality/generation/{job_id}', {
        params: { path: { id: childId, job_id: jobId } },
      }),
    ),
  /** The parent passed the reveal: Discover is done (refused before the personality is ready). */
  viewed: (childId: string): Promise<Personality> =>
    unwrap(services.discover.POST('/api/v1/children/{id}/personality/viewed', byId(childId))),
};

/** The personality's view model when it's ready, or null. */
export function viewModelOf(personality: Personality | null): PersonalityViewModel | null {
  const vm = personality?.status === 'ready' ? personality.view_model : null;
  return vm ? (vm as unknown as PersonalityViewModel) : null;
}

/**
 * The personality once it has settled (`ready` or `failed`): starts a generation when
 * there's none yet (or, with `retry`, after a failure), then polls the running job.
 */
export async function settlePersonality(
  childId: string,
  {
    retry = false,
    signal,
    intervalMs = 2000,
    maxIntervalMs = MAX_INTERVAL_MS,
    timeoutMs = 5 * 60_000,
  }: {
    retry?: boolean;
    signal?: AbortSignal;
    intervalMs?: number;
    maxIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<Personality> {
  let current = await discover.personality(childId);
  if (current.status === 'not_started' || (retry && current.status === 'failed')) {
    try {
      await discover.generate(childId);
    } catch (err) {
      // Finished meanwhile (another device, or the automatic start): just read it.
      if (!(err instanceof ApiError && err.code === 'already_generated')) throw err;
    }
    current = await discover.personality(childId);
  }
  const deadline = Date.now() + timeoutMs;
  let wait = intervalMs;
  while (current.status === 'generating' || current.status === 'not_started') {
    if (Date.now() > deadline) throw new Error('The personality is taking too long.');
    await pause(wait, signal);
    try {
      if (current.job_id) {
        const job = await discover.job(childId, current.job_id);
        if (job.status === 'pending' || job.status === 'processing') {
          wait = slower(wait, maxIntervalMs);
          continue;
        }
      }
      current = await discover.personality(childId);
    } catch (err) {
      // A 429 (JOB-05): wait the longest, then poll again, instead of failing.
      if (!isRateLimited(err)) throw err;
      wait = Math.max(wait, maxIntervalMs);
      continue;
    }
    wait = slower(wait, maxIntervalMs);
  }
  return current;
}

/** What the Discover pages show for a refusal, matched on `detail.code`. */
export const DISCOVER_ERRORS: Record<string, string> = {
  circle_locked: 'Finish the chat about your child first.',
  llm_limit: 'Lots of requests right now. Please try again in a little while.',
  already_generated: 'The personality is already there.',
  personality_not_ready: 'The personality isn’t ready yet.',
  generation_unavailable: 'We couldn’t start the personality just now. Please try again.',
  onboarding_unavailable: 'We couldn’t reach the server just now. Please try again in a moment.',
  children_unavailable: 'We couldn’t reach the server just now. Please try again in a moment.',
};
