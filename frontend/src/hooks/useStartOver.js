import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export function useStartOver(childId) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isStartingOver, setIsStartingOver] = useState(false);

  const doStartOver = useCallback(async () => {
    if (isStartingOver || !childId) return;
    setIsStartingOver(true);
    try {
      await api.entities.Child.delete(childId);
      await api.preferences.patch({ last_visited_path: '/Home' }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['children'] });
    } catch (err) {
      if (err?.status !== 404) {
        console.warn('[useStartOver] Failed:', err);
        toast.error('Could not start over. Please try again.');
        setIsStartingOver(false);
        return;
      }
    }
    setIsStartingOver(false);
    navigate('/Home', { replace: true });
  }, [isStartingOver, childId, navigate, queryClient]);

  const startOver = useCallback(() => {
    if (!childId) return;
    toast.warning("This child's progress will be permanently deleted.", {
      action: { label: 'Yes, start over', onClick: doStartOver },
      cancel: { label: 'Cancel', onClick: () => {} },
      duration: 6000,
    });
  }, [doStartOver, childId]);

  return { startOver, isStartingOver };
}
