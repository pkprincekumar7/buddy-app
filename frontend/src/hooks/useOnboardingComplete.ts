import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';

import type { DispatchFn } from '@/types';

interface UseOnboardingCompleteProps {
  dispatch: DispatchFn;
  activeChildId: string | undefined;
  childData: Record<string, unknown> | null;
  recommendations: Record<string, unknown> | null;
}

export function useOnboardingComplete({
  dispatch,
  activeChildId,
  childData,
  recommendations,
}: UseOnboardingCompleteProps) {
  const navigate = useNavigate();

  return useCallback(async () => {
    dispatch({ type: 'SET_COMPLETION_BUSY', payload: true });
    try {
      const finalData = {
        ...childData,
        onboarding_completed: true,
        recommendations,
      };

      // Child was created at end of phase 1; just update it with the full profile.
      let childId = activeChildId;
      if (childId) {
        await api.entities.Child.update(childId, finalData);
      } else {
        // Fallback: create if somehow not created yet (e.g. user refreshed mid-flow).
        const created = await api.entities.Child.create(finalData);
        childId = created?.id;
        if (childId) dispatch({ type: 'SET_ACTIVE_CHILD_ID', payload: childId });
      }

      if (!childId) throw new Error('No child ID available to save journey');

      navigate(createPageUrl('LifePathway'), { replace: true });
    } catch (err) {
      console.error('[Onboarding] Failed to save journey:', err);
      toast.error('Something went wrong saving your journey. Please try again.');
    } finally {
      dispatch({ type: 'SET_COMPLETION_BUSY', payload: false });
    }
  }, [dispatch, activeChildId, childData, recommendations, navigate]);
}
