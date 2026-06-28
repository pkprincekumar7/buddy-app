import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { EnqueueJobPayload, JobStatus, JobType } from '@/types/api';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 30 * 60 * 1000; // 30 minutes — matches job deadline

export interface UseJobOptions {
  /** Child record's active_jobs map (from GET /children/{id}). */
  activeJobs: Record<string, string> | undefined;
  jobType: JobType;
  /** Called when the job reaches 'completed' so the caller can re-fetch domain data. */
  onCompleted: () => void | Promise<void>;
}

export interface UseJobResult {
  /**
   * Current job status, or null if no job is active.
   * `result_ready` is a transient backend state (LLM done, domain write pending) —
   * treat it the same as `processing`: keep showing the loading UI.
   */
  status: JobStatus | null;
  /** Elapsed ms since the job was created (anchored to created_at from first poll). */
  elapsedMs: number;
  isLoading: boolean;
  isComplete: boolean;
  isFailed: boolean;
  error: string | null;
  enqueue: (payload: EnqueueJobPayload) => Promise<void>;
  /** Re-enqueue after a failure (fresh job, fresh job_id). */
  retry: (payload: EnqueueJobPayload) => Promise<void>;
}

const MAX_CONSECUTIVE_ERRORS = 3;

export function useJob({
  activeJobs,
  jobType,
  onCompleted,
}: UseJobOptions): UseJobResult {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Stable ref so polling always calls the latest onCompleted even if the
  // caller passes an inline arrow function (new reference every render).
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const startTimeRef = useRef<number | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
  }, []);

  // Sync jobId from the server's active_jobs map whenever the child record refreshes.
  // Does NOT clear a locally-set jobId while the job is non-terminal — clearing it
  // would cancel polling for a job we just enqueued before the child re-fetch confirms it.
  useEffect(() => {
    const idFromServer = activeJobs?.[jobType] ?? null;
    if (idFromServer !== jobId) {
      if (idFromServer) {
        setJobId(idFromServer);
      } else if (status === 'completed' || status === 'failed') {
        setJobId(null);
      }
    }
  }, [activeJobs, jobType, jobId, status]);

  // Core polling effect. Starts a self-rescheduling poll loop whenever jobId changes.
  // Uses a local `cancelled` flag + a local `sleepTimer` for clean teardown — no
  // external state (pollTick) needed. This avoids the effect-ordering bug where a
  // separate reset effect could null startTimeRef.current after this effect set it,
  // causing the timeout guard to see (Date.now() - 0) and fail every job immediately.
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;

    // Anchor start time before any async work so the timeout guard has a valid baseline.
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    stopElapsedTimer();
    elapsedRef.current = setInterval(() => {
      setElapsedMs(Date.now() - (startTimeRef.current ?? Date.now()));
    }, 1000);

    const doPoll = async () => {
      if (cancelled) return;

      // 30-minute timeout guard
      if (
        startTimeRef.current !== null &&
        Date.now() - startTimeRef.current > MAX_POLL_MS
      ) {
        stopElapsedTimer();
        setStatus('failed');
        setError('Job timed out after 30 minutes');
        return;
      }

      try {
        const record = await api.jobs.poll(jobId);
        if (cancelled) return;

        consecutiveErrors = 0;
        setStatus(record.status);

        if (record.status === 'completed') {
          stopElapsedTimer();
          void onCompletedRef.current();
        } else if (record.status === 'failed') {
          stopElapsedTimer();
          setError(record.error ?? 'Job failed');
        } else {
          // Non-terminal — schedule the next poll
          sleepTimer = setTimeout(() => {
            void doPoll();
          }, POLL_INTERVAL_MS);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const statusCode = (e as { status?: number })?.status;
        if (statusCode === 404) {
          // Job not found (expired) — clear state
          stopElapsedTimer();
          setJobId(null);
          setStatus(null);
        } else {
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            stopElapsedTimer();
            setStatus('failed');
            setError(
              'Lost connection to server. Please check your network and retry.',
            );
            return;
          }
          sleepTimer = setTimeout(() => {
            void doPoll();
          }, POLL_INTERVAL_MS);
        }
      }
    };

    void doPoll();

    return () => {
      cancelled = true;
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
      stopElapsedTimer();
      startTimeRef.current = null;
    };
  }, [jobId, stopElapsedTimer]);

  const enqueue = useCallback(async (payload: EnqueueJobPayload) => {
    setError(null);
    setStatus('pending');
    try {
      const { job_id } = await api.jobs.enqueue(payload);
      // Reset status after the await so any stale 'failed' from a concurrent
      // old-job poll cannot block the new job's polling loop.
      setStatus('pending');
      setJobId(job_id);
    } catch (e) {
      setStatus(null);
      setError('Failed to start job. Please try again.');
      throw e;
    }
  }, []);

  const retry = useCallback(async (payload: EnqueueJobPayload) => {
    setError(null);
    setStatus(null);
    setElapsedMs(0);
    try {
      const { job_id } = await api.jobs.enqueue(payload);
      setJobId(job_id);
    } catch (e) {
      setError('Failed to start job. Please try again.');
      throw e;
    }
  }, []);

  return {
    status,
    elapsedMs,
    isLoading: status !== null && status !== 'completed' && status !== 'failed',
    isComplete: status === 'completed',
    isFailed: status === 'failed',
    error,
    enqueue,
    retry,
  };
}

/**
 * Returns a human-readable progress message based on elapsed time and job type.
 */
export function jobProgressMessage(
  elapsedMs: number,
  jobType: JobType,
): string {
  const s = elapsedMs / 1000;
  if (s < 3) return '';

  if (jobType === 'generate_recommendations') {
    if (s < 8) return "Analysing your child's growth areas…";
    if (s < 15) return 'Personalising recommendations…';
  } else if (jobType === 'generate_goals_plan') {
    if (s < 8) return 'Building a personalised goals plan…';
    if (s < 15) return 'Tailoring milestones for your child…';
  } else if (jobType === 'generate_personality_analysis') {
    if (s < 8) return 'Shaping personality insights…';
    if (s < 15) return "Finalising your child's personality profile…";
  } else if (jobType === 'generate_journey_recommendations') {
    if (s < 8) return 'Mapping a personalised journey…';
    if (s < 15) return 'Tailoring recommendations for your child…';
  } else {
    if (s < 8) return 'Generating activity ideas…';
    if (s < 15) return 'Personalising activities for your child…';
  }

  if (s < 20) return 'Almost there…';
  if (s < 120)
    return 'This is taking a little longer than usual — you can wait or come back later.';
  return "Still working on this. Feel free to explore the app — we'll have this ready when you return.";
}
