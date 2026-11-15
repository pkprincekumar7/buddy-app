import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  kidQuests,
  questKey,
  QUEST_ERRORS,
  type KidQuests,
  type QuestInterestKey,
} from '@/api/kidQuests';
import { httpErrorMessage } from '@/lib/apiError';
import { localDay } from '@/lib/kidsDay';

/**
 * The child's quests (docs/child-view-build-plan.md, 3.2) for their own day, and the two
 * writes: `pick` an interest and `log` a quest. The server answers with the new state, which
 * replaces the cached one; `log` resolves to whether this was the quest's first log, so the
 * page can send its star. A failure says so in a toast.
 */
export function useKidQuests(childId: string | undefined) {
  const day = localDay();
  const queryClient = useQueryClient();
  const queryKey = ['kid-quests', childId, day];
  const query = useQuery({
    queryKey,
    queryFn: () => kidQuests.get(childId ?? '', day),
    enabled: Boolean(childId),
  });
  const [sending, setSending] = useState(false);

  const write = useCallback(
    async (call: (id: string) => Promise<KidQuests>): Promise<KidQuests | null> => {
      if (!childId) return null;
      setSending(true);
      try {
        const next = await call(childId);
        queryClient.setQueryData(['kid-quests', childId, day], next);
        return next;
      } catch (err) {
        console.warn('[useKidQuests] Save failed:', err);
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: QUEST_ERRORS,
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

  const pick = useCallback(
    (interest: QuestInterestKey) => write((id) => kidQuests.pick(id, day, interest)),
    [write, day],
  );

  const log = useCallback(
    async (interest: QuestInterestKey, quest: number): Promise<boolean> => {
      const key = questKey(interest, quest);
      const before = query.data?.logs[key] ?? 0;
      const next = await write((id) => kidQuests.log(id, day, interest, quest));
      return before === 0 && (next?.logs[key] ?? 0) > 0;
    },
    [write, day, query.data],
  );

  return {
    quests: query.data ?? null,
    isLoading: query.isLoading,
    isLoadingError: query.isLoadingError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    pick,
    log,
    sending,
  };
}
