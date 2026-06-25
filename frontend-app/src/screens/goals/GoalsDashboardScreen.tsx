import {
  useState,
  useMemo,
  useCallback,
  useRef,
  createContext,
  useContext,
  Component,
  useEffect,
} from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useFocusEntranceAnim, useSpinner } from '@/lib/animations';
import type { ReactNode, ErrorInfo } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import {
  Target,
  ChevronDown,
  RefreshCw,
  CheckCircle2,
  RotateCcw,
  Lock,
} from 'lucide-react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { MainTabParamList } from '@/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { Button } from '@/components/ui/Button';
import { useGoalPlan, buildGoalPlanIndex } from '@/hooks/useGoalPlan';
import { toast } from '@/lib/toast';
import type { Dispatch, SetStateAction } from 'react';
import ActivityModal from '@/components/goals/ActivityModal';
import ProgressInsightsModal from '@/components/goals/ProgressInsightsModal';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import {
  GradientIconBox,
  GradientSurface,
} from '@/components/shared/GradientView';
import { MONTH_GRADIENTS, MONTH_ACCENT_COLORS } from '@/lib/gradientColors';

interface DashActivity {
  completed?: boolean;
  score?: unknown;
  note?: unknown;
  scorable?: unknown;
  ai_feedback?: unknown;
  parent_feedback?: unknown;
  what_changed?: string | null;
  what_learned?: string | null;
  recommendation?: string | null;
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

interface GoalPlanContextValue {
  flatIndexMap: Map<string, number>;
  firstActiveFlat: number;
  onStartActivity: Dispatch<SetStateAction<ActiveActivity | null>>;
  onResetActivity: (
    monthIdx: number,
    periodIdx: number,
    actIdx: number,
  ) => Promise<void>;
}

const GoalPlanContext = createContext<GoalPlanContextValue | null>(null);

interface MonthColor {
  gradFrom: string;
  gradTo: string;
  objectiveStripStyle: { borderColor: string; backgroundColor: string };
  labelColor: string;
  dotStyle: { backgroundColor: string };
}

interface MonthData {
  month?: number;
  goal?: string;
  objective?: string;
  periods?: { label?: string; activities?: DashActivity[] }[];
}

function ActivityCardIcon({
  completed,
  isLocked,
  dotStyle,
  index,
}: {
  completed?: boolean;
  isLocked: boolean;
  dotStyle: { backgroundColor: string };
  index: number;
}) {
  const { colors } = useTheme();
  if (completed) {
    return (
      <View className="mt-0.5 h-5 w-5 flex-shrink-0 items-center justify-center">
        <CheckCircle2 size={20} color={colors.success} />
      </View>
    );
  }
  if (isLocked) {
    return (
      <View
        className="mt-0.5 h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: colors.card }}
      >
        <Lock size={12} color={colors.textMuted} />
      </View>
    );
  }
  return (
    <View
      className="mt-0.5 h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
      style={dotStyle}
    >
      <Text
        className="text-[10px] font-bold"
        style={{ color: colors.primaryForeground }}
      >
        {index + 1}
      </Text>
    </View>
  );
}

function AccordionContent({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
  const measuredHeight = useRef(0);
  const animHeight = useSharedValue(isOpen ? 9999 : 0);
  // Ref so handleLayout can read latest isOpen without being recreated on every toggle
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const clipStyle = useAnimatedStyle(() => {
    if (animHeight.value >= 9999) return { overflow: 'hidden' as const };
    return { height: animHeight.value, overflow: 'hidden' as const };
  });

  // Ghost view is position:absolute so it measures natural height even when
  // the clip container is at height:0 (parent height:0 doesn't constrain it).
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;
      const prev = measuredHeight.current;
      measuredHeight.current = h;
      if (animHeight.value >= 9999) {
        // Initially-open: snap sentinel to real height
        animHeight.value = h;
      } else if (isOpenRef.current && prev > 0 && h !== prev) {
        // Content grew/shrank while open (e.g. activity completed) — adjust height to avoid clipping
        animHeight.value = withTiming(h, {
          duration: 200,
          easing: Easing.out(Easing.ease),
        });
      }
    },
    [animHeight],
  );

  useEffect(() => {
    if (measuredHeight.current === 0) return;
    animHeight.value = withTiming(isOpen ? measuredHeight.current : 0, {
      duration: 750,
      easing: Easing.inOut(Easing.ease),
    });
  }, [isOpen, animHeight]);

  return (
    <View>
      {/* Invisible ghost: abs-positioned so it always renders at natural height */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: 0 }}
        onLayout={handleLayout}
      >
        {children}
      </View>
      <Animated.View style={clipStyle}>{children}</Animated.View>
    </View>
  );
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
  const { colors } = useTheme();

  const chevronRot = useSharedValue(isOpen ? 180 : 0);
  useEffect(() => {
    chevronRot.value = withTiming(isOpen ? 180 : 0, { duration: 300 });
  }, [isOpen, chevronRot]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRot.value}deg` }],
  }));

  if (!ctx) return null;
  const { flatIndexMap, firstActiveFlat, onStartActivity, onResetActivity } =
    ctx;

  return (
    <View
      className="rounded-2xl border mb-4"
      style={{ borderColor: colors.border, backgroundColor: colors.background }}
    >
      <Pressable onPress={onToggle}>
        <GradientSurface
          from={color.gradFrom}
          to={color.gradTo}
          className="flex-row items-center justify-between rounded-t-2xl px-6 py-4"
        >
          <View className="flex-row items-center gap-3 flex-1 mr-2">
            <View
              className="h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: colors.ghostXL }}
            >
              <Text
                className="font-bold"
                style={{ color: colors.primaryForeground }}
              >
                {month.month}
              </Text>
            </View>
            <View className="flex-1">
              <Text
                className="text-xs font-medium uppercase tracking-widest"
                style={{ color: colors.primaryForeground, opacity: 0.7 }}
              >
                Month {month.month}
              </Text>
              <Text
                className="font-bold"
                style={{ color: colors.primaryForeground }}
                numberOfLines={2}
              >
                {month.goal}
              </Text>
            </View>
          </View>
          <Animated.View style={chevronStyle}>
            <ChevronDown size={20} color={colors.text} />
          </Animated.View>
        </GradientSurface>
        {month.objective && (
          <View
            className="px-6 py-2.5 border-b"
            style={color.objectiveStripStyle}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: color.labelColor }}
            >
              🎯 {month.objective}
            </Text>
          </View>
        )}
      </Pressable>

      <AccordionContent isOpen={!!isOpen}>
        <View className="px-5 py-5 gap-5">
          {month.periods?.map((period, pIdx) => (
            <View key={`${idx}-${pIdx}`}>
              <Text
                className="mb-3 text-xs font-bold uppercase tracking-widest"
                style={{ color: color.labelColor }}
              >
                {period.label}
              </Text>
              <View className="gap-2.5">
                {period.activities?.map((act, aIdx) => {
                  const flatIdx =
                    flatIndexMap.get(`${idx}-${pIdx}-${aIdx}`) ?? Infinity;
                  const isActive = flatIdx === firstActiveFlat;
                  const isLocked = flatIdx > firstActiveFlat;

                  let cardClass = 'border';
                  let cardStyle: Record<string, string> = {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  };
                  if (act.completed) {
                    cardClass = 'border';
                    cardStyle = {
                      borderColor: colors.success + '33',
                      backgroundColor: colors.success + '1A',
                    };
                  } else if (isLocked) {
                    cardClass = 'border border-dashed';
                    cardStyle = {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    };
                  }

                  return (
                    <View
                      key={`${idx}-${pIdx}-${aIdx}`}
                      className={`relative flex-row items-start gap-3 rounded-xl p-4 ${cardClass}`}
                      style={cardStyle}
                    >
                      <ActivityCardIcon
                        completed={act.completed}
                        isLocked={isLocked}
                        dotStyle={color.dotStyle}
                        index={aIdx}
                      />
                      <View className="flex-1 min-w-0">
                        <Text
                          className="text-sm font-semibold"
                          style={{
                            color: isLocked ? colors.border : colors.text,
                          }}
                        >
                          {act.title}
                        </Text>
                        <Text
                          className="mt-0.5 text-xs"
                          style={{
                            color: isLocked ? colors.border : colors.iconColor,
                          }}
                        >
                          {act.objective}
                        </Text>
                        {act.completed ? (
                          <View className="mt-2 gap-1.5">
                            {act.scorable !== false ? (
                              <Text
                                className="text-xs font-bold"
                                style={{ color: colors.text }}
                              >
                                Score:{' '}
                                {String(
                                  (act.score as
                                    | string
                                    | number
                                    | boolean
                                    | null
                                    | undefined) ?? '',
                                )}
                                /10
                              </Text>
                            ) : (
                              <Text
                                className="text-xs font-bold"
                                style={{ color: colors.text }}
                              >
                                Note:{' '}
                                {String(
                                  (act.note as
                                    | string
                                    | number
                                    | boolean
                                    | null
                                    | undefined) ?? '',
                                )}
                              </Text>
                            )}
                            {!!act.what_changed && (
                              <Text
                                className="text-xs"
                                style={{ color: colors.textMuted }}
                              >
                                <Text
                                  className="font-semibold"
                                  style={{ color: colors.text }}
                                >
                                  What changed:{' '}
                                </Text>
                                {String(act.what_changed)}
                              </Text>
                            )}
                            {!!act.what_learned && (
                              <Text
                                className="text-xs"
                                style={{ color: colors.textMuted }}
                              >
                                <Text
                                  className="font-semibold"
                                  style={{ color: colors.text }}
                                >
                                  Learnt:{' '}
                                </Text>
                                {String(act.what_learned)}
                              </Text>
                            )}
                            {!!act.recommendation && (
                              <Text
                                className="text-xs"
                                style={{ color: colors.primary }}
                              >
                                <Text className="font-semibold">Next: </Text>
                                {String(act.recommendation)}
                              </Text>
                            )}
                            {!!act.parent_feedback && (
                              <Text
                                className="text-xs italic"
                                style={{ color: colors.iconColor }}
                              >
                                Parent:{' '}
                                {typeof act.parent_feedback === 'string'
                                  ? act.parent_feedback
                                  : typeof act.parent_feedback === 'number' ||
                                    typeof act.parent_feedback === 'boolean'
                                  ? String(act.parent_feedback)
                                  : ''}
                              </Text>
                            )}
                          </View>
                        ) : isActive ? (
                          <Pressable
                            onPress={() => {
                              const originalAct =
                                pIdx > 0
                                  ? month.periods?.[0]?.activities?.[aIdx] ??
                                    null
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
                          >
                            <Text
                              className="mt-1.5 text-xs font-medium"
                              style={{ color: color.labelColor }}
                            >
                              Tap to start activity →
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {act.completed && (
                        <Pressable
                          onPress={() => {
                            void onResetActivity(idx, pIdx, aIdx);
                          }}
                          accessibilityLabel="Reset activity"
                          className="absolute right-3 top-3 h-6 w-6 items-center justify-center rounded-full border"
                          style={{
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                          }}
                        >
                          <RotateCcw size={12} color={colors.iconColor} />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </AccordionContent>
    </View>
  );
}

interface ModalErrorBoundaryState {
  hasError: boolean;
}
interface ModalErrorBoundaryProps {
  children: ReactNode;
}
class ModalErrorBoundary extends Component<
  ModalErrorBoundaryProps,
  ModalErrorBoundaryState
> {
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

type GoalsDashboardNavigationProp = StackNavigationProp<MainTabParamList>;

export default function GoalsDashboardScreen() {
  const navigation = useNavigation<GoalsDashboardNavigationProp>();

  const { colors } = useTheme();
  const monthColors = useMemo<MonthColor[]>(
    () => [
      {
        gradFrom: colors.primaryDark,
        gradTo: colors.primary,
        objectiveStripStyle: {
          borderColor: colors.primary + '40',
          backgroundColor: colors.primary + '1A',
        },
        labelColor: colors.primary,
        dotStyle: { backgroundColor: colors.primary },
      },
      {
        gradFrom: MONTH_GRADIENTS[1]!.from,
        gradTo: MONTH_GRADIENTS[1]!.to,
        objectiveStripStyle: {
          borderColor: MONTH_ACCENT_COLORS[1]!.stripBorder,
          backgroundColor: MONTH_ACCENT_COLORS[1]!.stripBg,
        },
        labelColor: MONTH_ACCENT_COLORS[1]!.label,
        dotStyle: { backgroundColor: MONTH_ACCENT_COLORS[1]!.dot },
      },
      {
        gradFrom: MONTH_GRADIENTS[2]!.from,
        gradTo: MONTH_GRADIENTS[2]!.to,
        objectiveStripStyle: {
          borderColor: MONTH_ACCENT_COLORS[2]!.stripBorder,
          backgroundColor: MONTH_ACCENT_COLORS[2]!.stripBg,
        },
        labelColor: MONTH_ACCENT_COLORS[2]!.label,
        dotStyle: { backgroundColor: MONTH_ACCENT_COLORS[2]!.dot },
      },
    ],
    [colors.primary, colors.primaryDark],
  );
  const { activeChildId: childId } = useAuth();

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

  const [expandedMonths, setExpandedMonths] = useState<Record<number, boolean>>(
    {
      0: true,
      1: false,
      2: false,
    },
  );
  const [activeActivity, setActiveActivity] = useState<ActiveActivity | null>(
    null,
  );
  const [showProgress, setShowProgress] = useState(false);

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
    setExpandedMonths(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const { flatIndexMap, firstActiveFlat } = useMemo(
    () => buildGoalPlanIndex(goalPlan),
    [goalPlan],
  );

  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  const contentStyle = useFocusEntranceAnim(!isLoading);
  const spinnerStyle = useSpinner();

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
    <View style={{ flex: 1 }}>
      <View className="flex-1" style={{ backgroundColor: colors.background }}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 40 }}
        >
          {/* Header */}
          <View className="mb-8 items-center">
            <View className="mb-4">
              <GradientIconBox
                from={colors.primaryLight}
                to={colors.primary}
                size={56}
                radius={16}
              >
                <Target size={28} color={colors.primaryForeground} />
              </GradientIconBox>
            </View>
            <Text
              className="mb-2 text-3xl font-bold tracking-tight text-center"
              style={{ color: colors.text }}
            >
              3-Month Growth Plan for{' '}
              {(childData?.name as string | undefined) || 'Your Child'}
            </Text>
            <Text className="text-center" style={{ color: colors.textMuted }}>
              Personalized goals powered by Buddy360
            </Text>

            {concern ? (
              <View
                className="mt-4 w-full max-w-xl rounded-2xl border px-5 py-3"
                style={{
                  borderColor: colors.warning + '40',
                  backgroundColor: colors.warning + '1A',
                }}
              >
                <Text
                  className="text-sm text-center"
                  style={{ color: colors.warning }}
                >
                  <Text className="font-semibold">Focus area: </Text>
                  {concern}
                </Text>
              </View>
            ) : null}
          </View>

          {isLoading ? (
            <View className="items-center justify-center py-24 gap-4">
              <Animated.View
                style={[
                  spinnerStyle,
                  {
                    borderColor: colors.primary,
                    borderTopColor: 'transparent',
                  },
                ]}
                className="h-10 w-10 rounded-full border-2"
              />
              <Text style={{ color: colors.iconColor }}>
                Building your 3-month plan...
              </Text>
            </View>
          ) : (
            <Animated.View style={contentStyle}>
              <GoalPlanContext.Provider value={contextValue}>
                <View>
                  {goalPlan?.months?.map((month, idx) => (
                    <MonthCard
                      key={(month as MonthData).month ?? idx}
                      month={month}
                      idx={idx}
                      color={monthColors[idx] ?? monthColors[0]!}
                      isOpen={!!expandedMonths[idx]}
                      onToggle={() => toggleMonth(idx)}
                    />
                  ))}

                  <View className="items-center pt-2 mb-4">
                    <Button
                      onPress={() => setShowProgress(true)}
                      className="h-11 rounded-2xl px-8"
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '600',
                          color: colors.primaryForeground,
                        }}
                      >
                        View Progress And Insights
                      </Text>
                    </Button>
                  </View>

                  <PageActions
                    className="pt-4"
                    left={
                      <Button
                        variant="outline"
                        onPress={() =>
                          (
                            navigation as unknown as {
                              navigate: (
                                name: string,
                                params?: unknown,
                              ) => void;
                            }
                          ).navigate('LifePathway', { fromBack: true })
                        }
                        className="h-11 w-full rounded-2xl px-6"
                      >
                        <Text
                          className="text-sm"
                          style={{ color: colors.text }}
                        >
                          ← Back
                        </Text>
                      </Button>
                    }
                    center={
                      <StartOverButton
                        childId={childId ?? undefined}
                        className="w-full"
                      />
                    }
                    right={
                      <Button
                        variant="outline"
                        onPress={() => {
                          void handleRegenerate();
                        }}
                        className="h-11 w-full rounded-2xl px-6"
                      >
                        <View className="flex-row items-center gap-2">
                          <RefreshCw size={16} color={colors.textMuted} />
                          <Text
                            className="text-sm"
                            style={{ color: colors.text }}
                          >
                            Regenerate Plan
                          </Text>
                        </View>
                      </Button>
                    }
                  />
                </View>
              </GoalPlanContext.Provider>
            </Animated.View>
          )}
        </ScrollView>

        <ModalErrorBoundary>
          {activeActivity ? (
            <ActivityModal
              activity={
                activeActivity.activity as {
                  title: string;
                  [key: string]: unknown;
                }
              }
              originalActivity={
                (activeActivity.originalActivity as
                  | { title?: string; [key: string]: unknown }
                  | undefined) ?? undefined
              }
              childName={childData?.name as string | undefined}
              childAge={childData?.age as number | string | undefined}
              childGender={childData?.gender as string | undefined}
              goal={activeActivity.monthGoal || concern || undefined}
              impact={activeActivity.monthObjective || undefined}
              onClose={() => setActiveActivity(null)}
              onComplete={handleActivityComplete}
            />
          ) : null}
          {showProgress && goalPlan ? (
            <ProgressInsightsModal
              goalPlan={goalPlan}
              childId={childData?.id as string | undefined}
              childName={childData?.name as string | undefined}
              childAge={childData?.age as number | string | undefined}
              childGender={childData?.gender as string | undefined}
              activeJobs={childData?.active_jobs as Record<string, string> | undefined}
              onPlanUpdate={plan => setGoalPlan(plan)}
              onClose={() => setShowProgress(false)}
            />
          ) : null}
        </ModalErrorBoundary>
      </View>
    </View>
  );
}
