import { useState, useMemo, useCallback, createContext, useContext, lazy, Suspense, Component } from 'react';
import PropTypes from 'prop-types';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Target, ChevronDown, RefreshCw, CheckCircle2, RotateCcw, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGoalPlan, buildGoalPlanIndex } from '@/hooks/useGoalPlan';
import { SPINNER, slideUp } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';

// Animation timing constants
const ANIM_MONTH_BASE  = 0.6;
const ANIM_MONTH_STEP  = 0.3;
const ANIM_DURATION    = 1.0;
const ANIM_ACCORDION   = 0.55;

const ActivityModal = lazy(() => import('@/components/goals/ActivityModal'));
const ProgressInsightsModal = lazy(() => import('@/components/goals/ProgressInsightsModal'));

// Catches render errors inside modals so a crash doesn't take down the whole dashboard.
class ModalErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err) {
    console.error('[ModalErrorBoundary]', err);
    toast.error('Modal failed to load. Please try again.');
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// Context shared between GoalsDashboard and MonthCard — avoids 4 extra props on every card.
const GoalPlanContext = createContext(null);

function ActivityCardIcon({ completed, isLocked, colorDot, index }) {
  if (completed) return <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />;
  if (isLocked) return (
    <div className="w-5 h-5 rounded-full bg-ghost-strong flex items-center justify-center flex-shrink-0 mt-0.5">
      <Lock className="w-3 h-3 text-slate-600" />
    </div>
  );
  return (
    <div className={`w-5 h-5 rounded-full ${colorDot} flex items-center justify-center flex-shrink-0 mt-0.5`}>
      <span className="text-white text-[10px] font-bold">{index + 1}</span>
    </div>
  );
}

function getActivityCardClasses(completed, isLocked) {
  if (completed) return 'bg-emerald-500/[0.07] border-emerald-500/20';
  if (isLocked) return 'bg-ghost border-edge-xs border-dashed';
  return 'bg-surface-elevated border-c-edge';
}

function MonthCard({ month, idx, color, isOpen, onToggle }) {
  const { flatIndexMap, firstActiveFlat, onStartActivity, onResetActivity } = useContext(GoalPlanContext);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: ANIM_DURATION, delay: ANIM_MONTH_BASE + idx * ANIM_MONTH_STEP, ease: 'easeOut' }}
      className="bg-card rounded-2xl border-edge"
    >
      <button onClick={onToggle} className="w-full text-left">
        <div className={`bg-gradient-to-r ${color.bg} px-6 py-4 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <span className="text-white font-bold">{month.month}</span>
            </div>
            <div>
              <p className="text-white/70 text-xs font-medium uppercase tracking-widest">Month {month.month}</p>
              <h3 className="text-white font-bold">{month.goal}</h3>
            </div>
          </div>
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: ANIM_ACCORDION, ease: 'easeInOut' }}>
            <ChevronDown className="w-5 h-5 text-white/70" />
          </motion.div>
        </div>
        {month.objective && (
          <div className={`px-6 py-2.5 ${color.light} border-b-edge-faint`}>
            <p className={`text-sm font-medium ${color.text}`}><span aria-hidden="true">🎯</span> {month.objective}</p>
          </div>
        )}
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="periods"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: ANIM_ACCORDION, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 py-5 space-y-5">
              {month.periods?.map((period, pIdx) => (
                <div key={`${idx}-${pIdx}`}>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${color.text}`}>{period.label}</p>
                  <div className="space-y-2.5">
                    {period.activities?.map((act, aIdx) => {
                      const flatIdx = flatIndexMap.get(`${idx}-${pIdx}-${aIdx}`);
                      const isActive = flatIdx === firstActiveFlat;
                      const isLocked = flatIdx > firstActiveFlat;
                      return (
                        <div
                          key={`${idx}-${pIdx}-${aIdx}`}
                          className={cn(
                            'relative flex items-start gap-3 p-4 rounded-xl border transition-all',
                            getActivityCardClasses(act.completed, isLocked),
                          )}
                        >
                          <ActivityCardIcon completed={act.completed} isLocked={isLocked} colorDot={color.dot} index={aIdx} />
                          <div className="flex-1 min-w-0">
                            <p className={`font-semibold text-sm ${isLocked ? 'text-slate-600' : 'text-white'}`}>{act.title}</p>
                            <p className={`text-xs mt-0.5 ${isLocked ? 'text-slate-700' : 'text-slate-500'}`}>{act.objective}</p>
                            {act.completed ? (
                              <div className="mt-2 space-y-1">
                                <p className="text-xs font-semibold text-emerald-400">
                                  <span aria-hidden="true">✅</span> {act.ai_feedback}
                                </p>
                                {act.scorable !== false ? (
                                  <p className="text-xs font-bold text-slate-300">Score: {act.score}/10</p>
                                ) : (
                                  <p className="text-xs font-bold text-slate-300">Note: {act.note}</p>
                                )}
                                {act.parent_feedback && (
                                  <p className="text-xs italic text-slate-500">Parent: {act.parent_feedback}</p>
                                )}
                              </div>
                            ) : isActive ? (
                              <button
                                onClick={() => {
                                  const originalAct = pIdx > 0 ? month.periods[0]?.activities?.[aIdx] : null;
                                  onStartActivity({ activity: act, monthIdx: idx, periodIdx: pIdx, actIdx: aIdx, originalActivity: originalAct });
                                }}
                                className={`mt-1.5 text-xs font-medium ${color.text} hover:underline`}
                              >
                                Tap to start activity →
                              </button>
                            ) : null}
                          </div>
                          {act.completed && (
                            <button
                              onClick={() => onResetActivity(idx, pIdx, aIdx)}
                              aria-label="Reset activity"
                              className="absolute top-3 right-3 w-6 h-6 rounded-full bg-ghost-light border-edge flex items-center justify-center hover:bg-ghost-strong transition-colors"
                            >
                              <RotateCcw className="w-3 h-3 text-slate-500" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

MonthCard.propTypes = {
  month: PropTypes.shape({
    month: PropTypes.number,
    goal: PropTypes.string,
    objective: PropTypes.string,
    periods: PropTypes.array,
  }).isRequired,
  idx: PropTypes.number.isRequired,
  color: PropTypes.shape({
    bg: PropTypes.string,
    light: PropTypes.string,
    text: PropTypes.string,
    dot: PropTypes.string,
  }).isRequired,
  isOpen: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
};

const monthColors = [
  { bg: 'from-teal-600 to-teal-500', light: 'bg-teal-500/10 border-teal-500/25', text: 'text-teal-400', dot: 'bg-teal-500' },
  { bg: 'from-blue-600 to-blue-500', light: 'bg-blue-500/10 border-blue-500/25', text: 'text-blue-400', dot: 'bg-blue-500' },
  { bg: 'from-purple-600 to-purple-500', light: 'bg-purple-500/10 border-purple-500/25', text: 'text-purple-400', dot: 'bg-purple-500' },
];

export default function GoalsDashboard() {
  const navigate = useNavigate();
  const {
    childData,
    concern,
    goalPlan,
    setGoalPlan,
    isLoading,
    saveActivityCompletion,
    handleActivityReset,
    handleStartOver,
    handleRegenerate,
  } = useGoalPlan();

  const [expandedMonths, setExpandedMonths] = useState({ 0: true, 1: false, 2: false });
  const [activeActivity, setActiveActivity] = useState(null);
  const [showProgress, setShowProgress] = useState(false);

  // Wraps saveActivityCompletion: resolves active UI state then delegates to the hook.
  const handleActivityComplete = useCallback(async (result) => {
    if (!activeActivity) return;
    const { monthIdx, periodIdx, actIdx } = activeActivity;
    await saveActivityCompletion(monthIdx, periodIdx, actIdx, result);
    setActiveActivity(null);
  }, [activeActivity, saveActivityCompletion]);

  const toggleMonth = useCallback((idx) => {
    setExpandedMonths(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const { flatIndexMap, firstActiveFlat } = useMemo(() => buildGoalPlanIndex(goalPlan), [goalPlan]);

  const contextValue = useMemo(() => ({
    flatIndexMap,
    firstActiveFlat,
    onStartActivity: setActiveActivity,
    onResetActivity: handleActivityReset,
  }), [flatIndexMap, firstActiveFlat, handleActivityReset]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <motion.div {...slideUp(0.1)} className="mb-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal-sm">
            <Target className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
            3-Month Growth Plan for {childData?.name || 'Your Child'}
          </h1>
          <p className="text-slate-400">Personalized goals powered by Buddy360</p>

          {concern && (
            <div className="mt-4 max-w-xl mx-auto bg-amber-500/10 border border-amber-500/25 rounded-2xl px-5 py-3 text-sm text-amber-400">
              <span className="font-semibold">Focus area: </span>{concern}
            </div>
          )}
        </motion.div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4" aria-live="polite" aria-busy="true">
            <motion.div
              {...SPINNER}
              className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full"
              aria-hidden="true"
            />
            <p className="text-slate-500">Building your 3-month plan...</p>
          </div>
        ) : (
          <GoalPlanContext.Provider value={contextValue}>
            <div className="space-y-4">
              {goalPlan?.months?.map((month, idx) => (
                <MonthCard
                  key={month.month}
                  month={month}
                  idx={idx}
                  color={monthColors[idx] || monthColors[0]}
                  isOpen={!!expandedMonths[idx]}
                  onToggle={() => toggleMonth(idx)}
                />
              ))}

              <div className="flex justify-center pt-2">
                <Button
                  onClick={() => setShowProgress(true)}
                  className="h-11 px-8 rounded-2xl btn-primary transition-all"
                >
                  View Progress And Insights
                </Button>
              </div>

              <PageActions
                className="pt-4"
                left={
                  <Button variant="outline" onClick={() => navigate(-1)} className="h-11 w-full sm:w-auto px-6 rounded-2xl btn-secondary">
                    ← Back
                  </Button>
                }
                center={
                  <Button variant="outline" onClick={handleStartOver} className="h-11 w-full sm:w-auto px-6 rounded-2xl btn-start-over">
                    <span aria-hidden="true">🔄</span> Start Over
                  </Button>
                }
                right={
                  <Button variant="outline" onClick={handleRegenerate} className="h-11 w-full sm:w-auto px-6 rounded-2xl btn-secondary">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerate Plan
                  </Button>
                }
              />
            </div>
          </GoalPlanContext.Provider>
        )}
      </div>

      <ModalErrorBoundary>
        <Suspense fallback={null}>
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
                childId={childData?.id}
                childName={childData?.name}
                onPlanUpdate={setGoalPlan}
                onClose={() => setShowProgress(false)}
              />
            )}
          </AnimatePresence>
        </Suspense>
      </ModalErrorBoundary>
    </div>
  );
}
