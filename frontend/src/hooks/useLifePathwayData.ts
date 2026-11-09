import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { children, type Child } from '@/api/children';
import { discover, viewModelOf, type PersonalityViewModel } from '@/api/discover';
import { transform, type TransformArea } from '@/api/transform';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';

/** Load errors the page answers with a redirect rather than an error state. */
const REDIRECT_CODES = new Set(['circle_locked', 'child_not_found']);

function isRedirectError(err: unknown): err is ApiError {
  return err instanceof ApiError && REDIRECT_CODES.has(err.code ?? '');
}

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

interface LifePathwayData {
  childData: Child;
  viewModel: PersonalityViewModel | null;
  profile: ProfileType;
  /** The completed growth areas, as transform holds them, with their milestones. */
  completedAreas: TransformArea[];
}

/**
 * The child from children, the personality from discover, and the completed areas
 * (with their stored Life Pathway milestones) from transform's one GET (build plan 7.7).
 */
async function fetchLifePathwayData(childId: string): Promise<LifePathwayData> {
  const [child, personality, plan] = await Promise.all([
    children.get(childId),
    discover.personality(childId),
    transform.get(childId),
  ]);
  const viewModel = viewModelOf(personality);
  const profile = viewModel?.profile.name ? onboardingProfileFromViewModel(viewModel) : null;
  return { childData: child, viewModel, profile, completedAreas: plan.areas };
}

export function useLifePathwayData(childId: string | undefined) {
  // childId comes from a route param and can change while this hook stays
  // mounted (switching children without unmounting LifePathway). react-query
  // keys the cache by childId, so a slow response for the previous child can
  // never land as the current child's data — the query for the old key is
  // simply abandoned, which is the same protection the hand-rolled `cancelled`
  // flag this replaced was providing.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lifePathwayData', childId],
    queryFn: () => fetchLifePathwayData(childId!),
    enabled: !!childId,
    // A locked circle or a missing child won't change on a second ask.
    retry: (failureCount, err) => !isRedirectError(err) && failureCount < 1,
  });

  useEffect(() => {
    // The redirect codes are answered by the page, not with a toast.
    if (isError && !isRedirectError(error)) {
      console.error('[useLifePathwayData] Failed to load:', error);
      toast.error('Failed to load your data. Please try again.');
    }
  }, [isError, error]);

  return {
    childData: data?.childData ?? null,
    viewModel: data?.viewModel ?? null,
    profile: data?.profile ?? null,
    isLoading,
    completedAreas: data?.completedAreas ?? [],
    /** The load error, if the last load failed (an ApiError for API failures). */
    error: isError ? error : null,
    retry: refetch,
  };
}
