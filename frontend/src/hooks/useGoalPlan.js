import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { goalsMonthlyPlanSchema } from '@/lib/llmSchemas';
import { buildGoalsMonthlyPlanPrompt } from '@/lib/prompts';

// Builds a flat-index map over every activity in the plan.
// key: "mIdx-pIdx-aIdx" → flat integer index (sequential across all months/periods/activities)
export function buildFlatIndexMap(goalPlan) {
  const map = new Map();
  if (!goalPlan?.months) return map;
  let idx = 0;
  for (let m = 0; m < goalPlan.months.length; m++) {
    for (let p = 0; p < (goalPlan.months[m].periods?.length || 0); p++) {
      for (let a = 0; a < (goalPlan.months[m].periods[p].activities?.length || 0); a++) {
        map.set(`${m}-${p}-${a}`, idx++);
      }
    }
  }
  return map;
}

// Returns both the flat-index map and the flat index of the first incomplete activity.
export function buildGoalPlanIndex(goalPlan) {
  const map = new Map();
  let firstActiveFlat = 0;
  if (!goalPlan?.months) return { flatIndexMap: map, firstActiveFlat };
  let idx = 0;
  let foundFirst = false;
  for (let m = 0; m < goalPlan.months.length; m++) {
    for (let p = 0; p < (goalPlan.months[m].periods?.length || 0); p++) {
      for (let a = 0; a < (goalPlan.months[m].periods[p].activities?.length || 0); a++) {
        map.set(`${m}-${p}-${a}`, idx);
        if (!foundFirst && !goalPlan.months[m].periods[p].activities[a].completed) {
          firstActiveFlat = idx;
          foundFirst = true;
        }
        idx++;
      }
    }
  }
  if (!foundFirst) firstActiveFlat = idx;
  return { flatIndexMap: map, firstActiveFlat };
}

export function useGoalPlan() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [childData, setChildData] = useState(null);
  const [concern, setConcern] = useState('');
  const [goalPlan, setGoalPlan] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedCompletedAreas, setSavedCompletedAreas] = useState([]);

  const generateGoals = useCallback(async (child, parentConcern, completedAreas, completedSnapshot = {}) => {
    setIsLoading(true);
    const childId = child?.id;
    try {
      let ob = child;
      let areas = completedAreas;
      if (!areas && childId) {
        const [freshChild, freshCompleted] = await Promise.all([
          api.entities.Child.get(childId),
          api.completedGrowthAreas.list(childId),
        ]);
        ob = freshChild;
        areas = freshCompleted?.areas || [];
      }

      const vm = ob?.personality?.view_model;
      const profile = vm?.type && vm?.profile ? onboardingProfileFromViewModel(vm) : null;
      const areasContext = areas
        .map(a => `${a.area_name}: ${(a.recommendations || []).join('; ')}`)
        .join('\n');

      const plan = await api.integrations.Core.InvokeLLM({
        prompt: buildGoalsMonthlyPlanPrompt({
          childName: child?.name,
          childAge: child?.age,
          parentConcern,
          personalityType: profile?.personality_type,
          areasContext,
        }),
        response_json_schema: goalsMonthlyPlanSchema(),
      });

      if (Object.keys(completedSnapshot).length > 0) {
        plan.months?.forEach((month, mIdx) => {
          month.periods?.forEach((period, pIdx) => {
            period.activities?.forEach((act, aIdx) => {
              const snap = completedSnapshot[`${mIdx}-${pIdx}-${aIdx}`];
              if (snap) Object.assign(act, snap);
            });
          });
        });
      }

      if (childId) await api.goals.patch(childId, { plan });
      setGoalPlan(plan);
    } catch (err) {
      console.error('[useGoalPlan] Failed to generate plan:', err);
      toast.error('Failed to generate plan. Please try again.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const children = await api.entities.Child.list('-created_date', 1);
        const child = children?.[0] || null;
        setChildData(child);

        const childId = child?.id;
        if (!childId) { setIsLoading(false); return; }

        const [goals, completedData] = await Promise.all([
          api.goals.get(childId),
          api.completedGrowthAreas.list(childId),
        ]);

        const areas = completedData?.areas || [];
        setSavedCompletedAreas(areas);

        const savedConcern = typeof goals.parent_concern === 'string' ? goals.parent_concern : '';
        setConcern(savedConcern);

        if (goals.plan) {
          setGoalPlan(goals.plan);
          setIsLoading(false);
          return;
        }

        await generateGoals(child, savedConcern, areas);
      } catch (err) {
        console.error('[useGoalPlan] Init failed:', err);
        setIsLoading(false);
      }
    };
    void init();
  }, [generateGoals]);

  // Saves completion data for a single activity by its position in the plan.
  const saveActivityCompletion = useCallback(async (monthIdx, periodIdx, actIdx, result) => {
    const updatedPlan = structuredClone(goalPlan);
    Object.assign(updatedPlan.months[monthIdx].periods[periodIdx].activities[actIdx], {
      completed: true,
      ...result,
    });
    try {
      if (childData?.id) await api.goals.patch(childData.id, { plan: updatedPlan });
      setGoalPlan(updatedPlan);
    } catch (err) {
      console.error('[useGoalPlan] Failed to save activity:', err);
      toast.error('Failed to save activity. Please try again.');
    }
  }, [goalPlan, childData]);

  // Clears completion data from the target activity and every activity after it.
  const handleActivityReset = useCallback(async (monthIdx, periodIdx, actIdx) => {
    const updatedPlan = structuredClone(goalPlan);
    const flatMap = buildFlatIndexMap(updatedPlan);
    const resetFlatIdx = flatMap.get(`${monthIdx}-${periodIdx}-${actIdx}`) ?? 0;

    flatMap.forEach((flatIdx, key) => {
      if (flatIdx >= resetFlatIdx) {
        const [m, p, a] = key.split('-').map(Number);
        const act = updatedPlan.months[m].periods[p].activities[a];
        delete act.completed;
        delete act.score;
        delete act.note;
        delete act.progress_observation;
        delete act.ai_feedback;
        delete act.parent_feedback;
      }
    });

    try {
      if (childData?.id) await api.goals.patch(childData.id, { plan: updatedPlan });
      setGoalPlan(updatedPlan);
    } catch (err) {
      console.error('[useGoalPlan] Failed to reset activity:', err);
      toast.error('Failed to reset activity.');
    }
  }, [goalPlan, childData]);

  const handleStartOver = useCallback(async () => {
    try {
      // Deleting the child cascades goals, recommendations, and growth_areas.
      if (childData?.id) {
        try { await api.entities.Child.delete(childData.id); } catch (err) { if (err?.status !== 404) console.warn('[useGoalPlan] Child delete failed:', err); }
      }
      queryClient.invalidateQueries({ queryKey: ['children'] });
    } catch (err) {
      console.warn('[useGoalPlan] Start over cleanup had errors:', err);
    }
    navigate(createPageUrl('Onboarding'));
  }, [childData, queryClient, navigate]);

  const handleRegenerate = useCallback(async () => {
    const completedSnapshot = {};
    goalPlan?.months?.forEach((month, mIdx) => {
      month.periods?.forEach((period, pIdx) => {
        period.activities?.forEach((act, aIdx) => {
          if (act.completed) completedSnapshot[`${mIdx}-${pIdx}-${aIdx}`] = { ...act };
        });
      });
    });
    await generateGoals(childData, concern, savedCompletedAreas, completedSnapshot);
  }, [goalPlan, childData, concern, savedCompletedAreas, generateGoals]);

  return {
    childData,
    concern,
    goalPlan,
    setGoalPlan,
    isLoading,
    saveActivityCompletion,
    handleActivityReset,
    handleStartOver,
    handleRegenerate,
  };
}
