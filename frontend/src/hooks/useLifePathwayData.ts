import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';

interface CompletedArea {
  status?: string;
  ai_three_month_recommendations?: unknown[];
  area_id?: string;
  area_name?: string;
  area_color?: string;
  recommendations?: string[];
  answers?: Record<string, unknown>;
  [key: string]: unknown;
}

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

export function useLifePathwayData(childId: string | undefined) {
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [profile, setProfile] = useState<ProfileType>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completedAreas, setCompletedAreas] = useState<CompletedArea[]>([]);
  const [savedConcern, setSavedConcern] = useState('');

  useEffect(() => {
    if (!childId) return;
    const load = async () => {
      try {
        const child = await api.entities.Child.get(childId);
        const childRecord = child as Record<string, unknown>;
        if (childRecord) setChildData(childRecord);

        if (!childRecord?.id) {
          setIsLoading(false);
          return;
        }

        const [completedData, goals] = await Promise.all([
          api.completedGrowthAreas.list(childId),
          api.goals.get(childId),
        ]);

        const completedRecord = completedData as Record<string, unknown>;
        const goalsRecord = goals as Record<string, unknown>;

        const personality = childRecord?.personality as Record<string, unknown> | undefined;
        const vm = personality?.view_model as
          | { type?: string; profile?: Record<string, unknown> }
          | undefined;
        if (vm?.type && vm?.profile) setProfile(onboardingProfileFromViewModel(vm));

        // Filter to finalised areas — matches the same 3-way OR used in GrowthAreas.tsx for green ticks.
        // status may have been reset to 'in_progress' if the user re-entered the area after completing it,
        // but ai_three_month_recommendations is never overwritten so it's the reliable completion signal.
        const allAreas = Array.isArray(completedRecord?.areas)
          ? (completedRecord.areas as CompletedArea[])
          : [];
        const completedOnly = allAreas.filter(
          (a) =>
            a.status === 'completed' ||
            !a.status ||
            (Array.isArray(a.ai_three_month_recommendations) &&
              a.ai_three_month_recommendations.length > 0),
        );
        if (completedOnly.length) setCompletedAreas(completedOnly);

        setSavedConcern(
          typeof goalsRecord?.parent_concern === 'string' ? goalsRecord.parent_concern.trim() : '',
        );
      } catch (err) {
        console.error('[useLifePathwayData] Failed to load:', err);
        toast.error('Failed to load your data. Please refresh and try again.');
      }
      setIsLoading(false);
    };
    void load();
  }, [childId]);

  return { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern };
}
