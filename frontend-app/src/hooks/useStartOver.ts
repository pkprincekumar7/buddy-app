import { useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RootStackParamList } from '@/navigation';

export function useStartOver(childId: string | undefined) {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
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
    navigation.replace('Main');
  }, [isStartingOver, childId, navigation, queryClient]);

  return { doStartOver, isStartingOver };
}
