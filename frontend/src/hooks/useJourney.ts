import { useCallback, useEffect, useState } from 'react';
import { children, type Child } from '@/api/children';
import { discover, settlePersonality, DISCOVER_ERRORS, type Personality } from '@/api/discover';
import { ApiError } from '@/api/errors';
import { httpErrorMessage } from '@/lib/apiError';

// The Personality Journey hub's data (build plan 7.5): the child, with its progress, and
// its personality, waited for while discover generates it. The same hook in both apps.

export type Journey =
  | { status: 'loading' }
  /** The chat isn't done (`circle_locked`): the hub sends the parent back to it. */
  | { status: 'locked' }
  /** No such child (deleted, or not this parent's). */
  | { status: 'missing' }
  | { status: 'analyzing'; child: Child }
  | { status: 'ready'; child: Child; personality: Personality }
  | { status: 'failed'; child: Child | null; message: string };

const FAILED = 'We couldn’t create the personality. Please try again.';

export function useJourney(childId: string | undefined, enabled: boolean) {
  const [journey, setJourney] = useState<Journey>({ status: 'loading' });
  // Each retry runs the load again, starting a new generation after a failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !childId) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let child: Child | null = null;
      try {
        const [loaded, first] = await Promise.all([
          children.get(childId),
          discover.personality(childId),
        ]);
        child = loaded;
        if (signal.aborted) return;
        if (first.status === 'ready') {
          setJourney({ status: 'ready', child, personality: first });
          return;
        }
        setJourney({ status: 'analyzing', child });
        const settled = await settlePersonality(childId, { retry: attempt > 0, signal });
        if (signal.aborted) return;
        setJourney(
          settled.status === 'ready'
            ? { status: 'ready', child, personality: settled }
            : { status: 'failed', child, message: FAILED },
        );
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.code === 'circle_locked') {
          setJourney({ status: 'locked' });
        } else if (err instanceof ApiError && err.code === 'child_not_found') {
          setJourney({ status: 'missing' });
        } else {
          console.warn('[useJourney] Load failed:', err);
          const message = httpErrorMessage(err as Error, {
            codeMessages: DISCOVER_ERRORS,
            fallback: FAILED,
          });
          setJourney({ status: 'failed', child, message });
        }
      }
    })();
    return () => controller.abort();
  }, [childId, enabled, attempt]);

  const retry = useCallback(() => {
    setJourney({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { journey, retry };
}
