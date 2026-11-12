import { useCallback, useState } from 'react';
import { toast } from '@/lib/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { kids, KIDS_ERRORS, type KidActivity, type KidEvent } from '@/api/kids';
import { httpErrorMessage } from '@/lib/apiError';
import { localDay } from '@/lib/kidsDay';

/**
 * The child's activity in child view (docs/child-view-build-plan.md, 2.2), for the child's
 * own day, and `send` for what they do: the server answers with the new activity (stars
 * included), which replaces the cached one. A failed send says so in a toast.
 */
export function useKidActivity(childId: string | undefined) {
  const day = localDay();
  const queryClient = useQueryClient();
  const queryKey = ['kids', childId, day];
  const query = useQuery({
    queryKey,
    queryFn: () => kids.activity(childId ?? '', day),
    enabled: Boolean(childId),
  });
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
    day,
  };
}
