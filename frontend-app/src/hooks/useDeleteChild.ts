import { useState, useCallback } from 'react';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { children } from '@/api/children';
import { ApiError } from '@/api/errors';

const DEFAULT_FAILURE = 'Could not delete this child. Please try again.';

/**
 * Deletes a child (`DELETE /api/v1/children/{id}`) and refreshes the
 * `['children']` list. Resolves true when the child is gone, a 404 included
 * (already deleted); false after a failure, which it has already reported in a
 * toast. One deletion at a time.
 */
export function useDeleteChild() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteChild = useCallback(
    async (
      childId: string,
      failureMessage: string = DEFAULT_FAILURE,
    ): Promise<boolean> => {
      if (deletingId) return false;
      setDeletingId(childId);
      try {
        await children.remove(childId);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) {
          console.warn('[useDeleteChild] Failed:', err);
          toast.error(failureMessage);
          return false;
        }
      } finally {
        setDeletingId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['children'] });
      return true;
    },
    [deletingId, queryClient],
  );

  return { deleteChild, deletingId };
}
