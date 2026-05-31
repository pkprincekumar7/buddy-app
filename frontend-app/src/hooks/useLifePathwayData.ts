import { useState, useEffect } from 'react';
import { toast } from '@/lib/toast';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import type { CompletedArea } from '@/types/api';

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

export function useLifePathwayData(childId: string | undefined) {
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [profile, setProfile] = useState<ProfileType>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completedAreas, setCompletedAreas] = useState<CompletedArea[]>([]);
  const [savedConcern, setSavedConcern] = useState('');

  useEffect(() => {
    if (!childId) return;
    const load = async () => {
      try {
        const child = await api.entities.Child.get(childId);
        setChildData(child);

        if (!child.id) return;

        const [completedData, goals] = await Promise.all([
          api.completedGrowthAreas.list(childId),
          api.goals.get(childId),
        ]);

        const vm = child.personality?.view_model;
        if (vm?.type && vm?.profile)
          setProfile(onboardingProfileFromViewModel(vm));

        // Filter to finalised areas — matches the same 3-way OR used in GrowthAreas.tsx for green ticks.
        // status may have been reset to 'in_progress' if the user re-entered the area after completing it,
        // but ai_three_month_recommendations is never overwritten so it's the reliable completion signal.
        const allAreas = completedData.areas ?? [];
        const completedOnly = allAreas.filter(
          a =>
            a.status === 'completed' ||
            !a.status ||
            (Array.isArray(a.ai_three_month_recommendations) &&
              a.ai_three_month_recommendations.length > 0),
        );
        if (completedOnly.length) setCompletedAreas(completedOnly);

        setSavedConcern(
          typeof goals.parent_concern === 'string'
            ? goals.parent_concern.trim()
            : '',
        );
      } catch (err) {
        console.error('[useLifePathwayData] Failed to load:', err);
        toast.error('Failed to load your data. Please refresh and try again.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [childId]);

  return {
    childData,
    profile,
    isLoading,
    completedAreas,
    savedConcern,
    setSavedConcern,
  };
}
