// Waiting between polls of a generation job, shared by the circle modules.

import { ApiError } from './errors';

/** Polls slow down from `intervalMs` to this, so a long job (or several at once) stays
 *  well under the status routes' rate limit (production-readiness review, JOB-05). */
export const MAX_INTERVAL_MS = 5000;

/** An Error named `AbortError` (React Native has no DOMException). */
function aborted(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/** Resolves after `ms`, or rejects with an AbortError once `signal` aborts. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(aborted());
    });
  });
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** A 429: the poll is retried after a longer wait instead of failing the generation. */
export function isRateLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

/** The next wait: half as long again, up to `maxMs` (a wait already past it stays). */
export function slower(ms: number, maxMs: number = MAX_INTERVAL_MS): number {
  return Math.max(ms, Math.min(Math.round(ms * 1.5), maxMs));
}

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Starts a generation job and polls it to its end: `completed` or `failed`. `start`
 * returns the new job (or the one already running), `poll` reads its status. Polls start
 * every `intervalMs` and slow down to `maxIntervalMs`; a 429 waits the longest and polls again.
 */
export async function runJob(
  start: () => Promise<{ job_id: string }>,
  poll: (jobId: string) => Promise<{ status: string }>,
  {
    signal,
    intervalMs = 2000,
    maxIntervalMs = MAX_INTERVAL_MS,
    timeoutMs = 5 * 60_000,
  }: PollOptions = {},
): Promise<'completed' | 'failed'> {
  const { job_id: jobId } = await start();
  const deadline = Date.now() + timeoutMs;
  let wait = intervalMs;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error('The generation is taking too long.');
    await pause(wait, signal);
    let status: string;
    try {
      ({ status } = await poll(jobId));
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      wait = Math.max(wait, maxIntervalMs);
      continue;
    }
    if (status === 'completed' || status === 'failed') return status;
    wait = slower(wait, maxIntervalMs);
  }
}
