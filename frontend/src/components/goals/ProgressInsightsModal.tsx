import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { ReactElement } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
  Minus,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  LabelList,
  Tooltip,
} from 'recharts';
import { api } from '@/api/client';
import {
  INSIGHTS_SCHEMA_VERSION,
  NON_SCORABLE_DELTA_PTS,
  truncate,
  buildMonthData,
  completedCount,
} from '@/lib/insightsUtils';
import { buildInsightsPayload } from '@/lib/generateInsights';
import { useJob } from '@/hooks/useJob';
import type { Observation } from '@/lib/insightsUtils';
import type { GoalPlan } from '@/hooks/useGoalPlan';
import { CHART_BAND_COLORS } from '@/lib/gradientColors';

interface ChartEntry {
  key: string;
  monthNum: number;
  actIdx: number;
  fullLabel: string;
  score: number;
  isNA: boolean;
  obsType: string;
  obsLabel: string;
}

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
  childAge?: string | number | null;
  childGender?: string | null;
  activeJobs?: Record<string, string>;
  onPlanUpdate?: (plan: GoalPlan) => void;
  onClose: () => void;
}

// Maps a single pair observation to a chart score value.
// Non-scorable uses ±NON_SCORABLE_DELTA_PTS as a fixed unit so direction is still visible.
const obsToScore = (obs: Observation): number | null => {
  if (obs.type === 'improved') return obs.percent ?? NON_SCORABLE_DELTA_PTS;
  if (obs.type === 'declined') return -(obs.percent ?? NON_SCORABLE_DELTA_PTS);
  if (obs.type === 'noImprovement') return 0;
  return null; // inProgress / notStarted → NA
};

// ── sub-components ────────────────────────────────────────────────────────────

const ObsBadge = ({ obs }: { obs: Observation }) => {
  const cfg: Record<string, { cls: string; icon: ReactElement }> = {
    improved: {
      cls: 'text-success-xstrong',
      icon: <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />,
    },
    declined: {
      cls: 'text-warning-strong',
      icon: <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning-medium" />,
    },
    noImprovement: {
      cls: 'text-subtle',
      icon: <Minus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />,
    },
    inProgress: {
      cls: 'text-info-strong',
      icon: <Clock className="h-4 w-4 flex-shrink-0 text-info" />,
    },
    notStarted: {
      cls: 'text-muted-foreground',
      icon: <Lock className="h-4 w-4 flex-shrink-0 text-dim" />,
    },
  };
  const entry = cfg[obs.type] ?? cfg['notStarted'];
  const { cls, icon } = entry!;
  return (
    <span className={`flex items-center gap-1.5 text-sm font-medium ${cls}`}>
      {icon}
      {obs.label}
    </span>
  );
};

interface ArrowLabelProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
}

const ArrowLabel = ({ x = 0, y = 0, width = 0, height = 0, value }: ArrowLabelProps) => {
  if (value === null || value === undefined) return null;
  if (value === 0)
    return (
      <text
        x={x + width / 2}
        y={y - 8}
        textAnchor="middle"
        style={{ fill: 'hsl(var(--muted-foreground))' }}
        fontSize={18}
        fontWeight="bold"
      >
        –
      </text>
    );
  const isUp = value > 0;
  const labelY = isUp ? y - 10 : y + Math.abs(height) + 18;
  return (
    <text
      x={x + width / 2}
      y={labelY}
      textAnchor="middle"
      fill={isUp ? 'hsl(var(--success))' : 'hsl(var(--error))'}
      fontSize={22}
      fontWeight="bold"
    >
      {isUp ? '↑' : '↓'}
    </text>
  );
};

// Two-level X-axis tick: activity label on line 1, "Month X" centred over the
// pair on line 2 (shown only for the first bar in each month group).
const buildCustomTick = (chartData: ChartEntry[]) =>
  function CustomTick({
    x = 0,
    y = 0,
    payload,
  }: {
    x?: number;
    y?: number;
    payload?: { value: string };
  }) {
    if (!payload) return null;
    const entry = chartData.find((d) => d.key === payload.value);
    if (!entry) return null;
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          dy={14}
          textAnchor="middle"
          style={{ fill: 'hsl(var(--muted-foreground))' }}
          fontSize={11}
        >
          A{entry.actIdx + 1}
        </text>
        {entry.actIdx === 0 && (
          <text
            x={48}
            dy={28}
            textAnchor="middle"
            style={{ fill: 'hsl(var(--muted-foreground))' }}
            fontSize={10}
            fontWeight={700}
          >
            Month {entry.monthNum}
          </text>
        )}
      </g>
    );
  };

const buildCustomTooltip = (_chartData: ChartEntry[]) =>
  function CustomTooltip({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload: ChartEntry }>;
  }) {
    if (!active || !payload?.length) return null;
    const firstEntry = payload[0];
    if (!firstEntry) return null;
    const entry = firstEntry.payload;
    const obsColor =
      entry.obsType === 'improved'
        ? 'text-success-strong'
        : entry.obsType === 'declined'
          ? 'text-error-medium'
          : entry.obsType === 'noImprovement'
            ? 'text-subtle'
            : 'text-info-medium';
    return (
      <div className="border-edge max-w-[200px] rounded-xl bg-surface-elevated px-3 py-2.5 text-sm shadow-lg">
        <p className="mb-0.5 break-words font-semibold leading-snug text-foreground">
          {entry.fullLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          Month {entry.monthNum} · Activity {entry.actIdx + 1}
        </p>
        <p className={`mt-1 font-medium ${obsColor}`}>{entry.obsLabel}</p>
      </div>
    );
  };

// ── main component ────────────────────────────────────────────────────────────

export default function ProgressInsightsModal({
  goalPlan,
  childId,
  childName,
  childAge,
  childGender,
  activeJobs,
  onPlanUpdate,
  onClose,
}: ProgressInsightsModalProps) {
  const [activeTab, setActiveTab] = useState('progress');
  const [progressTab, setProgressTab] = useState('monthly');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(false);

  // Keep always-current refs so the insights effect can read latest props without
  // being listed as a dependency (re-generation is driven by insightsData reset, not prop changes).
  const goalPlanRef = useRef(goalPlan);
  const childNameRef = useRef(childName);
  const childAgeRef = useRef(childAge);
  const childGenderRef = useRef(childGender);
  goalPlanRef.current = goalPlan;
  childNameRef.current = childName;
  childAgeRef.current = childAge;
  childGenderRef.current = childGender;

  const monthData = useMemo(() => buildMonthData(goalPlan), [goalPlan]);

  // 6 entries — one per objective pair — grouped visually by month
  const chartData = useMemo(
    () =>
      monthData.flatMap(({ month, pairs }) =>
        pairs.map((pair, pIdx) => {
          const raw = obsToScore(pair.observation);
          return {
            key: `${month.month}-${pIdx}`,
            monthNum: month.month,
            actIdx: pIdx,
            fullLabel: pair.label,
            score: raw ?? 0,
            isNA: raw === null,
            obsType: pair.observation.type,
            obsLabel: pair.observation.label,
          } satisfies ChartEntry;
        }),
      ),
    [monthData],
  );

  const CustomTick = useMemo(() => buildCustomTick(chartData), [chartData]);
  const CustomTooltip = useMemo(() => buildCustomTooltip(chartData), [chartData]);

  const finalizeInsights = useCallback(async () => {
    const plan = goalPlanRef.current;
    const currentCount = completedCount(plan);
    try {
      const goalsData = await api.goals.get(childId ?? '');
      const rawPlan = goalsData.plan;
      const rawInsights = rawPlan?.insights as Record<string, unknown> | undefined;
      const items = Array.isArray(rawInsights?.insight_items)
        ? (rawInsights.insight_items as unknown[])
        : [];
      const finalInsights = { schema_version: INSIGHTS_SCHEMA_VERSION, insight_items: items };
      if (items.length > 0) {
        const updatedPlan: GoalPlan = {
          ...plan,
          insights: finalInsights,
          insights_signature: currentCount,
        };
        try {
          await api.goals.patch(childId ?? '', { plan: updatedPlan });
          onPlanUpdate?.(updatedPlan);
        } catch (err) {
          console.warn('[ProgressInsightsModal] Insight save failed (non-fatal):', err);
        }
      }
      // Always set insightsData (even when empty) so the effect guard treats
      // this run as complete and does not re-enqueue.
      setInsightsData(finalInsights);
    } catch (err) {
      console.error('[ProgressInsightsModal] Failed to finalize insights:', err);
      setInsightsError(true);
    }
    setInsightsLoading(false);
  }, [childId, onPlanUpdate]);

  const insightsJob = useJob({
    activeJobs,
    jobType: 'generate_journey_insights',
    onCompleted: finalizeInsights,
  });
  const { enqueue: enqueueInsightsJob } = insightsJob;

  useEffect(() => {
    if (activeTab !== 'insights' || insightsData || insightsLoading || insightsError) return;

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

    // Stale or missing — enqueue via jobs queue, finalize in finalizeInsights.
    const generate = async () => {
      const { prompt, schema } = buildInsightsPayload(name, plan, age, gender);
      if (!prompt) {
        // No completed activities yet — nothing to generate.
        setInsightsData({ schema_version: INSIGHTS_SCHEMA_VERSION, insight_items: [] });
        return;
      }
      setInsightsLoading(true);
      setInsightsError(false);
      try {
        await enqueueInsightsJob({
          type: 'generate_journey_insights',
          child_id: childId ?? '',
          payload: { prompt, response_json_schema: schema },
          write_back: { collection: 'goals', filter: {}, field: 'goals_plan.insights' },
        });
      } catch (err) {
        console.error('[ProgressInsightsModal] Failed to enqueue insights job:', err);
        setInsightsError(true);
        setInsightsLoading(false);
      }
    };
    void generate();
  }, [activeTab, insightsData, insightsLoading, insightsError, childId, enqueueInsightsJob]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Progress and Insights"
        initial={{ opacity: 0, scale: 0.93, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16, transition: { duration: 0.25, ease: 'easeIn' } }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="border-edge flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between bg-gradient-to-br from-primary-dark to-primary-medium px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-ghost-xl flex h-10 w-10 items-center justify-center rounded-2xl">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Progress & Insights</h2>
              <p className="text-sm text-white/80">3-Month Growth Overview</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close progress modal"
            className="bg-ghost-xl hover:bg-ghost-xl flex h-8 w-8 items-center justify-center rounded-full transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Top-level tabs */}
        <div className="border-b-edge-faint flex flex-shrink-0 bg-card px-6 pt-3">
          {[
            ['progress', 'Progress'],
            ['insights', 'Insights'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveTab(key!)}
              className={`border-b-2 px-5 pb-3 text-sm font-semibold transition-colors ${
                activeTab === key
                  ? 'border-primary-medium text-primary-light'
                  : 'border-transparent text-subtle hover:text-dim'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {/* ── PROGRESS TAB ── */}
            {activeTab === 'progress' && (
              <motion.div
                key="tab-progress"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12, transition: { duration: 0.2, ease: 'easeIn' } }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                <div className="mb-5 flex gap-2">
                  {[
                    ['monthly', 'Monthly'],
                    ['3months', '3-Months'],
                  ].map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setProgressTab(key!)}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                        progressTab === key
                          ? 'bg-primary-action text-white shadow-sm'
                          : 'bg-ghost-light hover:bg-ghost-strong text-muted-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {/* Monthly table */}
                  {progressTab === 'monthly' && (
                    <motion.div
                      key="sub-monthly"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.2, ease: 'easeIn' } }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      className="border-edge-faint overflow-x-auto rounded-2xl"
                    >
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-surface-elevated">
                            <th className="border-b-edge-faint w-20 px-4 py-3 text-left font-semibold text-muted-foreground">
                              Month
                            </th>
                            <th className="border-b-edge-faint px-4 py-3 text-left font-semibold text-muted-foreground">
                              Goal
                            </th>
                            <th className="border-b-edge-faint px-4 py-3 text-left font-semibold text-muted-foreground">
                              Objective
                            </th>
                            <th className="border-b-edge-faint px-4 py-3 text-left font-semibold text-muted-foreground">
                              Observation
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthData.map(({ month, pairs }, mIdx) =>
                            pairs.map((pair, pIdx) => (
                              <tr
                                key={`${mIdx}-${pIdx}`}
                                className="border-t-edge-xs hover:bg-ghost transition-colors"
                              >
                                {pIdx === 0 && (
                                  <td
                                    rowSpan={pairs.length}
                                    className="border-r-edge-faint whitespace-nowrap px-4 py-3 align-middle font-bold text-dim"
                                  >
                                    Month {month.month}
                                  </td>
                                )}
                                {pIdx === 0 && (
                                  <td
                                    rowSpan={pairs.length}
                                    className="border-r-edge-faint max-w-[160px] px-4 py-3 align-middle text-dim"
                                  >
                                    {truncate(month.goal, 42)}
                                  </td>
                                )}
                                <td className="border-r-edge-faint max-w-[160px] px-4 py-3 text-muted-foreground">
                                  {pair.label}
                                </td>
                                <td className="px-4 py-3">
                                  <ObsBadge obs={pair.observation} />
                                </td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </motion.div>
                  )}

                  {/* 3-Months chart — one bar per objective pair */}
                  {progressTab === '3months' && (
                    <motion.div
                      key="sub-3months"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.2, ease: 'easeIn' } }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    >
                      <p className="mb-4 text-center text-sm text-muted-foreground">
                        Per-objective comparison: original (Week 1&amp;2) vs follow-up (Week
                        3&amp;4)
                      </p>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart
                          data={chartData}
                          margin={{ top: 44, right: 24, left: 10, bottom: 36 }}
                          barSize={44}
                          barCategoryGap="30%"
                        >
                          {/* Month group background bands */}
                          <ReferenceArea
                            x1="1-0"
                            x2="1-1"
                            fill={CHART_BAND_COLORS[0]}
                            fillOpacity={1}
                            ifOverflow="visible"
                          />
                          <ReferenceArea
                            x1="2-0"
                            x2="2-1"
                            fill={CHART_BAND_COLORS[1]}
                            fillOpacity={1}
                            ifOverflow="visible"
                          />
                          <ReferenceArea
                            x1="3-0"
                            x2="3-1"
                            fill={CHART_BAND_COLORS[2]}
                            fillOpacity={1}
                            ifOverflow="visible"
                          />

                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="rgb(var(--edge-rgb) / 0.05)"
                          />
                          <XAxis
                            dataKey="key"
                            tick={<CustomTick />}
                            axisLine={false}
                            tickLine={false}
                            height={48}
                          />
                          <YAxis
                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v: number) => `${v}%`}
                          />
                          <ReferenceLine
                            y={0}
                            stroke="rgb(var(--edge-rgb) / 0.35)"
                            strokeWidth={2}
                          />
                          <Tooltip
                            content={<CustomTooltip />}
                            cursor={{ fill: 'rgb(var(--edge-rgb) / 0.04)' }}
                          />
                          <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                            <LabelList dataKey="score" content={<ArrowLabel />} />
                            {chartData.map((entry) => (
                              <Cell
                                key={entry.key}
                                fill={
                                  entry.isNA
                                    ? 'rgb(var(--edge-rgb) / 0.2)'
                                    : entry.score > 0
                                      ? 'hsl(var(--success-muted))'
                                      : entry.score < 0
                                        ? 'hsl(var(--error-muted))'
                                        : 'rgb(var(--edge-rgb) / 0.2)'
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="mt-1 flex justify-center gap-6">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="inline-block h-3 w-3 rounded-sm bg-success-light" />{' '}
                          Improvement
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-subtle">
                          <span className="inline-block h-3 w-3 rounded-sm bg-error-light" />
                          Decline
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-subtle">
                          <span className="bg-na-dim inline-block h-3 w-3 rounded-sm" /> N/A
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ── INSIGHTS TAB ── */}
            {activeTab === 'insights' && (
              <motion.div
                key="tab-insights"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12, transition: { duration: 0.2, ease: 'easeIn' } }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                {/* Loading */}
                {insightsLoading && (
                  <div
                    className="flex flex-col items-center gap-4 py-20"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                      className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent"
                      aria-hidden="true"
                    />
                    <p className="font-semibold text-foreground">
                      Generating personalised insights…
                    </p>
                    <p className="text-sm text-subtle">
                      Analysing {childName ? `${childName}'s` : 'the'} assessment data
                    </p>
                  </div>
                )}

                {/* Error */}
                {insightsError && !insightsLoading && (
                  <div className="flex flex-col items-center gap-4 py-16">
                    <p className="text-sm text-muted-foreground">
                      Failed to generate insights. Please try again.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setInsightsError(false);
                        setInsightsData(null);
                      }}
                      className="flex items-center gap-2 rounded-xl bg-primary-action px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-action/90"
                    >
                      <RefreshCw className="h-4 w-4" /> Retry
                    </button>
                  </div>
                )}

                {/* Empty state — no completed activities yet */}
                {insightsData && !insightsLoading && insightsData.insight_items.length === 0 && (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <p className="text-base font-semibold text-dim">No insights yet</p>
                    <p className="max-w-xs text-sm text-muted-foreground">
                      Complete at least one activity to generate personalised insights for{' '}
                      {childName ?? 'your child'}.
                    </p>
                  </div>
                )}

                {/* Insights list */}
                {insightsData && !insightsLoading && insightsData.insight_items.length > 0 && (
                  <div className="border-edge-faint divide-y divide-white/[0.04] overflow-hidden rounded-2xl">
                    {(insightsData.insight_items || []).map((itemRaw, idx) => {
                      const item = itemRaw as InsightItem;
                      const isAnomaly = item.type === 'anomaly';
                      const isExpanded = expandedInsight === idx;
                      return (
                        <motion.div
                          key={`${item.type ?? ''}-${idx}`}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, delay: idx * 0.1, ease: 'easeOut' }}
                          className={isAnomaly ? 'bg-warning-medium/[0.07]' : 'bg-card'}
                        >
                          {/* Row */}
                          <div className="flex items-center gap-3 px-5 py-4">
                            <div className="flex-shrink-0">
                              {isAnomaly ? (
                                <AlertTriangle className="h-4 w-4 text-warning-medium" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              )}
                            </div>
                            <p
                              className={`flex-1 text-sm font-medium leading-snug ${
                                isAnomaly ? 'text-warning-light' : 'text-foreground'
                              }`}
                            >
                              {item.text}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedInsight((prev) => (prev === idx ? null : idx))
                              }
                              className={`ml-2 flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                isAnomaly
                                  ? 'bg-warning-medium/10 text-warning-light hover:bg-warning-medium/20'
                                  : 'bg-primary-medium/10 text-primary-light hover:bg-primary-medium/20'
                              }`}
                            >
                              {isExpanded ? 'Hide Details' : 'View Details'}
                            </button>
                          </div>

                          {/* Expanded details */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                key="expanded"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{
                                  opacity: 1,
                                  height: 'auto',
                                  transition: {
                                    height: { duration: 0.35, ease: 'easeOut' },
                                    opacity: { duration: 0.4, ease: 'easeOut' },
                                  },
                                }}
                                exit={{
                                  opacity: 0,
                                  height: 0,
                                  transition: {
                                    height: { duration: 0.3, ease: 'easeIn' },
                                    opacity: { duration: 0.2 },
                                  },
                                }}
                                className={`overflow-hidden border-t px-5 pb-5 ${
                                  isAnomaly
                                    ? 'border-warning-medium/15 bg-warning-medium/[0.05]'
                                    : 'border-c-xs bg-ghost'
                                }`}
                              >
                                <p className="pb-4 pt-4 text-sm leading-relaxed text-muted-foreground">
                                  {item.details}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="rounded-xl bg-primary-action px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-action/90"
                                  >
                                    Start Monitoring
                                  </button>
                                  <button
                                    type="button"
                                    className="border-edge-md hover:bg-ghost-strong rounded-xl bg-subtle px-4 py-2 text-xs font-semibold text-dim transition-colors"
                                  >
                                    Check-in Later
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
