import { useCallback } from 'react';
import { useNavigate } from '@/lib/router';
import { useDeleteChild } from '@/hooks/useDeleteChild';

/** Start Over: deletes this child, then goes Home. */
export function useStartOver(childId: string | undefined) {
  const navigate = useNavigate();
  const { deleteChild, deletingId } = useDeleteChild();

  const doStartOver = useCallback(async () => {
    if (!childId) return;
    if (await deleteChild(childId, 'Could not start over. Please try again.')) {
      void navigate('/Home', { replace: true });
    }
  }, [childId, deleteChild, navigate]);

  return { doStartOver, isStartingOver: deletingId !== null };
}
