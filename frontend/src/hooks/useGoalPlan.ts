import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { goalsMonthlyPlanSchema } from '@/lib/llmSchemas';
import { buildGoalsMonthlyPlanPrompt } from '@/lib/prompts';
import { useJob } from './useJob';

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
  const [isInitializing, setIsInitializing] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [savedCompletedAreas, setSavedCompletedAreas] = useState<Activity[]>([]);

  // Snapshot of completed activities preserved across a regeneration — stored in a
  // ref so the onCompleted callback always reads the latest value without being
  // recreated on every render (which would re-trigger useJob's ref update effect).
  const pendingSnapshotRef = useRef<Record<string, Record<string, unknown>>>({});

  const refetchAndApplyGoals = useCallback(async () => {
    if (!childId) return;
    setIsApplying(true);
    try {
      const goals = await api.goals.get(childId);
      const goalsRecord = goals as Record<string, unknown>;
      if (goalsRecord?.plan) {
        const plan = goalsRecord.plan as GoalPlan;
        const snap = pendingSnapshotRef.current;
        if (Object.keys(snap).length > 0) {
          plan.months?.forEach((month, mIdx) => {
            month.periods?.forEach((period, pIdx) => {
              period.activities?.forEach((act, aIdx) => {
                const s = snap[`${mIdx}-${pIdx}-${aIdx}`];
                if (s) Object.assign(act, s);
              });
            });
          });
          pendingSnapshotRef.current = {};
          await api.goals.patch(childId, { plan });
        }
        setGoalPlan(plan);
      }
    } catch (err) {
      console.error('[useGoalPlan] Failed to re-fetch goals after job completion:', err);
      toast.error('Plan is ready — refresh the page to see it.');
    } finally {
      setIsApplying(false);
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_goals_plan',
    onCompleted: refetchAndApplyGoals,
  });

  const generateGoals = useCallback(
    async (
      child: Record<string, unknown> | null,
      parentConcern: string,
      completedAreas: Activity[] | null,
      completedSnapshot: Record<string, Record<string, unknown>> = {},
    ) => {
      const cId = child?.id as string | undefined;
      if (!cId) return;
      try {
        let ob: Record<string, unknown> | null = child;
        let areas: Activity[] | null = completedAreas;
        if (!areas) {
          const [freshChild, freshCompleted] = await Promise.all([
            api.entities.Child.get(cId),
            api.completedGrowthAreas.list(cId),
          ]);
          ob = freshChild;
          // Use only finalised areas for goal generation; legacy docs without status are treated as completed.
          const allAreas = Array.isArray(freshCompleted.areas)
            ? (freshCompleted.areas as Activity[])
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

        pendingSnapshotRef.current = completedSnapshot;

        await job.enqueue({
          type: 'generate_goals_plan',
          child_id: cId,
          payload: {
            prompt: buildGoalsMonthlyPlanPrompt({
              childName: obRecord?.name as string | undefined,
              childAge: obRecord?.age as number | undefined,
              childGender: obRecord?.gender as string | undefined,
              parentConcern,
              personalityType: profile?.personality_type,
              areasContext,
            }),
            response_json_schema: goalsMonthlyPlanSchema(),
          },
          write_back: { collection: 'goals', filter: {}, field: 'goals_plan' },
        });
      } catch (err) {
        console.error('[useGoalPlan] Failed to enqueue plan generation:', err);
        toast.error('Failed to generate plan. Please try again.');
      }
    },
    // job.enqueue is stable (useCallback with [] deps inside useJob)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job.enqueue],
  );

  useEffect(() => {
    if (!childId) {
      setIsInitializing(false);
      return;
    }
    const init = async () => {
      try {
        const child = await api.entities.Child.get(childId);
        const childRecord = child as Record<string, unknown>;
        setChildData(childRecord);

        if (!childRecord?.id) {
          setIsInitializing(false);
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
          setIsInitializing(false);
          return;
        }

        // No saved plan — only enqueue if there is no active job already polling.
        // If active_jobs already has a generate_goals_plan entry, useJob's sync
        // effect will pick it up from childRecord.active_jobs and start polling.
        const activeJobId = (childRecord.active_jobs as Record<string, string> | undefined)
          ?.generate_goals_plan;
        if (!activeJobId) {
          await generateGoals(childRecord, savedConcern, areas);
        }
        setIsInitializing(false);
      } catch (err) {
        console.error('[useGoalPlan] Init failed:', err);
        setIsInitializing(false);
      }
    };
    void init();
    // generateGoals is intentionally excluded — it depends on job.enqueue which is
    // stable, but including it here would cause an infinite loop because generateGoals
    // itself triggers a state update (via job.enqueue → setJobId) that re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

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
      const { flatIndexMap } = buildGoalPlanIndex(updatedPlan);
      const resetFlatIdx = flatIndexMap.get(`${monthIdx}-${periodIdx}-${actIdx}`) ?? 0;

      flatIndexMap.forEach((flatIdx, key) => {
        if (flatIdx >= resetFlatIdx) {
          const parts = key.split('-').map(Number);
          const m = parts[0] ?? 0;
          const p = parts[1] ?? 0;
          const a = parts[2] ?? 0;
          const act = updatedPlan.months[m]?.periods?.[p]?.activities?.[a];
          if (act) {
            act.completed = undefined;
            act.score = undefined;
            act.note = undefined;
            act.progress_observation = undefined;
            act.ai_feedback = undefined;
            act.parent_feedback = undefined;
            act.what_changed = undefined;
            act.what_learned = undefined;
            act.recommendation = undefined;
            act.answers_text = undefined;
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
    isLoading: isInitializing || job.isLoading || isApplying,
    isFailed: job.isFailed,
    jobError: job.error,
    elapsedMs: job.elapsedMs,
    saveActivityCompletion,
    handleActivityReset,
    handleRegenerate,
  };
}
