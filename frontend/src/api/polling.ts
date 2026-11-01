// Waiting between polls of a generation job, shared by the circle modules.

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

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Starts a generation job and polls it to its end: `completed` or `failed`. `start`
 * returns the new job (or the one already running), `poll` reads its status.
 */
export async function runJob(
  start: () => Promise<{ job_id: string }>,
  poll: (jobId: string) => Promise<{ status: string }>,
  { signal, intervalMs = 2000, timeoutMs = 5 * 60_000 }: PollOptions = {},
): Promise<'completed' | 'failed'> {
  const { job_id: jobId } = await start();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('The generation is taking too long.');
    await pause(intervalMs, signal);
    const { status } = await poll(jobId);
    if (status === 'completed' || status === 'failed') return status;
  }
}
