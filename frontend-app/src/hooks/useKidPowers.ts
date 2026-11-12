import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { discover } from '@/api/discover';

/**
 * Child view's powers (docs/child-view-build-plan.md, 2.5), from the child's personality.
 * `notReady` while the personality is still being made (`404 personality_not_ready`): the page
 * says so and offers a retry, rather than an error.
 */
export function useKidPowers(childId: string | undefined) {
  const query = useQuery({
    queryKey: ['kids-powers', childId],
    queryFn: () => discover.powers(childId ?? ''),
    enabled: Boolean(childId),
    // The levels follow a personality that doesn't change once it's ready.
    staleTime: Infinity,
    retry: (count, err) =>
      !(err instanceof ApiError && err.code === 'personality_not_ready') &&
      count < 2,
  });
  const notReady =
    query.error instanceof ApiError &&
    query.error.code === 'personality_not_ready';
  return {
    powers: query.data ?? null,
    isLoading: query.isLoading,
    isLoadingError: query.isLoadingError,
    notReady,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
