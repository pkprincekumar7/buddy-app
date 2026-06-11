import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import {
  useModalScale,
  useSpinner,
  useSlideUpWhenReady,
} from '@/lib/animations';
import { GradientSurface } from '@/components/shared/GradientView';
import {
  X,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Minus,
  Clock,
  Lock,
  RefreshCw,
} from 'lucide-react-native';
import Svg, {
  Line as SvgLine,
  Text as SvgText,
  Rect as SvgRect,
  G as SvgG,
} from 'react-native-svg';
import { useTheme } from '@/lib/ThemeContext';
import { CHART_BAND_COLORS } from '@/lib/gradientColors';
import type { AppColors } from '@/lib/themeColors';
import { api } from '@/api/client';
import {
  INSIGHTS_SCHEMA_VERSION,
  NON_SCORABLE_DELTA_PTS,
  truncate,
  buildMonthData,
  completedCount,
} from '@/lib/insightsUtils';
import { generateInsights } from '@/lib/generateInsights';
import type { Observation } from '@/lib/insightsUtils';
import type { GoalPlan } from '@/hooks/useGoalPlan';

interface InsightsData {
  schema_version: number | null;
  insight_items: unknown[];
}

interface InsightItem {
  type?: string;
  text?: string;
  details?: string;
}

interface ProgressInsightsModalProps {
  goalPlan: GoalPlan;
  childId?: string;
  childName?: string;
  childAge?: number | string | null;
  childGender?: string | null;
  onPlanUpdate?: (plan: GoalPlan) => void;
  onClose: () => void;
}

// Maps a single pair observation to a bar score (-50 to +50)
const obsToBarScore = (obs: Observation): number => {
  if (obs.type === 'improved')
    return Math.min(obs.percent ?? NON_SCORABLE_DELTA_PTS, 50);
  if (obs.type === 'declined')
    return -Math.min(obs.percent ?? NON_SCORABLE_DELTA_PTS, 50);
  if (obs.type === 'noImprovement') return 0;
  return 0; // inProgress / notStarted → neutral
};

const obsToBarColor = (obs: Observation, colors: AppColors): string => {
  if (obs.type === 'improved') return colors.success;
  if (obs.type === 'declined') return colors.error;
  return colors.iconColor;
};

interface ObsBadgeProps {
  obs: Observation;
}

function ObsBadge({ obs }: ObsBadgeProps) {
  const { colors } = useTheme();
  const cfg: Record<
    string,
    {
      color: string;
      textColor: string;
      Icon: React.ComponentType<{ size?: number; color?: string }>;
    }
  > = {
    improved: {
      color: colors.success,
      textColor: colors.success,
      Icon: CheckCircle2,
    },
    declined: {
      color: colors.warning,
      textColor: colors.warning,
      Icon: AlertTriangle,
    },
    noImprovement: {
      color: colors.iconColor,
      textColor: colors.iconColor,
      Icon: Minus,
    },
    inProgress: { color: colors.info, textColor: colors.info, Icon: Clock },
    notStarted: {
      color: colors.iconColor,
      textColor: colors.textMuted,
      Icon: Lock,
    },
  };
  const entry = cfg[obs.type] ?? cfg.notStarted!;
  const { Icon } = entry;
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon size={16} color={entry.color} />
      <Text className="text-sm font-medium" style={{ color: entry.textColor }}>
        {obs.label}
      </Text>
    </View>
  );
}

// ── SVG diverging bar chart ───────────────────────────────────────────────────
interface ChartBarDatum {
  x: number;
  label: string;
  monthNum: number;
  actIdx: number;
  score: number;
  obsColor: string;
  fullLabel: string;
  obsLabel: string;
  obsType: string;
}

interface ChartTooltipProps {
  datum: ChartBarDatum;
  cx: number;
  chartWidth: number;
  onDismiss: () => void;
}

function ChartTooltip({ datum, cx, chartWidth, onDismiss }: ChartTooltipProps) {
  const TOOLTIP_W = 185;
  const left = Math.max(
    8,
    Math.min(cx - TOOLTIP_W / 2, chartWidth - TOOLTIP_W - 8),
  );
  const { colors } = useTheme();
  const obsTextColor =
    datum.obsType === 'improved'
      ? colors.success
      : datum.obsType === 'declined'
      ? colors.error
      : datum.obsType === 'noImprovement'
      ? colors.iconColor
      : colors.info;
  return (
    <Pressable
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      onPress={onDismiss}
    >
      <View
        style={{
          position: 'absolute',
          top: 4,
          left,
          width: TOOLTIP_W,
          borderColor: colors.border,
          backgroundColor: colors.card,
        }}
        className="rounded-xl border px-3 py-2.5 shadow-lg"
      >
        <Text
          className="text-sm font-semibold leading-snug"
          style={{ color: colors.text }}
          numberOfLines={3}
        >
          {datum.fullLabel}
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: colors.iconColor }}>
          Month {datum.monthNum} · Activity {datum.actIdx + 1}
        </Text>
        <Text
          className="mt-1 text-sm font-medium"
          style={{ color: obsTextColor }}
        >
          {datum.obsLabel}
        </Text>
      </View>
    </Pressable>
  );
}

function ProgressBarChart({
  data,
  chartWidth,
  onBarPress,
}: {
  data: ChartBarDatum[];
  chartWidth: number;
  onBarPress?: (datum: ChartBarDatum, cx: number) => void;
}) {
  const { colors } = useTheme();
  const PAD = { top: 28, right: 12, bottom: 48, left: 38 };
  const totalHeight = 240;
  const innerW = chartWidth - PAD.left - PAD.right;
  const innerH = totalHeight - PAD.top - PAD.bottom;
  const Y_MIN = -55;
  const Y_MAX = 55;

  const sy = (v: number) =>
    PAD.top + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * innerH;
  const yZero = sy(0);

  const barCount = Math.max(data.length, 1);
  const slotW = innerW / barCount;
  const barW = Math.max(slotW * 0.55, 4);
  const bx = (i: number) => PAD.left + slotW * i + slotW / 2;

  const yTicks = [-50, -25, 0, 25, 50];

  // Month background bands (2 bars per month)
  const bandColors = CHART_BAND_COLORS;
  const monthBands = [0, 1, 2].map(m => {
    const first = m * 2;
    const last = m * 2 + 1;
    const x1 = PAD.left + slotW * first;
    const x2 = PAD.left + slotW * last + slotW;
    return { x: x1, width: x2 - x1, fill: bandColors[m] ?? 'transparent' };
  });

  return (
    <Svg width={chartWidth} height={totalHeight}>
      {/* Month background bands */}
      {monthBands.map((band, i) => (
        <SvgRect
          key={`band-${i}`}
          x={band.x}
          y={PAD.top}
          width={band.width}
          height={innerH}
          fill={band.fill}
        />
      ))}

      {/* Grid lines */}
      {yTicks.map(tick => (
        <SvgLine
          key={`yg${tick}`}
          x1={PAD.left}
          y1={sy(tick)}
          x2={PAD.left + innerW}
          y2={sy(tick)}
          stroke={tick === 0 ? colors.border : `${colors.border}0d`}
          strokeWidth={tick === 0 ? 1.5 : 1}
        />
      ))}

      {/* Left axis */}
      <SvgLine
        x1={PAD.left}
        y1={PAD.top}
        x2={PAD.left}
        y2={PAD.top + innerH}
        stroke={colors.border}
        strokeWidth={1}
      />

      {/* Y labels */}
      {yTicks.map(tick => (
        <SvgText
          key={`yl${tick}`}
          x={PAD.left - 4}
          y={sy(tick) + 3.5}
          fill={colors.iconColor}
          fontSize={9}
          textAnchor="end"
        >
          {tick > 0 ? `+${tick}` : String(tick)}
        </SvgText>
      ))}

      {/* Bars, labels, arrows */}
      {data.map((d, i) => {
        const cx = bx(i);
        const scoreH = Math.abs((d.score / (Y_MAX - Y_MIN)) * innerH);
        const isPositive = d.score > 0;
        const isNeutral = d.score === 0;
        const barY = isPositive ? yZero - scoreH : yZero;
        const arrowY = isPositive ? yZero - scoreH - 10 : yZero + scoreH + 16;
        const arrowChar = isPositive ? '↑' : d.score < 0 ? '↓' : '—';
        const arrowColor = isPositive
          ? colors.success
          : d.score < 0
          ? colors.error
          : colors.iconColor;

        return (
          <SvgG key={d.x} onPress={() => onBarPress?.(d, cx)}>
            {/* Transparent hit area covering the full column */}
            <SvgRect
              x={cx - slotW / 2}
              y={PAD.top}
              width={slotW}
              height={innerH}
              fill="transparent"
            />
            <SvgRect
              x={cx - barW / 2}
              y={isNeutral ? yZero - 2 : barY}
              width={barW}
              height={isNeutral ? 4 : Math.max(scoreH, 2)}
              rx={2}
              fill={d.obsColor}
            />
            {/* Arrow label above/below bar */}
            <SvgText
              x={cx}
              y={arrowY}
              textAnchor="middle"
              fill={arrowColor}
              fontSize={14}
              fontWeight="bold"
            >
              {arrowChar}
            </SvgText>
            {/* Activity label */}
            <SvgText
              x={cx}
              y={PAD.top + innerH + 14}
              fill={colors.iconColor}
              fontSize={8}
              textAnchor="middle"
            >
              {d.label}
            </SvgText>
            {/* Month label — shown only for first bar in each group */}
            {d.actIdx === 0 && (
              <SvgText
                x={cx + slotW / 2}
                y={PAD.top + innerH + 28}
                fill={colors.iconColor}
                fontSize={7}
                textAnchor="middle"
                fontWeight="bold"
              >
                Month {d.monthNum}
              </SvgText>
            )}
          </SvgG>
        );
      })}
    </Svg>
  );
}

// ── InsightAccordion — height + opacity animated expand/collapse ──────────────
function InsightAccordion({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
  const measuredHeight = useRef(0);
  const animHeight = useSharedValue(0);
  const animOpacity = useSharedValue(0);

  const clipStyle = useAnimatedStyle(() => ({
    height: animHeight.value,
    overflow: 'hidden' as const,
    opacity: animOpacity.value,
  }));

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    measuredHeight.current = h;
  }, []);

  useEffect(() => {
    if (measuredHeight.current === 0) return;
    animHeight.value = withTiming(isOpen ? measuredHeight.current : 0, {
      duration: isOpen ? 350 : 300,
      easing: Easing.inOut(Easing.ease),
    });
    animOpacity.value = withTiming(isOpen ? 1 : 0, {
      duration: isOpen ? 400 : 200,
    });
  }, [isOpen, animHeight, animOpacity]);

  return (
    <Animated.View style={clipStyle}>
      {/* Ghost layer for measurement — abs positioned so height:0 parent doesn't constrain it */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: 0 }}
        onLayout={handleLayout}
      >
        {children}
      </View>
      {children}
    </Animated.View>
  );
}

// ── InsightRow — separate component so hooks can animate per-item ─────────────
interface InsightRowProps {
  item: InsightItem;
  idx: number;
  isExpanded: boolean;
  onToggle: () => void;
  ready: boolean;
}

function InsightRow({
  item,
  idx,
  isExpanded,
  onToggle,
  ready,
}: InsightRowProps) {
  const { colors } = useTheme();
  const rowStyle = useSlideUpWhenReady(ready, idx * 100, 500);
  const isAnomaly = item.type === 'anomaly';

  return (
    <Animated.View
      style={[
        rowStyle,
        idx !== 0
          ? { borderTopWidth: 1, borderTopColor: colors.border }
          : undefined,
        {
          backgroundColor: isAnomaly
            ? colors.warning + '1A'
            : colors.background,
        },
      ]}
    >
      <View className="flex-row items-center gap-3 px-5 py-4">
        <View className="flex-shrink-0">
          {isAnomaly ? (
            <AlertTriangle size={16} color={colors.warning} />
          ) : (
            <CheckCircle2 size={16} color={colors.success} />
          )}
        </View>
        <Text
          className="flex-1 text-sm font-medium leading-snug"
          style={{ color: isAnomaly ? colors.warning : colors.text }}
        >
          {item.text}
        </Text>
        <Pressable
          onPress={onToggle}
          className="ml-2 flex-shrink-0 rounded-lg px-3 py-1.5"
          style={{
            backgroundColor: isAnomaly
              ? colors.warning + '1A'
              : colors.primary + '1A',
          }}
        >
          <Text
            className="text-xs font-semibold"
            style={{ color: isAnomaly ? colors.warning : colors.primary }}
          >
            {isExpanded ? 'Hide Details' : 'View Details'}
          </Text>
        </Pressable>
      </View>

      <InsightAccordion isOpen={isExpanded}>
        <View
          className="border-t px-5 pb-5"
          style={
            isAnomaly
              ? {
                  borderTopColor: colors.warning + '26',
                  backgroundColor: colors.warning + '0D',
                }
              : { borderTopColor: colors.border, backgroundColor: colors.card }
          }
        >
          <Text
            className="pb-4 pt-4 text-sm leading-relaxed"
            style={{ color: colors.textMuted }}
          >
            {item.details}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              className="rounded-xl px-4 py-2"
              style={{ backgroundColor: colors.primaryAction }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.primaryForeground }}
              >
                Start Monitoring
              </Text>
            </Pressable>
            <Pressable
              className="rounded-xl border px-4 py-2"
              style={{
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
              }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.text }}
              >
                Check-in Later
              </Text>
            </Pressable>
          </View>
        </View>
      </InsightAccordion>
    </Animated.View>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function ProgressInsightsModal({
  goalPlan,
  childId,
  childName,
  childAge,
  childGender,
  onPlanUpdate,
  onClose,
}: ProgressInsightsModalProps) {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState('progress');
  const [progressTab, setProgressTab] = useState('monthly');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [selectedBar, setSelectedBar] = useState<{
    datum: ChartBarDatum;
    cx: number;
  } | null>(null);
  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(false);

  const goalPlanRef = useRef(goalPlan);
  const childNameRef = useRef(childName);
  const childAgeRef = useRef(childAge);
  const childGenderRef = useRef(childGender);
  goalPlanRef.current = goalPlan;
  childNameRef.current = childName;
  childAgeRef.current = childAge;
  childGenderRef.current = childGender;

  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.max(screenWidth - 80, 200);

  const monthData = useMemo(() => buildMonthData(goalPlan), [goalPlan]);

  const chartBarData = useMemo(
    () =>
      monthData.flatMap(({ month, pairs }) =>
        pairs.map((pair, pIdx) => ({
          x: (month.month ?? 0) * 10 + pIdx,
          label: `A${pIdx + 1}`,
          monthNum: month.month ?? 0,
          actIdx: pIdx,
          score: obsToBarScore(pair.observation),
          obsColor: obsToBarColor(pair.observation, colors),
          fullLabel: pair.label,
          obsLabel: pair.observation.label,
          obsType: pair.observation.type,
        })),
      ),
    [monthData, colors],
  );

  // Modal entrance animation
  const cardStyle = useModalScale(true);
  const spinnerStyle = useSpinner();

  // Tab fade animations
  const tabOpacity = useSharedValue(1);
  const subTabOpacity = useSharedValue(1);

  const switchTab = useCallback(
    (tab: string) => {
      tabOpacity.value = withTiming(0, { duration: 150 }, () => {
        runOnJS(setActiveTab)(tab);
        tabOpacity.value = withTiming(1, { duration: 200 });
      });
    },
    [tabOpacity],
  );

  const switchProgressTab = useCallback(
    (tab: string) => {
      setSelectedBar(null);
      subTabOpacity.value = withTiming(0, { duration: 150 }, () => {
        runOnJS(setProgressTab)(tab);
        subTabOpacity.value = withTiming(1, { duration: 200 });
      });
    },
    [subTabOpacity],
  );

  const tabFadeStyle = useAnimatedStyle(() => ({ opacity: tabOpacity.value }));
  const subTabFadeStyle = useAnimatedStyle(() => ({
    opacity: subTabOpacity.value,
  }));

  useEffect(() => {
    if (
      activeTab !== 'insights' ||
      insightsData ||
      insightsLoading ||
      insightsError
    )
      return;

    const plan = goalPlanRef.current;
    const name = childNameRef.current;
    const age = childAgeRef.current;
    const gender = childGenderRef.current;
    const currentCount = completedCount(plan);

    // Valid cache: same schema version, generated after the last completed activity,
    // and actually contains insights (don't serve a previously-saved empty result).
    if (
      plan?.insights?.schema_version === INSIGHTS_SCHEMA_VERSION &&
      plan?.insights_signature === currentCount &&
      Array.isArray(plan.insights.insight_items) &&
      plan.insights.insight_items.length > 0
    ) {
      setInsightsData(plan.insights);
      return;
    }

    const generate = async () => {
      setInsightsLoading(true);
      setInsightsError(false);
      try {
        const payload = await generateInsights(name, plan, age, gender);
        // Only persist non-empty insights — if no activities are completed yet the
        // guard returns [] and we don't want that to be cached permanently.
        if (payload.insight_items.length > 0) {
          const updatedPlan: GoalPlan = {
            ...plan,
            insights: { ...payload, schema_version: payload.schema_version },
            insights_signature: currentCount,
          };
          try {
            await api.goals.patch(childId ?? '', { plan: updatedPlan });
            onPlanUpdate?.(updatedPlan);
          } catch (err) {
            console.warn(
              '[ProgressInsightsModal] Insight save failed (non-fatal):',
              err,
            );
          }
        }
        setInsightsData(payload);
      } catch (err) {
        console.error(
          '[ProgressInsightsModal] Failed to generate insights:',
          err,
        );
        setInsightsError(true);
      }
      setInsightsLoading(false);
    };
    void generate();
  }, [
    activeTab,
    insightsData,
    insightsLoading,
    insightsError,
    childId,
    onPlanUpdate,
  ]);

  return (
    <Modal visible animationType="none" transparent onRequestClose={onClose}>
      <View
        className="flex-1 items-center justify-center p-4"
        style={{ backgroundColor: colors.overlayBackground }}
      >
        <Animated.View
          accessibilityRole="none"
          accessibilityLabel="Progress and Insights"
          style={[
            cardStyle,
            {
              flex: 1,
              maxHeight: '90%' as const,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
          className="border w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <GradientSurface
            from={colors.primaryDark}
            to={colors.primaryMedium}
            diagonal
            style={{ flexShrink: 0 }}
            className="flex-row items-center justify-between rounded-t-3xl px-6 py-5"
          >
            <View className="flex-row items-center gap-3">
              <View
                className="h-10 w-10 items-center justify-center rounded-2xl"
                style={{ backgroundColor: colors.ghostXL }}
              >
                <BarChart3 size={24} color={colors.primaryForeground} />
              </View>
              <View>
                <Text
                  className="text-xl font-bold"
                  style={{ color: colors.primaryForeground }}
                >
                  Progress & Insights
                </Text>
                <Text
                  className="text-sm"
                  style={{ color: colors.primaryForeground, opacity: 0.8 }}
                >
                  3-Month Growth Overview
                </Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close progress modal"
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.ghostXL }}
            >
              <X size={20} color={colors.primaryForeground} />
            </Pressable>
          </GradientSurface>

          {/* Top-level tabs */}
          <View
            style={{
              flexShrink: 0,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.background,
            }}
            className="flex-row px-6 pt-3"
          >
            {[
              ['progress', 'Progress'],
              ['insights', 'Insights'],
            ].map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => switchTab(key!)}
                className="border-b-2 px-5 pb-3"
                style={{
                  borderBottomColor:
                    activeTab === key ? colors.primary : 'transparent',
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color:
                      activeTab === key ? colors.primary : colors.iconColor,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Scrollable body */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 24, paddingBottom: 32 }}
          >
            <Animated.View style={tabFadeStyle}>
              {/* ── PROGRESS TAB ── */}
              {activeTab === 'progress' && (
                <View>
                  <View className="mb-5 flex-row gap-2">
                    {[
                      ['monthly', 'Monthly'],
                      ['3months', '3-Months'],
                    ].map(([key, label]) => (
                      <Pressable
                        key={key}
                        onPress={() => switchProgressTab(key!)}
                        className="rounded-xl px-4 py-2"
                        style={{
                          backgroundColor:
                            progressTab === key ? colors.primary : colors.card,
                        }}
                      >
                        <Text
                          className="text-sm font-semibold"
                          style={{
                            color:
                              progressTab === key
                                ? colors.primaryForeground
                                : colors.textMuted,
                          }}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Animated.View style={subTabFadeStyle}>
                    {/* Monthly table */}
                    {progressTab === 'monthly' && (
                      <View
                        className="rounded-2xl border overflow-hidden"
                        style={{ borderColor: colors.border }}
                      >
                        {/* Header row */}
                        <View
                          className="flex-row px-4 py-3"
                          style={{ backgroundColor: colors.card }}
                        >
                          <Text
                            className="w-20 text-xs font-semibold"
                            style={{ color: colors.textMuted }}
                          >
                            Month
                          </Text>
                          <Text
                            className="flex-1 text-xs font-semibold"
                            style={{ color: colors.textMuted }}
                          >
                            Goal
                          </Text>
                          <Text
                            className="flex-1 text-xs font-semibold"
                            style={{ color: colors.textMuted }}
                          >
                            Objective
                          </Text>
                          <Text
                            className="flex-1 text-xs font-semibold"
                            style={{ color: colors.textMuted }}
                          >
                            Observation
                          </Text>
                        </View>
                        {monthData.map(({ month, pairs }, mIdx) =>
                          pairs.map((pair, pIdx) => (
                            <View
                              key={`${mIdx}-${pIdx}`}
                              className="flex-row border-t px-4 py-3"
                              style={{ borderTopColor: colors.border }}
                            >
                              {pIdx === 0 ? (
                                <Text
                                  className="w-20 text-xs font-bold self-start"
                                  style={{ color: colors.text }}
                                >
                                  Month {month.month}
                                </Text>
                              ) : (
                                <View className="w-20" />
                              )}
                              {pIdx === 0 ? (
                                <Text
                                  className="flex-1 text-xs self-start pr-2"
                                  style={{ color: colors.text }}
                                >
                                  {truncate(month.goal, 42)}
                                </Text>
                              ) : (
                                <View className="flex-1" />
                              )}
                              <Text
                                className="flex-1 text-xs pr-2"
                                style={{ color: colors.textMuted }}
                              >
                                {pair.label}
                              </Text>
                              <View className="flex-1">
                                <ObsBadge obs={pair.observation} />
                              </View>
                            </View>
                          )),
                        )}
                      </View>
                    )}

                    {/* 3-Months bar chart */}
                    {progressTab === '3months' && (
                      <View>
                        <Text
                          className="mb-4 text-center text-sm"
                          style={{ color: colors.textMuted }}
                        >
                          Per-objective comparison: original (Week 1&amp;2) vs
                          follow-up (Week 3&amp;4)
                        </Text>
                        <View style={{ height: 240, position: 'relative' }}>
                          <ProgressBarChart
                            data={chartBarData}
                            chartWidth={chartWidth}
                            onBarPress={(datum, cx) =>
                              setSelectedBar({ datum, cx })
                            }
                          />
                          {selectedBar && (
                            <ChartTooltip
                              datum={selectedBar.datum}
                              cx={selectedBar.cx}
                              chartWidth={chartWidth}
                              onDismiss={() => setSelectedBar(null)}
                            />
                          )}
                        </View>
                        <View className="mt-3 flex-row justify-center gap-6">
                          <View className="flex-row items-center gap-1.5">
                            <View
                              className="h-3 w-3 rounded-sm"
                              style={{ backgroundColor: colors.success }}
                            />
                            <Text
                              className="text-xs"
                              style={{ color: colors.iconColor }}
                            >
                              Improvement
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-1.5">
                            <View
                              className="h-3 w-3 rounded-sm"
                              style={{ backgroundColor: colors.error }}
                            />
                            <Text
                              className="text-xs"
                              style={{ color: colors.iconColor }}
                            >
                              Decline
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-1.5">
                            <View
                              className="h-3 w-3 rounded-sm"
                              style={{ backgroundColor: colors.border }}
                            />
                            <Text
                              className="text-xs"
                              style={{ color: colors.iconColor }}
                            >
                              N/A
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </Animated.View>
                </View>
              )}

              {/* ── INSIGHTS TAB ── */}
              {activeTab === 'insights' && (
                <View>
                  {insightsLoading && (
                    <View className="items-center gap-4 py-20">
                      <Animated.View
                        style={[
                          spinnerStyle,
                          {
                            borderColor: colors.primary,
                            borderTopColor: 'transparent',
                          },
                        ]}
                        className="h-12 w-12 rounded-full border-4"
                      />
                      <Text
                        className="font-semibold"
                        style={{ color: colors.text }}
                      >
                        Generating personalised insights…
                      </Text>
                      <Text
                        className="text-sm"
                        style={{ color: colors.iconColor }}
                      >
                        Analysing {childName ? `${childName}'s` : 'the'}{' '}
                        assessment data
                      </Text>
                    </View>
                  )}

                  {insightsError && !insightsLoading && (
                    <View className="items-center gap-4 py-16">
                      <Text
                        className="text-sm"
                        style={{ color: colors.textMuted }}
                      >
                        Failed to generate insights. Please try again.
                      </Text>
                      <Pressable
                        onPress={() => {
                          setInsightsError(false);
                          setInsightsData(null);
                        }}
                        className="flex-row items-center gap-2 rounded-xl px-4 py-2"
                        style={{ backgroundColor: colors.primaryAction }}
                      >
                        <RefreshCw size={16} color={colors.primaryForeground} />
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.primaryForeground }}
                        >
                          Retry
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {insightsData &&
                    !insightsLoading &&
                    insightsData.insight_items.length === 0 && (
                      <View className="items-center gap-3 py-16">
                        <Text
                          className="text-base font-semibold"
                          style={{ color: colors.text }}
                        >
                          No insights yet
                        </Text>
                        <Text
                          className="max-w-xs text-center text-sm"
                          style={{ color: colors.iconColor }}
                        >
                          Complete at least one activity to generate
                          personalised insights for {childName ?? 'your child'}.
                        </Text>
                      </View>
                    )}

                  {insightsData &&
                    !insightsLoading &&
                    insightsData.insight_items.length > 0 && (
                      <View
                        className="rounded-2xl border overflow-hidden"
                        style={{ borderColor: colors.border }}
                      >
                        {(insightsData.insight_items || []).map(
                          (itemRaw, idx) => {
                            const item = itemRaw as InsightItem;
                            return (
                              <InsightRow
                                key={`${item.type ?? ''}-${idx}`}
                                item={item}
                                idx={idx}
                                isExpanded={expandedInsight === idx}
                                onToggle={() =>
                                  setExpandedInsight(prev =>
                                    prev === idx ? null : idx,
                                  )
                                }
                                ready={!!insightsData && !insightsLoading}
                              />
                            );
                          },
                        )}
                      </View>
                    )}
                </View>
              )}
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
