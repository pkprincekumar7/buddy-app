import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from '@/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Target, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, RotateCcw, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import ActivityModal from '@/components/goals/ActivityModal';
import ProgressInsightsModal from '@/components/goals/ProgressInsightsModal';

export default function GoalsDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [childData, setChildData] = useState(null);
  const [concern, setConcern] = useState('');
  const [goalPlan, setGoalPlan] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState({ 0: true, 1: false, 2: false });
  const [savedOnboarding, setSavedOnboarding] = useState(null);
  const [savedCompletedAreas, setSavedCompletedAreas] = useState([]);
  const [activeActivity, setActiveActivity] = useState(null); // { activity, monthIdx, periodIdx, actIdx }
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const [onboarding, goals, completedData, children] = await Promise.all([
          api.onboarding.get(),
          api.goals.get(),
          api.completedGrowthAreas.list(),
          api.entities.Child.list('-created_date', 1),
        ]);

        const child = children?.[0] || onboarding?.child_data || null;
        setChildData(child);

        const areas = completedData?.areas || [];
        setSavedOnboarding(onboarding);
        setSavedCompletedAreas(areas);

        const savedConcern = typeof goals.parent_concern === 'string' ? goals.parent_concern : '';
        setConcern(savedConcern);

        if (goals.plan) {
          setGoalPlan(goals.plan);
          setIsLoading(false);
          return;
        }

        await generateGoals(child, savedConcern, onboarding, areas);
      } catch (e) {
        console.error(e);
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const generateGoals = async (child, parentConcern, onboarding, completedAreas, completedSnapshot = {}) => {
    setIsLoading(true);
    try {
      let ob = onboarding;
      let areas = completedAreas;
      if (!ob || !areas) {
        const [freshOnboarding, freshCompleted] = await Promise.all([
          api.onboarding.get(),
          api.completedGrowthAreas.list(),
        ]);
        ob = freshOnboarding;
        areas = freshCompleted?.areas || [];
      }

      const vm = ob?.personality?.view_model;
      const profile = vm?.type && vm?.profile ? onboardingProfileFromViewModel(vm) : null;
      const areasContext = areas.map(a => `${a.area_name}: ${(a.recommendations || []).join('; ')}`).join('\n');
      const concernContext = parentConcern ? `Parent's primary concern: "${parentConcern}"` : '';

      const prompt = `Create a focused 3-month goal plan for ${child?.name || 'the child'}, age ${child?.age || 'unknown'}.

${concernContext}
Personality: ${profile?.personality_type || 'Unknown'}
Growth areas explored: ${areasContext || 'General holistic development'}

Generate a structured 3-month plan. Each month has a theme/goal and is split into 2 bi-weekly periods (Week 1&2 and Week 3&4). Each period has exactly 2 activities with clear objectives.

STRICT follow-up rule — you MUST follow this for every month without exception:
- Period 1 (Week 1 & 2): introduce Activity A and Activity B.
- Period 2 (Week 3 & 4): Activity 1 MUST be a direct progression of Activity A (same skill, one level deeper). Activity 2 MUST be a direct progression of Activity B (same skill, one level deeper).
- NEVER place a new unrelated activity in Week 3 & 4. Both slots must follow up on Week 1 & 2.

SCORABLE vs NON-SCORABLE activities:
- Each activity MUST include a "scorable" field (true or false).
- Across the full 3-month plan, include a MIX — some activities scorable: true, some scorable: false. Do not make all activities the same type.
- The "scorable" value of a follow-up (Week 3&4) MUST exactly match its Week 1&2 counterpart:
  - If Week 1&2 Activity A is scorable: true → Week 3&4 Activity 1 must be scorable: true.
  - If Week 1&2 Activity B is scorable: false → Week 3&4 Activity 2 must be scorable: false.
- Use scorable: true for structured skill-building activities where measurable progress is clear (e.g. speaking, reading, problem-solving).
- Use scorable: false for open-ended, creative, emotional, or reflective activities where a numeric score is not meaningful (e.g. journaling feelings, imaginative play, self-expression).

Example of correct follow-up pairing (with scorable):
  Week 1&2 Activity 1: { "title": "Picture Description Warm-Up", "objective": "child describes a single image using 1–2 sentences", "scorable": true }
  Week 3&4 Activity 1: { "title": "Picture Story Extension", "objective": "child describes the same image using 3–4 sentences and answers follow-up questions", "scorable": true }

  Week 1&2 Activity 2: { "title": "Feelings Journaling", "objective": "child identifies and names 2 emotions they felt this week", "scorable": false }
  Week 3&4 Activity 2: { "title": "Feelings Discussion", "objective": "child describes their emotions and shares why they felt that way", "scorable": false }

Make sure the concern "${parentConcern}" is prominently addressed throughout.

Return JSON with this exact structure:
{
  "months": [
    {
      "month": 1,
      "goal": "Monthly goal title",
      "objective": "One sentence objective",
      "periods": [
        {
          "label": "Week 1 & 2",
          "activities": [
            { "title": "Activity title", "objective": "What child will achieve", "scorable": true },
            { "title": "Activity title", "objective": "What child will achieve", "scorable": false }
          ]
        },
        {
          "label": "Week 3 & 4",
          "activities": [
            { "title": "Activity title", "objective": "What child will achieve", "scorable": true },
            { "title": "Activity title", "objective": "What child will achieve", "scorable": false }
          ]
        }
      ]
    }
  ]
}`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            months: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  month: { type: "number" },
                  goal: { type: "string" },
                  objective: { type: "string" },
                  periods: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        activities: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              title: { type: "string" },
                              objective: { type: "string" },
                              scorable: { type: "boolean" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      const plan = result;

      // Restore completed activities at their original positions so progress is preserved.
      if (Object.keys(completedSnapshot).length > 0) {
        plan.months?.forEach((month, mIdx) => {
          month.periods?.forEach((period, pIdx) => {
            period.activities?.forEach((act, aIdx) => {
              const snap = completedSnapshot[`${mIdx}-${pIdx}-${aIdx}`];
              if (snap) {
                act.title = snap.title;
                act.objective = snap.objective;
                act.scorable = snap.scorable;
                act.completed = snap.completed;
                act.score = snap.score;
                act.note = snap.note;
                act.progress_observation = snap.progress_observation;
                act.ai_feedback = snap.ai_feedback;
                act.parent_feedback = snap.parent_feedback;
              }
            });
          });
        });
      }

      await api.goals.patch({ plan: plan });
      setGoalPlan(plan);
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate plan. Please try again.');
    }
    setIsLoading(false);
  };

  const handleActivityComplete = async ({ score, note, progress_observation, ai_feedback, parent_feedback }) => {
    if (!activeActivity) return;
    const { monthIdx, periodIdx, actIdx } = activeActivity;

    const updatedPlan = JSON.parse(JSON.stringify(goalPlan));
    const act = updatedPlan.months[monthIdx].periods[periodIdx].activities[actIdx];
    act.completed = true;
    act.score = score;
    act.note = note;
    act.progress_observation = progress_observation;
    act.ai_feedback = ai_feedback;
    act.parent_feedback = parent_feedback;

    try {
      await api.goals.patch({ plan: updatedPlan });
      setGoalPlan(updatedPlan);
    } catch {
      toast.error('Failed to save activity. Please try again.');
    }
    setActiveActivity(null);
  };

  const handleActivityReset = async (monthIdx, periodIdx, actIdx) => {
    const updatedPlan = JSON.parse(JSON.stringify(goalPlan));

    // Find the flat index of the activity being reset.
    let resetFlatIdx = 0;
    let counted = 0;
    outer: for (let m = 0; m < updatedPlan.months.length; m++) {
      for (let p = 0; p < (updatedPlan.months[m].periods?.length || 0); p++) {
        for (let a = 0; a < (updatedPlan.months[m].periods[p].activities?.length || 0); a++) {
          if (m === monthIdx && p === periodIdx && a === actIdx) {
            resetFlatIdx = counted;
            break outer;
          }
          counted++;
        }
      }
    }

    // Clear completion data on the target activity and every activity after it.
    let flatIdx = 0;
    for (let m = 0; m < updatedPlan.months.length; m++) {
      for (let p = 0; p < (updatedPlan.months[m].periods?.length || 0); p++) {
        for (let a = 0; a < (updatedPlan.months[m].periods[p].activities?.length || 0); a++) {
          if (flatIdx >= resetFlatIdx) {
            const act = updatedPlan.months[m].periods[p].activities[a];
            delete act.completed;
            delete act.score;
            delete act.note;
            delete act.progress_observation;
            delete act.ai_feedback;
            delete act.parent_feedback;
          }
          flatIdx++;
        }
      }
    }

    try {
      await api.goals.patch({ plan: updatedPlan });
      setGoalPlan(updatedPlan);
    } catch {
      toast.error('Failed to reset activity.');
    }
  };

  const toggleMonth = (idx) => {
    setExpandedMonths(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const monthColors = [
    { bg: 'from-teal-500 to-emerald-500', light: 'bg-teal-50 border-teal-200', text: 'text-teal-700', dot: 'bg-teal-500' },
    { bg: 'from-blue-500 to-cyan-500', light: 'bg-blue-50 border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500' },
    { bg: 'from-purple-500 to-indigo-500', light: 'bg-purple-50 border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500' },
  ];

  // Precompute flat index for every activity and find the first incomplete one.
  // Order: M1·W1&2·G1 → M1·W1&2·G2 → M1·W3&4·G1 → M1·W3&4·G2 → M2… → M3·W3&4·G2
  const flatIndexMap = new Map(); // key: "mIdx-pIdx-aIdx" → flatIndex
  let firstActiveFlat = 0;
  if (goalPlan?.months) {
    let idx = 0;
    let foundFirst = false;
    for (let m = 0; m < goalPlan.months.length; m++) {
      for (let p = 0; p < (goalPlan.months[m].periods?.length || 0); p++) {
        for (let a = 0; a < (goalPlan.months[m].periods[p].activities?.length || 0); a++) {
          flatIndexMap.set(`${m}-${p}-${a}`, idx);
          if (!foundFirst && !goalPlan.months[m].periods[p].activities[a].completed) {
            firstActiveFlat = idx;
            foundFirst = true;
          }
          idx++;
        }
      }
    }
    if (!foundFirst) firstActiveFlat = idx; // all complete
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
            <Target className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">
            3-Month Growth Plan for {childData?.name || 'Your Child'}
          </h1>
          <p className="text-slate-500">Personalized goals powered by Buddy360</p>

          {concern && (
            <div className="mt-4 max-w-xl mx-auto bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 text-sm text-amber-800">
              <span className="font-semibold">Focus area: </span>{concern}
            </div>
          )}
        </motion.div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="w-14 h-14 border-4 border-teal-500 border-t-transparent rounded-full"
            />
            <p className="text-slate-500 font-medium">Building your 3-month plan...</p>
          </div>
        ) : (
          <div className="space-y-5">
            {goalPlan?.months?.map((month, idx) => {
              const color = monthColors[idx] || monthColors[0];
              const isOpen = expandedMonths[idx];
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden"
                >
                  {/* Month Header */}
                  <button onClick={() => toggleMonth(idx)} className="w-full text-left">
                    <div className={`bg-gradient-to-r ${color.bg} px-6 py-5 flex items-center justify-between`}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                          <span className="text-white font-bold text-xl">{month.month}</span>
                        </div>
                        <div>
                          <p className="text-white/80 text-xs font-medium uppercase tracking-widest">Month {month.month}</p>
                          <h3 className="text-white font-bold text-lg">{month.goal}</h3>
                        </div>
                      </div>
                      {isOpen ? <ChevronUp className="w-5 h-5 text-white/80" /> : <ChevronDown className="w-5 h-5 text-white/80" />}
                    </div>
                    {month.objective && (
                      <div className={`px-6 py-3 ${color.light} border-b-2`}>
                        <p className={`text-sm font-medium ${color.text}`}>🎯 {month.objective}</p>
                      </div>
                    )}
                  </button>

                  {/* Expanded Periods */}
                  {isOpen && (
                    <div className="px-6 py-5 space-y-6">
                      {month.periods?.map((period, pIdx) => (
                        <div key={pIdx}>
                          <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${color.text}`}>{period.label}</p>
                          <div className="space-y-3">
                            {period.activities?.map((act, aIdx) => {
                              const flatIdx = flatIndexMap.get(`${idx}-${pIdx}-${aIdx}`);
                              const isActive = flatIdx === firstActiveFlat;
                              const isLocked = flatIdx > firstActiveFlat;

                              return (
                                <div
                                  key={aIdx}
                                  className={`relative flex items-start gap-3 p-4 rounded-2xl border transition-all ${
                                    act.completed
                                      ? 'bg-green-50 border-green-200'
                                      : isLocked
                                      ? 'bg-slate-50 border-slate-200 border-dashed'
                                      : 'bg-slate-50 border-slate-100'
                                  }`}
                                >
                                  {act.completed ? (
                                    <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                                  ) : isLocked ? (
                                    <div className="w-6 h-6 rounded-full bg-slate-300 flex items-center justify-center flex-shrink-0 mt-0.5">
                                      <Lock className="w-3 h-3 text-slate-500" />
                                    </div>
                                  ) : (
                                    <div className={`w-6 h-6 rounded-full ${color.dot} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                      <span className="text-white text-xs font-bold">{aIdx + 1}</span>
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className={`font-semibold ${isLocked ? 'text-slate-400' : 'text-slate-800'}`}>{act.title}</p>
                                    <p className={`text-sm mt-0.5 ${isLocked ? 'text-slate-400' : 'text-slate-500'}`}>{act.objective}</p>
                                    {act.completed ? (
                                      <div className="mt-2 space-y-1">
                                        <p className="text-sm font-semibold text-green-700">
                                          ✅ {act.ai_feedback}
                                        </p>
                                        {act.scorable !== false ? (
                                          <p className="text-sm font-bold text-slate-700">
                                            Score: {act.score}/10
                                          </p>
                                        ) : (
                                          <p className="text-sm font-bold text-slate-700">
                                            Note: {act.note}
                                          </p>
                                        )}
                                        {act.parent_feedback && (
                                          <p className="text-sm italic text-slate-500">
                                            Parent: {act.parent_feedback}
                                          </p>
                                        )}
                                      </div>
                                    ) : isActive ? (
                                      <button
                                        onClick={() => {
                                          const originalAct = pIdx > 0
                                            ? month.periods[0]?.activities?.[aIdx]
                                            : null;
                                          setActiveActivity({ activity: act, monthIdx: idx, periodIdx: pIdx, actIdx: aIdx, originalActivity: originalAct });
                                        }}
                                        className={`mt-2 text-sm font-medium ${color.text} hover:underline`}
                                      >
                                        Tap to start activity →
                                      </button>
                                    ) : null}
                                  </div>
                                  {act.completed && (
                                    <button
                                      onClick={() => handleActivityReset(idx, pIdx, aIdx)}
                                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
                                      title="Reset activity"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}

            {/* View Progress & Insights */}
            <div className="flex justify-center pt-2">
              <Button
                onClick={() => setShowProgress(true)}
                className="h-11 px-8 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-semibold shadow-md hover:shadow-lg transition-all"
              >
                View Progress And Insights
              </Button>
            </div>

            {/* sm+: left | center | right; mobile: stacked full-width */}
            <div className="grid w-full grid-cols-1 gap-3 pt-4 sm:grid-cols-3 sm:items-center">
              <div className="flex w-full sm:justify-start">
                <Button
                  variant="outline"
                  onClick={() => navigate(-1)}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border-2"
                >
                  ← Back
                </Button>
              </div>
              <div className="flex w-full sm:justify-center">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      if (childData?.id) {
                        try { await api.entities.Child.delete(childData.id); } catch { /* 404 ok */ }
                      }
                      await Promise.all([
                        api.onboarding.patch({
                          phase: 0,
                          clear_child_data: true,
                          clear_personality: true,
                          clear_recommendations: true,
                        }),
                        api.recommendationsProgress.patch({ step: 'intro' }),
                        api.goals.patch({ clear_plan: true, clear_concern: true }),
                        api.completedGrowthAreas.clear(),
                      ]);
                    } catch {
                      /* ignore */
                    }
                    navigate(createPageUrl('Onboarding'));
                  }}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                >
                  🔄 Start Over
                </Button>
              </div>
              <div className="flex w-full sm:justify-end">
                <Button
                  variant="outline"
                  onClick={async () => {
                    // Snapshot completed activities before wiping the plan.
                    const completedSnapshot = {};
                    goalPlan?.months?.forEach((month, mIdx) => {
                      month.periods?.forEach((period, pIdx) => {
                        period.activities?.forEach((act, aIdx) => {
                          if (act.completed) {
                            completedSnapshot[`${mIdx}-${pIdx}-${aIdx}`] = { ...act };
                          }
                        });
                      });
                    });

                    await generateGoals(childData, concern, savedOnboarding, savedCompletedAreas, completedSnapshot);
                  }}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border-2"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Regenerate Plan
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <AnimatePresence>
        {activeActivity && (
          <ActivityModal
            activity={activeActivity.activity}
            originalActivity={activeActivity.originalActivity}
            childName={childData?.name}
            onClose={() => setActiveActivity(null)}
            onComplete={handleActivityComplete}
          />
        )}
        {showProgress && (
          <ProgressInsightsModal
            goalPlan={goalPlan}
            childName={childData?.name}
            onPlanUpdate={setGoalPlan}
            onClose={() => setShowProgress(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
