import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from '@/lib/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { kids, KIDS_ERRORS, type KidActivity, type KidEvent } from '@/api/kids';
import { httpErrorMessage } from '@/lib/apiError';
import { localDay } from '@/lib/kidsDay';

/**
 * How a reader re-reads while progress is expected: each second for EXPECT_FAST_MS, then
 * every EXPECT_SLOW_POLL_MS (a worker lagging) until EXPECT_FOR_MS in all.
 */
const EXPECT_POLL_MS = 1000;
const EXPECT_FAST_MS = 15_000;
const EXPECT_SLOW_POLL_MS = 5000;
const EXPECT_FOR_MS = 120_000;

/**
 * Progress another service records reaches the child's activity a moment later: grow's world
 * runs and transform's quest logs are published as events (grow.world_played,
 * transform.quest_logged) in the run's or the log's own transaction, and children applies
 * them. While one is expected, every reader of that child's activity (the kids page, the
 * hub) re-reads it until it shows, or EXPECT_FOR_MS pass. The deadlines are kept by timers,
 * not by the reads, so failing reads stop too; giving up marks the activity stale, so the
 * next page to open re-reads it. Kept outside React so it outlives the page that started it
 * (the child may go back to the hub at once).
 */
interface Expectation {
  done: (activity: KidActivity) => boolean;
  fastUntil: number;
  until: number;
  /** Past EXPECT_FAST_MS (a new snapshot, so the readers re-render). */
  slow: boolean;
  timers: ReturnType<typeof setTimeout>[];
}
const expected = new Map<string, Expectation>();
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach(l => l());
}
function setExpected(childId: string, value: Expectation | null) {
  expected.get(childId)?.timers.forEach(clearTimeout);
  if (value) expected.set(childId, value);
  else expected.delete(childId);
  notify();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The re-read interval for the child now: false with nothing expected or past the end. */
function pollInterval(childId: string | undefined): number | false {
  const expectation = childId ? expected.get(childId) : undefined;
  if (!expectation) return false;
  const now = Date.now();
  if (now >= expectation.until) return false;
  return now < expectation.fastUntil ? EXPECT_POLL_MS : EXPECT_SLOW_POLL_MS;
}

/**
 * The child's activity in child view (docs/child-view-build-plan.md, 2.2), for the child's
 * own day, and `send` for what they do: the server answers with the new activity (stars
 * included), which replaces the cached one. A failed send says so in a toast.
 * `awaitProgress` is for what grow and transform record instead (see Expectation).
 */
export function useKidActivity(childId: string | undefined) {
  const day = localDay();
  const queryClient = useQueryClient();
  const queryKey = ['kids', childId, day];
  const expectation = useSyncExternalStore(subscribe, () =>
    childId ? expected.get(childId) : undefined,
  );
  const query = useQuery({
    queryKey,
    queryFn: () => kids.activity(childId ?? '', day),
    enabled: Boolean(childId),
    // Read at each fetch, failed ones included; the timers in awaitProgress re-render the
    // readers when the phase changes or the expectation ends.
    refetchInterval: () => pollInterval(childId),
  });
  const { data } = query;
  useEffect(() => {
    if (childId && expectation && data && expectation.done(data)) {
      setExpected(childId, null);
    }
  }, [childId, expectation, data]);

  /** Re-read until `done` holds: after a world run or a quest log, for its progress. */
  const awaitProgress = useCallback(
    (done: (activity: KidActivity) => boolean) => {
      if (!childId) return;
      const now = Date.now();
      const next: Expectation = {
        done,
        fastUntil: now + EXPECT_FAST_MS,
        until: now + EXPECT_FOR_MS,
        slow: false,
        timers: [],
      };
      // A new or ended expectation clears these (setExpected).
      next.timers.push(
        setTimeout(() => {
          // A new snapshot, so the readers re-render and take the slower interval.
          expected.set(childId, { ...next, slow: true });
          notify();
        }, EXPECT_FAST_MS),
        setTimeout(() => {
          setExpected(childId, null);
          // Not shown yet: stale, so the next page to open reads it again.
          void queryClient.invalidateQueries({
            queryKey: ['kids', childId],
            refetchType: 'none',
          });
        }, EXPECT_FOR_MS),
      );
      setExpected(childId, next);
      void queryClient.invalidateQueries({ queryKey: ['kids', childId] });
    },
    [childId, queryClient],
  );
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (event: KidEvent): Promise<KidActivity | null> => {
      if (!childId) return null;
      setSending(true);
      try {
        const next = await kids.send(childId, day, event);
        queryClient.setQueryData(['kids', childId, day], next);
        return next;
      } catch (err) {
        console.warn('[useKidActivity] Send failed:', err);
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: KIDS_ERRORS,
            fallback: "That didn't save. Please try again.",
          }),
        );
        return null;
      } finally {
        setSending(false);
      }
    },
    [childId, day, queryClient],
  );

  return {
    activity: query.data ?? null,
    isLoading: query.isLoading,
    isLoadingError: query.isLoadingError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    send,
    sending,
    awaitProgress,
    day,
  };
}
