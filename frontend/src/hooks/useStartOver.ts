import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';

export function useStartOver(childId: string | undefined) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isStartingOver, setIsStartingOver] = useState(false);

  const doStartOver = useCallback(async () => {
    if (isStartingOver || !childId) return;
    setIsStartingOver(true);
    try {
      await api.entities.Child.delete(childId);
      await api.preferences.patch({ last_visited_path: '/Home' }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ['children'] });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        console.warn('[useStartOver] Failed:', err);
        toast.error('Could not start over. Please try again.');
        setIsStartingOver(false);
        return;
      }
    }
    setIsStartingOver(false);
    navigate('/Home', { replace: true });
  }, [isStartingOver, childId, navigate, queryClient]);

  return { doStartOver, isStartingOver };
}
