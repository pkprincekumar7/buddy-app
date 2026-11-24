import { useQuery } from '@tanstack/react-query';
import { children, type Child } from '@/api/children';

/**
 * The signed-in parent's children, newest first: the one `['children']` query
 * Home and the profile menu share, so adding or deleting a child (which
 * invalidates it) updates both.
 */
export function useChildren(enabled = true) {
  const query = useQuery({
    queryKey: ['children'],
    queryFn: () => children.list(),
    enabled,
  });
  const list: Child[] = Array.isArray(query.data) ? query.data : [];
  return {
    list,
    isLoading: query.isLoading,
    isLoadingError: query.isLoadingError,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
