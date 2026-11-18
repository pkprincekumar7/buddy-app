import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { kidWorlds, type KidWorlds } from '@/api/kidWorlds';
import { httpErrorMessage } from '@/lib/apiError';

/**
 * The child's Grow worlds (docs/child-view-build-plan.md, 3.5): the worlds, bands and runs,
 * and `addRun` for a finished world, whose answer replaces the cached one. A failure says so
 * in a toast and resolves to null.
 */
export function useKidWorlds(childId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['kid-worlds', childId],
    queryFn: () => kidWorlds.get(childId ?? ''),
    enabled: Boolean(childId),
  });
  const [saving, setSaving] = useState(false);

  const addRun = useCallback(
    async (world: number, scores: number[]): Promise<KidWorlds | null> => {
      if (!childId) return null;
      setSaving(true);
      try {
        const next = await kidWorlds.addRun(childId, world, scores);
        queryClient.setQueryData(['kid-worlds', childId], next);
        return next;
      } catch (err) {
        console.warn('[useKidWorlds] Save failed:', err);
        toast.error(
          httpErrorMessage(err as Error, { fallback: "That world didn't save. Please try again." }),
        );
        return null;
      } finally {
        setSaving(false);
      }
    },
    [childId, queryClient],
  );

  return {
    worlds: query.data ?? null,
    isLoading: query.isLoading,
    isLoadingError: query.isLoadingError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    addRun,
    saving,
  };
}
