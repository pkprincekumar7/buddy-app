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
        const children = await api.entities.Child.list('-created_date', 1);
        const child = children?.[0] || null;
        if (child) setChildData(child);

        const childId = child?.id;
        if (!childId) {
          setIsLoading(false);
          return;
        }

        const [completedData, goals] = await Promise.all([
          api.completedGrowthAreas.list(childId),
          api.goals.get(childId),
        ]);

        const vm = child.personality?.view_model;
        if (vm?.type && vm?.profile) setProfile(onboardingProfileFromViewModel(vm));

        // Filter to finalised areas only; legacy docs without a status field are treated as completed.
        const completedOnly = (completedData?.areas || []).filter(
          (a) => a.status === 'completed' || !a.status,
        );
        if (completedOnly.length) setCompletedAreas(completedOnly);

        setSavedConcern(
          typeof goals?.parent_concern === 'string' ? goals.parent_concern.trim() : '',
        );
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
