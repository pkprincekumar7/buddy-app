import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { goalsMonthlyPlanSchema } from '@/lib/llmSchemas';
import { buildGoalsMonthlyPlanPrompt } from '@/lib/prompts';

interface Activity {
  completed?: boolean;
  score?: unknown;
  note?: unknown;
  progress_observation?: unknown;
  ai_feedback?: unknown;
  parent_feedback?: unknown;
  area_name?: string;
  recommendations?: string[];
  [key: string]: unknown;
}

interface Period {
  activities?: Activity[];
  [key: string]: unknown;
}

export interface Month {
  month?: number;
  goal?: string;
  objective?: string;
  periods?: Period[];
  [key: string]: unknown;
}

export interface GoalPlanInsights {
  schema_version: number | null;
  insight_items: unknown[];
  [key: string]: unknown;
}

export interface GoalPlan {
  months: Month[];
  insights?: GoalPlanInsights;
  insights_signature?: number;
  [key: string]: unknown;
}

// Builds a flat-index map over every activity in the plan.
// key: "mIdx-pIdx-aIdx" → flat integer index (sequential across all months/periods/activities)
export function buildFlatIndexMap(goalPlan: GoalPlan | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!goalPlan?.months) return map;
  let idx = 0;
  for (let m = 0; m < goalPlan.months.length; m++) {
    const month = goalPlan.months[m];
    const periods = month?.periods ?? [];
    for (let p = 0; p < periods.length; p++) {
      const period = periods[p];
      const activities = period?.activities ?? [];
      for (let a = 0; a < activities.length; a++) {
        map.set(`${m}-${p}-${a}`, idx++);
      }
    }
  }
  return map;
}

// Returns both the flat-index map and the flat index of the first incomplete activity.
export function buildGoalPlanIndex(goalPlan: GoalPlan | null): {
  flatIndexMap: Map<string, number>;
  firstActiveFlat: number;
} {
  const map = new Map<string, number>();
  let firstActiveFlat = 0;
  if (!goalPlan?.months) return { flatIndexMap: map, firstActiveFlat };
  let idx = 0;
  let foundFirst = false;
  for (let m = 0; m < goalPlan.months.length; m++) {
    const month = goalPlan.months[m];
    const periods = month?.periods ?? [];
    for (let p = 0; p < periods.length; p++) {
      const period = periods[p];
      const activities = period?.activities ?? [];
      for (let a = 0; a < activities.length; a++) {
        map.set(`${m}-${p}-${a}`, idx);
        const act = activities[a];
        if (!foundFirst && act && !act.completed) {
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

export function useGoalPlan(childId: string | undefined) {
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [concern, setConcern] = useState('');
  const [goalPlan, setGoalPlan] = useState<GoalPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedCompletedAreas, setSavedCompletedAreas] = useState<Activity[]>([]);

  const generateGoals = useCallback(
    async (
      child: Record<string, unknown> | null,
      parentConcern: string,
      completedAreas: Activity[] | null,
      completedSnapshot: Record<string, Record<string, unknown>> = {},
    ) => {
      setIsLoading(true);
      const cId = child?.id as string | undefined;
      try {
        let ob: Record<string, unknown> | null = child;
        let areas: Activity[] | null = completedAreas;
        if (!areas && cId) {
          const [freshChild, freshCompleted] = await Promise.all([
            api.entities.Child.get(cId),
            api.completedGrowthAreas.list(cId),
          ]);
          ob = freshChild as Record<string, unknown>;
          // Use only finalised areas for goal generation; legacy docs without status are treated as completed.
          const completedRecord = freshCompleted as Record<string, unknown>;
          const allAreas = Array.isArray(completedRecord?.areas)
            ? (completedRecord.areas as Activity[])
            : [];
          areas = allAreas.filter((a) => a.status === 'completed' || !a.status);
        }

        const obRecord = ob;
        const personality = obRecord?.personality as Record<string, unknown> | undefined;
        const vm = personality?.view_model as
          | { type?: string; profile?: Record<string, unknown> }
          | undefined;
        const profile = vm?.type && vm?.profile ? onboardingProfileFromViewModel(vm) : null;
        const safeAreas = areas ?? [];
        const areasContext = safeAreas
          .map((a) => `${a.area_name ?? ''}: ${(a.recommendations ?? []).join('; ')}`)
          .join('\n');

        const plan = (await api.integrations.Core.InvokeLLM({
          prompt: buildGoalsMonthlyPlanPrompt({
            childName: obRecord?.name as string | undefined,
            childAge: obRecord?.age as number | undefined,
            parentConcern,
            personalityType: profile?.personality_type,
            areasContext,
          }),
          response_json_schema: goalsMonthlyPlanSchema(),
        })) as GoalPlan;

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

        if (cId) await api.goals.patch(cId, { plan });
        setGoalPlan(plan);
      } catch (err) {
        console.error('[useGoalPlan] Failed to generate plan:', err);
        toast.error('Failed to generate plan. Please try again.');
      }
      setIsLoading(false);
    },
    [],
  );

  useEffect(() => {
    if (!childId) return;
    const init = async () => {
      try {
        const child = await api.entities.Child.get(childId);
        const childRecord = child as Record<string, unknown>;
        setChildData(childRecord);

        if (!childRecord?.id) {
          setIsLoading(false);
          return;
        }

        const [goals, completedData] = await Promise.all([
          api.goals.get(childId),
          api.completedGrowthAreas.list(childId),
        ]);

        const goalsRecord = goals as Record<string, unknown>;
        const completedRecord = completedData as Record<string, unknown>;

        // Use only finalised areas; legacy docs without status are treated as completed.
        const allFetched = Array.isArray(completedRecord?.areas)
          ? (completedRecord.areas as Activity[])
          : [];
        const areas = allFetched.filter((a) => a.status === 'completed' || !a.status);
        setSavedCompletedAreas(areas);

        const savedConcern =
          typeof goalsRecord?.parent_concern === 'string' ? goalsRecord.parent_concern : '';
        setConcern(savedConcern);

        if (goalsRecord?.plan) {
          setGoalPlan(goalsRecord.plan as GoalPlan);
          setIsLoading(false);
          return;
        }

        await generateGoals(childRecord, savedConcern, areas);
      } catch (err) {
        console.error('[useGoalPlan] Init failed:', err);
        setIsLoading(false);
      }
    };
    void init();
  }, [childId, generateGoals]);

  // Saves completion data for a single activity by its position in the plan.
  const saveActivityCompletion = useCallback(
    async (
      monthIdx: number,
      periodIdx: number,
      actIdx: number,
      result: Record<string, unknown>,
    ) => {
      const updatedPlan = structuredClone(goalPlan);
      if (!updatedPlan) return;
      const act = updatedPlan.months[monthIdx]?.periods?.[periodIdx]?.activities?.[actIdx];
      if (act) {
        Object.assign(act, { completed: true, ...result });
      }
      try {
        const childId = childData?.id as string | undefined;
        if (childId) await api.goals.patch(childId, { plan: updatedPlan });
        setGoalPlan(updatedPlan);
      } catch (err) {
        console.error('[useGoalPlan] Failed to save activity:', err);
        toast.error('Failed to save activity. Please try again.');
      }
    },
    [goalPlan, childData],
  );

  // Clears completion data from the target activity and every activity after it.
  const handleActivityReset = useCallback(
    async (monthIdx: number, periodIdx: number, actIdx: number) => {
      const updatedPlan = structuredClone(goalPlan);
      if (!updatedPlan) return;
      const flatMap = buildFlatIndexMap(updatedPlan);
      const resetFlatIdx = flatMap.get(`${monthIdx}-${periodIdx}-${actIdx}`) ?? 0;

      flatMap.forEach((flatIdx, key) => {
        if (flatIdx >= resetFlatIdx) {
          const parts = key.split('-').map(Number);
          const m = parts[0] ?? 0;
          const p = parts[1] ?? 0;
          const a = parts[2] ?? 0;
          const act = updatedPlan.months[m]?.periods?.[p]?.activities?.[a];
          if (act) {
            delete act.completed;
            delete act.score;
            delete act.note;
            delete act.progress_observation;
            delete act.ai_feedback;
            delete act.parent_feedback;
          }
        }
      });

      try {
        const cId = childData?.id as string | undefined;
        if (cId) await api.goals.patch(cId, { plan: updatedPlan });
        setGoalPlan(updatedPlan);
      } catch (err) {
        console.error('[useGoalPlan] Failed to reset activity:', err);
        toast.error('Failed to reset activity.');
      }
    },
    [goalPlan, childData],
  );

  const handleRegenerate = useCallback(async () => {
    const completedSnapshot: Record<string, Record<string, unknown>> = {};
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
    handleRegenerate,
  };
}
