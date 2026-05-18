import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';

export function useLifePathwayData() {
  const [childData, setChildData] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completedAreas, setCompletedAreas] = useState([]);
  const [savedConcern, setSavedConcern] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [onboarding, completedData, children, goals] = await Promise.all([
          api.onboarding.get(),
          api.completedGrowthAreas.list(),
          api.entities.Child.list('-created_date', 1),
          api.goals.get(),
        ]);

        const resolvedChild = children?.[0] || onboarding?.child_data || null;
        if (resolvedChild) setChildData(resolvedChild);

        const vm = onboarding?.personality?.view_model;
        if (vm?.type && vm?.profile) setProfile(onboardingProfileFromViewModel(vm));

        if (completedData?.areas?.length) setCompletedAreas(completedData.areas);

        setSavedConcern(typeof goals?.parent_concern === 'string' ? goals.parent_concern.trim() : '');
      } catch (err) {
        console.error('[useLifePathwayData] Failed to load:', err);
        toast.error('Failed to load your data. Please refresh and try again.');
      }
      setIsLoading(false);
    };
    void load();
  }, []);

  return { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern };
}
