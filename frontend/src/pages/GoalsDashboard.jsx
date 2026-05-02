import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from '@/utils';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Target, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';

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

  const generateGoals = async (child, parentConcern, onboarding, completedAreas) => {
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

Generate a structured 3-month plan. Each month has a theme/goal and is split into 2 bi-weekly periods (Week 1&2 and Week 3&4). Each period has 2 specific activities with clear objectives. Make sure the concern "${parentConcern}" is prominently addressed throughout.

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
            { "title": "Activity title", "objective": "What child will achieve" },
            { "title": "Activity title", "objective": "What child will achieve" }
          ]
        },
        {
          "label": "Week 3 & 4",
          "activities": [
            { "title": "Activity title", "objective": "What child will achieve" },
            { "title": "Activity title", "objective": "What child will achieve" }
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
                              objective: { type: "string" }
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

      await api.goals.patch({ plan: result });
      setGoalPlan(result);
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate plan. Please try again.');
    }
    setIsLoading(false);
  };

  const toggleMonth = (idx) => {
    setExpandedMonths(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const monthColors = [
    { bg: 'from-teal-500 to-emerald-500', light: 'bg-teal-50 border-teal-200', text: 'text-teal-700', dot: 'bg-teal-500' },
    { bg: 'from-blue-500 to-cyan-500', light: 'bg-blue-50 border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500' },
    { bg: 'from-purple-500 to-indigo-500', light: 'bg-purple-50 border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500' },
  ];

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
                            {period.activities?.map((act, aIdx) => (
                              <div key={aIdx} className="flex items-start gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <div className={`w-6 h-6 rounded-full ${color.dot} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                  <span className="text-white text-xs font-bold">{aIdx + 1}</span>
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-800">{act.title}</p>
                                  <p className="text-sm text-slate-500 mt-0.5">{act.objective}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}

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
                      const existingChildren = await api.entities.Child.list('-created_date');
                      await Promise.all(existingChildren.map((c) => api.entities.Child.delete(c.id)));
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
                    try {
                      await api.goals.patch({ clear_plan: true });
                    } catch {
                      /* proceed even if clearing fails */
                    }
                    await generateGoals(childData, concern, savedOnboarding, savedCompletedAreas);
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
    </div>
  );
}
