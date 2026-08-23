import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import type { ChildRecord, CompletedArea } from '@/types/api';

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

interface LifePathwayData {
  childData: ChildRecord;
  profile: ProfileType;
  completedAreas: CompletedArea[];
  parentConcern: string;
}

async function fetchLifePathwayData(childId: string): Promise<LifePathwayData> {
  const child = await api.entities.Child.get(childId);
  if (!child.id) {
    return { childData: child, profile: null, completedAreas: [], parentConcern: '' };
  }

  const [completedData, goals] = await Promise.all([
    api.completedGrowthAreas.list(childId),
    api.goals.get(childId),
  ]);

  const vm = child.personality?.view_model;
  const profile = vm?.profile?.name ? onboardingProfileFromViewModel(vm) : null;

  // Filter to finalised areas — matches the same 3-way OR used in GrowthAreas.tsx for green ticks.
  // status may have been reset to 'in_progress' if the user re-entered the area after completing it,
  // but ai_three_month_recommendations is never overwritten so it's the reliable completion signal.
  const allAreas = completedData.areas ?? [];
  const completedAreas = allAreas.filter(
    (a) =>
      a.status === 'completed' ||
      !a.status ||
      (Array.isArray(a.ai_three_month_recommendations) &&
        a.ai_three_month_recommendations.length > 0),
  );

  const parentConcern = typeof goals.parent_concern === 'string' ? goals.parent_concern.trim() : '';

  return { childData: child, profile, completedAreas, parentConcern };
}

export function useLifePathwayData(childId: string | undefined) {
  // childId comes from a route param and can change while this hook stays
  // mounted (switching children without unmounting LifePathway). react-query
  // keys the cache by childId, so a slow response for the previous child can
  // never land as the current child's data — the query for the old key is
  // simply abandoned, which is the same protection the hand-rolled `cancelled`
  // flag this replaced was providing.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lifePathwayData', childId],
    queryFn: () => fetchLifePathwayData(childId!),
    enabled: !!childId,
  });

  // The parent's concern is a local, independently-editable copy: LifePathway
  // patches it directly (not through this hook) after the parent edits it, so
  // it can't simply be `data.parentConcern` — seed it once when the fetch
  // resolves, then let the caller override it via setSavedConcern.
  const [savedConcern, setSavedConcern] = useState('');
  useEffect(() => {
    if (data) setSavedConcern(data.parentConcern);
  }, [data]);

  useEffect(() => {
    if (isError) {
      console.error('[useLifePathwayData] Failed to load');
      toast.error('Failed to load your data. Please refresh and try again.');
    }
  }, [isError]);

  // Once Life Pathway content has loaded for this child, mark Transform as visited
  // — this unlocks the Release/Connect circles on the DimensionCircles page.
  useEffect(() => {
    if (!childId || !data?.childData?.id || data.childData.transform_visited) return;
    api.entities.Child.update(childId, { transform_visited: true }).catch(console.error);
  }, [childId, data?.childData?.id, data?.childData?.transform_visited]);

  return {
    childData: data?.childData ?? null,
    profile: data?.profile ?? null,
    isLoading,
    completedAreas: data?.completedAreas ?? [],
    savedConcern,
    setSavedConcern,
  };
}
