import {
  useState,
  useMemo,
  useCallback,
  createContext,
  useContext,
  lazy,
  Suspense,
  Component,
} from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { cn } from '@/lib/utils';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Target, ChevronDown, RefreshCw, CheckCircle2, RotateCcw, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGoalPlan, buildGoalPlanIndex } from '@/hooks/useGoalPlan';
import type { Dispatch, SetStateAction } from 'react';
import { SPINNER, slideUp } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';
import StartOverButton from '@/components/shared/StartOverButton';

interface DashActivity {
  completed?: boolean;
  score?: unknown;
  note?: unknown;
  scorable?: unknown;
  ai_feedback?: unknown;
  what_changed?: string | null;
  what_learned?: string | null;
  recommendation?: string | null;
  parent_feedback?: unknown;
  title?: string;
  objective?: string;
  [key: string]: unknown;
}

interface ActiveActivity {
  activity: DashActivity;
  monthIdx: number;
  periodIdx: number;
  actIdx: number;
  originalActivity: DashActivity | null;
  monthGoal: string;
  monthObjective: string;
}

// Animation timing constants
const ANIM_MONTH_BASE = 0.6;
const ANIM_MONTH_STEP = 0.3;
const ANIM_DURATION = 1.0;
const ANIM_ACCORDION = 0.55;

const ActivityModal = lazy(() => import('@/components/goals/ActivityModal'));
const ProgressInsightsModal = lazy(() => import('@/components/goals/ProgressInsightsModal'));

// Catches render errors inside modals so a crash doesn't take down the whole dashboard.
interface ModalErrorBoundaryState {
  hasError: boolean;
}
interface ModalErrorBoundaryProps {
  children: ReactNode;
}
class ModalErrorBoundary extends Component<ModalErrorBoundaryProps, ModalErrorBoundaryState> {
  constructor(props: ModalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): ModalErrorBoundaryState {
    return { hasError: true };
  }
  componentDidCatch(err: unknown, info: ErrorInfo) {
    console.error('[ModalErrorBoundary]', err, info.componentStack);
    toast.error('Modal failed to load. Please try again.');
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// Context shared between GoalsDashboard and MonthCard — avoids 4 extra props on every card.
interface GoalPlanContextValue {
  flatIndexMap: Map<string, number>;
  firstActiveFlat: number;
  onStartActivity: Dispatch<SetStateAction<ActiveActivity | null>>;
  onResetActivity: (monthIdx: number, periodIdx: number, actIdx: number) => Promise<void>;
}
const GoalPlanContext = createContext<GoalPlanContextValue | null>(null);

function ActivityCardIcon({
  completed,
  isLocked,
  colorDot,
  index,
}: {
  completed?: boolean;
  isLocked: boolean;
  colorDot: string;
  index: number;
}) {
  if (completed) return <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />;
  if (isLocked)
    return (
      <div className="bg-ghost-strong mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
        <Lock className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  return (
    <div
      className={`h-5 w-5 rounded-full ${colorDot} mt-0.5 flex flex-shrink-0 items-center justify-center`}
    >
      <span className="text-[10px] font-bold text-white">{index + 1}</span>
    </div>
  );
}

function getActivityCardClasses(completed: boolean | undefined, isLocked: boolean) {
  if (completed) return 'bg-success/[0.07] border-success/20';
  if (isLocked) return 'bg-ghost border-edge-xs border-dashed';
  return 'bg-surface-elevated border-c-edge';
}

interface MonthColor {
  bg: string;
  light: string;
  text: string;
  dot: string;
}
interface MonthData {
  month?: number;
  goal?: string;
  objective?: string;
  periods?: { label?: string; activities?: DashActivity[] }[];
}
function MonthCard({
  month,
  idx,
  color,
  isOpen,
  onToggle,
}: {
  month: MonthData;
  idx: number;
  color: MonthColor;
  isOpen?: boolean;
  onToggle: () => void;
}) {
  const ctx = useContext(GoalPlanContext);
  if (!ctx) return null;
  const { flatIndexMap, firstActiveFlat, onStartActivity, onResetActivity } = ctx;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: ANIM_DURATION,
        delay: ANIM_MONTH_BASE + idx * ANIM_MONTH_STEP,
        ease: 'easeOut',
      }}
      className="border-edge rounded-2xl bg-card"
    >
      <button onClick={onToggle} className="w-full text-left">
        <div
          className={`bg-gradient-to-r ${color.bg} flex items-center justify-between rounded-t-2xl px-6 py-4`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <span className="font-bold text-white">{month.month}</span>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-white/70">
                Month {month.month}
              </p>
              <h3 className="font-bold text-white">{month.goal}</h3>
            </div>
          </div>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: ANIM_ACCORDION, ease: 'easeInOut' }}
          >
            <ChevronDown className="h-5 w-5 text-white/70" />
          </motion.div>
        </div>
        {month.objective && (
          <div className={`px-6 py-2.5 ${color.light} border-b-edge-faint`}>
            <p className={`text-sm font-medium ${color.text}`}>
              <span aria-hidden="true">🎯</span> {month.objective}
            </p>
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
            <div className="space-y-5 px-5 py-5">
              {month.periods?.map((period, pIdx) => (
                <div key={`${idx}-${pIdx}`}>
                  <p className={`mb-3 text-xs font-bold uppercase tracking-widest ${color.text}`}>
                    {period.label}
                  </p>
                  <div className="space-y-2.5">
                    {period.activities?.map((act, aIdx) => {
                      const flatIdx = flatIndexMap.get(`${idx}-${pIdx}-${aIdx}`) ?? Infinity;
                      const isActive = flatIdx === firstActiveFlat;
                      const isLocked = flatIdx > firstActiveFlat;
                      return (
                        <div
                          key={`${idx}-${pIdx}-${aIdx}`}
                          className={cn(
                            'relative flex items-start gap-3 rounded-xl border p-4 transition-all',
                            getActivityCardClasses(act.completed, isLocked),
                          )}
                        >
                          <ActivityCardIcon
                            completed={act.completed}
                            isLocked={isLocked}
                            colorDot={color.dot}
                            index={aIdx}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold ${isLocked ? 'text-muted-foreground' : 'text-foreground'}`}
                            >
                              {act.title}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{act.objective}</p>
                            {act.completed ? (
                              <div className="mt-2 space-y-1.5">
                                {/* Score / Note */}
                                {act.scorable !== false ? (
                                  <p className="text-xs font-bold text-foreground">
                                    Score:{' '}
                                    {String(
                                      (act.score as string | number | boolean | null | undefined) ??
                                        '',
                                    )}
                                    /10
                                  </p>
                                ) : (
                                  <p className="text-xs font-bold text-foreground">
                                    Note:{' '}
                                    {String(
                                      (act.note as string | number | boolean | null | undefined) ??
                                        '',
                                    )}
                                  </p>
                                )}
                                {/* What changed */}
                                {!!act.what_changed && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-semibold text-foreground">
                                      What changed:{' '}
                                    </span>
                                    {String(act.what_changed)}
                                  </p>
                                )}
                                {/* What learned */}
                                {!!act.what_learned && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-semibold text-foreground">Learnt: </span>
                                    {String(act.what_learned)}
                                  </p>
                                )}
                                {/* Recommendation */}
                                {!!act.recommendation && (
                                  <p className="text-xs text-primary">
                                    <span className="font-semibold">Next: </span>
                                    {String(act.recommendation)}
                                  </p>
                                )}
                                {/* Parent feedback */}
                                {!!act.parent_feedback && (
                                  <p className="text-xs italic text-muted-foreground">
                                    Parent:{' '}
                                    {typeof act.parent_feedback === 'string'
                                      ? act.parent_feedback
                                      : typeof act.parent_feedback === 'number' ||
                                          typeof act.parent_feedback === 'boolean'
                                        ? String(act.parent_feedback)
                                        : ''}
                                  </p>
                                )}
                              </div>
                            ) : isActive ? (
                              <button
                                onClick={() => {
                                  const originalAct =
                                    pIdx > 0
                                      ? (month.periods?.[0]?.activities?.[aIdx] ?? null)
                                      : null;
                                  onStartActivity({
                                    activity: act,
                                    monthIdx: idx,
                                    periodIdx: pIdx,
                                    actIdx: aIdx,
                                    originalActivity: originalAct,
                                    monthGoal: String(month.goal ?? ''),
                                    monthObjective: String(month.objective ?? ''),
                                  });
                                }}
                                className={`mt-1.5 text-xs font-medium ${color.text} hover:underline`}
                              >
                                Tap to start activity →
                              </button>
                            ) : null}
                          </div>
                          {act.completed && (
                            <button
                              onClick={() => {
                                void onResetActivity(idx, pIdx, aIdx);
                              }}
                              aria-label="Reset activity"
                              className="bg-ghost-light border-edge hover:bg-ghost-strong absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                            >
                              <RotateCcw className="h-3 w-3 text-muted-foreground" />
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

const monthColors = [
  {
    bg: 'from-teal-600 to-teal-500',
    light: 'bg-primary/10 border-primary/25',
    text: 'text-primary',
    dot: 'bg-primary',
  },
  {
    bg: 'from-blue-600 to-blue-500',
    light: 'bg-blue-500/10 border-blue-500/25',
    text: 'text-blue-400',
    dot: 'bg-blue-500',
  },
  {
    bg: 'from-purple-600 to-purple-500',
    light: 'bg-purple-500/10 border-purple-500/25',
    text: 'text-purple-400',
    dot: 'bg-purple-500',
  },
];

export default function GoalsDashboard() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const [showSplash, startTimer] = useStageSplash();
  const {
    childData,
    concern,
    goalPlan,
    setGoalPlan,
    isLoading,
    saveActivityCompletion,
    handleActivityReset,
    handleRegenerate,
  } = useGoalPlan(childId);

  const [expandedMonths, setExpandedMonths] = useState<Record<number, boolean>>({
    0: true,
    1: false,
    2: false,
  });
  const [activeActivity, setActiveActivity] = useState<ActiveActivity | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  // Wraps saveActivityCompletion: resolves active UI state then delegates to the hook.
  const handleActivityComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!activeActivity) return;
      const { monthIdx, periodIdx, actIdx } = activeActivity;
      await saveActivityCompletion(monthIdx, periodIdx, actIdx, result);
      setActiveActivity(null);
    },
    [activeActivity, saveActivityCompletion],
  );

  const toggleMonth = useCallback((idx: number) => {
    setExpandedMonths((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const { flatIndexMap, firstActiveFlat } = useMemo(() => buildGoalPlanIndex(goalPlan), [goalPlan]);

  const contextValue = useMemo(
    () => ({
      flatIndexMap,
      firstActiveFlat,
      onStartActivity: setActiveActivity,
      onResetActivity: handleActivityReset,
    }),
    [flatIndexMap, firstActiveFlat, handleActivityReset],
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        <div key={showSplash ? 'splash' : 'content'} className="min-h-screen bg-background">
          <div className="mx-auto max-w-4xl px-4 py-10">
            <motion.div {...slideUp(0.1)} className="mb-8 text-center">
              <div className="glow-teal-sm mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600">
                <Target className="h-7 w-7 text-white" />
              </div>
              <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
                3-Month Growth Plan for{' '}
                {(childData?.['name'] as string | undefined) ?? 'Your Child'}
              </h1>
              <p className="text-muted-foreground">Personalized goals powered by Buddy360</p>

              {concern && (
                <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-amber-500/25 bg-amber-500/10 px-5 py-3 text-sm text-amber-400">
                  <span className="font-semibold">Focus area: </span>
                  {concern}
                </div>
              )}
            </motion.div>

            {isLoading ? (
              <div
                className="flex flex-col items-center justify-center space-y-4 py-24"
                aria-live="polite"
                aria-busy="true"
              >
                <motion.div
                  {...SPINNER}
                  className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
                  aria-hidden="true"
                />
                <p className="text-muted-foreground">Building your 3-month plan...</p>
              </div>
            ) : (
              <GoalPlanContext.Provider value={contextValue}>
                <div className="space-y-4">
                  {goalPlan?.months?.map((month, idx) => (
                    <MonthCard
                      key={(month as MonthData)['month'] ?? idx}
                      month={month}
                      idx={idx}
                      color={monthColors[idx] ?? monthColors[0]!}
                      isOpen={!!expandedMonths[idx]}
                      onToggle={() => toggleMonth(idx)}
                    />
                  ))}

                  <div className="flex justify-center pt-2">
                    <Button
                      onClick={() => setShowProgress(true)}
                      className="btn-primary h-11 rounded-2xl px-8 text-base transition-all"
                    >
                      View Progress And Insights
                    </Button>
                  </div>

                  <PageActions
                    className="pt-4"
                    left={
                      <Button
                        variant="outline"
                        onClick={() =>
                          navigate(`/LifePathway/${childId}`, { state: { fromBack: true } })
                        }
                        className="btn-secondary h-11 w-full rounded-2xl px-6 text-base sm:w-auto"
                      >
                        ← Back
                      </Button>
                    }
                    center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
                    right={
                      <Button
                        variant="outline"
                        onClick={() => {
                          void handleRegenerate();
                        }}
                        className="btn-secondary h-11 w-full rounded-2xl px-6 text-base sm:w-auto"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
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
                    activity={activeActivity.activity as { title: string; [key: string]: unknown }}
                    originalActivity={
                      (activeActivity.originalActivity as
                        | { title?: string; [key: string]: unknown }
                        | undefined) ?? undefined
                    }
                    childName={childData?.['name'] as string | undefined}
                    childAge={childData?.['age'] as number | string | undefined}
                    childGender={childData?.['gender'] as string | undefined}
                    goal={activeActivity.monthGoal || concern || undefined}
                    impact={activeActivity.monthObjective || undefined}
                    onClose={() => setActiveActivity(null)}
                    onComplete={handleActivityComplete}
                  />
                )}
                {showProgress && goalPlan && (
                  <ProgressInsightsModal
                    goalPlan={goalPlan}
                    childId={childData?.['id'] as string | undefined}
                    childName={childData?.['name'] as string | undefined}
                    childAge={childData?.['age'] as string | number | undefined}
                    childGender={childData?.['gender'] as string | undefined}
                    onPlanUpdate={(plan) => setGoalPlan(plan)}
                    onClose={() => setShowProgress(false)}
                  />
                )}
              </AnimatePresence>
            </Suspense>
          </ModalErrorBoundary>
        </div>
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={7} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
