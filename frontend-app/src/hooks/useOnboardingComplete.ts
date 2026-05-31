import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { toast } from '@/lib/toast';
import { api } from '@/api/client';
import type { RootStackParamList } from '@/navigation';
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
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  return useCallback(async () => {
    dispatch({ type: 'SET_COMPLETION_BUSY', payload: true });
    try {
      const finalData = {
        ...childData,
        onboarding_completed: true,
        recommendations,
      };

      let childId = activeChildId;
      if (childId) {
        await api.entities.Child.update(childId, finalData);
      } else {
        const created = await api.entities.Child.create(finalData);
        childId = created?.id;
        if (childId)
          dispatch({ type: 'SET_ACTIVE_CHILD_ID', payload: childId });
      }

      if (!childId) throw new Error('No child ID available to save journey');

      navigation.replace('Main');
    } catch (err) {
      console.error('[Onboarding] Failed to save journey:', err);
      toast.error(
        'Something went wrong saving your journey. Please try again.',
      );
    } finally {
      dispatch({ type: 'SET_COMPLETION_BUSY', payload: false });
    }
  }, [dispatch, activeChildId, childData, recommendations, navigation]);
}
