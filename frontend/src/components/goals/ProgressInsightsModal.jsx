import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, CheckCircle2, AlertTriangle, Clock, Lock,
  Minus, BarChart3, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Cell, ResponsiveContainer, ReferenceLine, ReferenceArea, LabelList, Tooltip,
} from 'recharts';
import { api } from '@/api/client';
import {
  INSIGHTS_SCHEMA_VERSION, NON_SCORABLE_DELTA_PTS,
  truncate, buildMonthData, completedCount, generateInsights,
} from '@/lib/insightsUtils';

// Maps a single pair observation to a chart score value.
// Non-scorable uses ±NON_SCORABLE_DELTA_PTS as a fixed unit so direction is still visible.
const obsToScore = (obs) => {
  if (obs.type === 'improved')      return obs.percent ?? NON_SCORABLE_DELTA_PTS;
  if (obs.type === 'declined')      return -(obs.percent ?? NON_SCORABLE_DELTA_PTS);
  if (obs.type === 'noImprovement') return 0;
  return null; // inProgress / notStarted → NA
};

// ── sub-components ────────────────────────────────────────────────────────────

const ObsBadge = ({ obs }) => {
  const cfg = {
    improved:      { cls: 'text-emerald-700', icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" /> },
    declined:      { cls: 'text-amber-700',   icon: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" /> },
    noImprovement: { cls: 'text-slate-500',   icon: <Minus className="w-4 h-4 text-slate-400 flex-shrink-0" /> },
    inProgress:    { cls: 'text-blue-600',    icon: <Clock className="w-4 h-4 text-blue-400 flex-shrink-0" /> },
    notStarted:    { cls: 'text-slate-400',   icon: <Lock className="w-4 h-4 text-slate-300 flex-shrink-0" /> },
  };
  const { cls, icon } = cfg[obs.type] || cfg.notStarted;
  return (
    <span className={`flex items-center gap-1.5 font-medium text-sm ${cls}`}>
      {icon}{obs.label}
    </span>
  );
};

const ArrowLabel = ({ x, y, width, height, value }) => {
  if (value === null || value === undefined) return null;
  if (value === 0) return (
    <text x={x + width / 2} y={y - 8} textAnchor="middle" fill="#94a3b8" fontSize={18} fontWeight="bold">–</text>
  );
  const isUp   = value > 0;
  const labelY = isUp ? y - 10 : y + Math.abs(height) + 18;
  return (
    <text x={x + width / 2} y={labelY} textAnchor="middle"
          fill={isUp ? '#10b981' : '#f87171'} fontSize={22} fontWeight="bold">
      {isUp ? '↑' : '↓'}
    </text>
  );
};

// Two-level X-axis tick: activity label on line 1, "Month X" centred over the
// pair on line 2 (shown only for the first bar in each month group).
const buildCustomTick = (chartData) => function CustomTick({ x, y, payload }) {
  const entry = chartData.find(d => d.key === payload.value);
  if (!entry) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} dy={14} textAnchor="middle" fill="#475569" fontSize={11}>
        A{entry.actIdx + 1}
      </text>
      {entry.actIdx === 0 && (
        <text x={48} dy={28} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={700}>
          Month {entry.monthNum}
        </text>
      )}
    </g>
  );
};

const buildCustomTooltip = (chartData) => function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  const obsColor =
    entry.obsType === 'improved'      ? 'text-emerald-600' :
    entry.obsType === 'declined'      ? 'text-red-500'     :
    entry.obsType === 'noImprovement' ? 'text-slate-500'   : 'text-blue-500';
  return (
    <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-xl px-3 py-2.5 shadow-lg text-sm max-w-[200px]">
      <p className="font-semibold text-white leading-snug mb-0.5 break-words">{entry.fullLabel}</p>
      <p className="text-slate-500 text-xs">Month {entry.monthNum} · Activity {entry.actIdx + 1}</p>
      <p className={`font-medium mt-1 ${obsColor}`}>{entry.obsLabel}</p>
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

export default function ProgressInsightsModal({ goalPlan, childName, onPlanUpdate, onClose }) {
  const [activeTab,        setActiveTab]        = useState('progress');
  const [progressTab,      setProgressTab]      = useState('monthly');
  const [expandedInsight,  setExpandedInsight]  = useState(null);
  const [insightsData,     setInsightsData]     = useState(null);
  const [insightsLoading,  setInsightsLoading]  = useState(false);
  const [insightsError,    setInsightsError]    = useState(false);

  const monthData = useMemo(() => buildMonthData(goalPlan), [goalPlan]);

  // 6 entries — one per objective pair — grouped visually by month
  const chartData = useMemo(() =>
    monthData.flatMap(({ month, pairs }) =>
      pairs.map((pair, pIdx) => {
        const raw = obsToScore(pair.observation);
        return {
          key:       `${month.month}-${pIdx}`,
          monthNum:  month.month,
          actIdx:    pIdx,
          fullLabel: pair.label,
          score:     raw ?? 0,
          isNA:      raw === null,
          obsType:   pair.observation.type,
          obsLabel:  pair.observation.label,
        };
      })
    )
  , [monthData]);

  const CustomTick    = useMemo(() => buildCustomTick(chartData),    [chartData]);
  const CustomTooltip = useMemo(() => buildCustomTooltip(chartData), [chartData]);

  useEffect(() => {
    if (activeTab !== 'insights' || insightsData || insightsLoading || insightsError) return;

    const currentCount = completedCount(goalPlan);

    // Valid cache: same schema version and generated after the last completed activity.
    if (
      goalPlan?.insights?.schema_version === INSIGHTS_SCHEMA_VERSION &&
      goalPlan?.insights_signature === currentCount
    ) {
      setInsightsData(goalPlan.insights);
      return;
    }

    // Stale or missing — generate via LLM, then persist.
    const generate = async () => {
      setInsightsLoading(true);
      setInsightsError(false);
      try {
        const payload = await generateInsights(childName, goalPlan);
        const updatedPlan = { ...goalPlan, insights: payload, insights_signature: currentCount };
        try {
          await api.goals.patch({ plan: updatedPlan });
          onPlanUpdate?.(updatedPlan);
        } catch {
          // Save failure is non-fatal — insights still display for this session.
        }
        setInsightsData(payload);
      } catch {
        setInsightsError(true);
      }
      setInsightsLoading(false);
    };
    generate();
  // goalPlan/childName are intentionally omitted: re-generation is driven by
  // insightsData being reset (e.g. on retry), not by every prop change.
  }, [activeTab, insightsData, insightsLoading, insightsError]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-[#141414] rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-white/[0.08]"
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-teal-400 to-emerald-500 px-6 py-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-xl">Progress & Insights</h2>
              <p className="text-white/80 text-sm">3-Month Growth Overview</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Top-level tabs */}
        <div className="flex border-b border-white/[0.06] px-6 pt-3 flex-shrink-0 bg-[#141414]">
          {[['progress', 'Progress'], ['insights', 'Insights']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`pb-3 px-5 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-teal-500 text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── PROGRESS TAB ── */}
          {activeTab === 'progress' && (
            <div>
              <div className="flex gap-2 mb-5">
                {[['monthly', 'Monthly'], ['3months', '3-Months']].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setProgressTab(key)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      progressTab === key
                        ? 'bg-teal-500 text-white shadow-sm'
                        : 'bg-white/[0.06] text-slate-400 hover:bg-white/[0.10]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Monthly table */}
              {progressTab === 'monthly' && (
                <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#1a1a1a]">
                        <th className="px-4 py-3 text-left font-semibold text-slate-400 w-20 border-b border-white/[0.06]">Month</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-400 border-b border-white/[0.06]">Goal</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-400 border-b border-white/[0.06]">Objective</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-400 border-b border-white/[0.06]">Observation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthData.map(({ month, pairs }, mIdx) =>
                        pairs.map((pair, pIdx) => (
                          <tr
                            key={`${mIdx}-${pIdx}`}
                            className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                          >
                            {pIdx === 0 && (
                              <td
                                rowSpan={pairs.length}
                                className="px-4 py-3 font-bold text-slate-300 align-middle border-r border-white/[0.06] whitespace-nowrap"
                              >
                                Month {month.month}
                              </td>
                            )}
                            {pIdx === 0 && (
                              <td
                                rowSpan={pairs.length}
                                className="px-4 py-3 text-slate-300 align-middle border-r border-white/[0.06] max-w-[160px]"
                              >
                                {truncate(month.goal, 42)}
                              </td>
                            )}
                            <td className="px-4 py-3 text-slate-400 border-r border-white/[0.06] max-w-[160px]">
                              {pair.label}
                            </td>
                            <td className="px-4 py-3">
                              <ObsBadge obs={pair.observation} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 3-Months chart — one bar per objective pair */}
              {progressTab === '3months' && (
                <div>
                  <p className="text-sm text-slate-400 mb-4 text-center">
                    Per-objective comparison: original (Week 1&amp;2) vs follow-up (Week 3&amp;4)
                  </p>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 44, right: 24, left: 10, bottom: 36 }}
                      barSize={44}
                      barCategoryGap="30%"
                    >
                      {/* Month group background bands */}
                      <ReferenceArea x1="1-0" x2="1-1" fill="rgba(20,255,160,0.03)" fillOpacity={1} ifOverflow="visible" />
                      <ReferenceArea x1="2-0" x2="2-1" fill="rgba(60,120,255,0.03)" fillOpacity={1} ifOverflow="visible" />
                      <ReferenceArea x1="3-0" x2="3-1" fill="rgba(160,60,255,0.03)" fillOpacity={1} ifOverflow="visible" />

                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="key"
                        tick={<CustomTick />}
                        axisLine={false}
                        tickLine={false}
                        height={48}
                      />
                      <YAxis
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => `${v}%`}
                      />
                      <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={2} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                      <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                        <LabelList dataKey="score" content={<ArrowLabel />} />
                        {chartData.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={
                              entry.isNA    ? '#e2e8f0' :
                              entry.score > 0 ? '#6ee7b7' :
                              entry.score < 0 ? '#fca5a5' : '#e2e8f0'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-6 mt-1">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-sm bg-emerald-300 inline-block" /> Improvement
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-sm bg-red-300 inline-block" /> Decline
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-sm bg-white/[0.15] inline-block" /> N/A
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── INSIGHTS TAB ── */}
          {activeTab === 'insights' && (
            <div>
              {/* Loading */}
              {insightsLoading && (
                <div className="py-20 flex flex-col items-center gap-4">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                    className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full"
                  />
                  <p className="text-white font-semibold">Generating personalised insights…</p>
                  <p className="text-slate-500 text-sm">Analysing {childName ? `${childName}'s` : 'the'} assessment data</p>
                </div>
              )}

              {/* Error */}
              {insightsError && !insightsLoading && (
                <div className="py-16 flex flex-col items-center gap-4">
                  <p className="text-slate-400 text-sm">Failed to generate insights. Please try again.</p>
                  <button
                    onClick={() => { setInsightsError(false); setInsightsData(null); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 text-white text-sm font-semibold hover:bg-teal-600 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                </div>
              )}

              {/* Insights list */}
              {insightsData && !insightsLoading && (
                <div className="border border-white/[0.06] rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
                  {(insightsData.insight_items || []).map((item, idx) => {
                    const isAnomaly  = item.type === 'anomaly';
                    const isExpanded = expandedInsight === idx;
                    return (
                      <div key={idx} className={isAnomaly ? 'bg-amber-500/[0.07]' : 'bg-[#141414]'}>
                        {/* Row */}
                        <div className="flex items-center gap-3 px-5 py-4">
                          <div className="flex-shrink-0">
                            {isAnomaly
                              ? <AlertTriangle className="w-4 h-4 text-amber-500" />
                              : <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            }
                          </div>
                          <p className={`flex-1 text-sm font-medium leading-snug ${
                            isAnomaly ? 'text-amber-300' : 'text-slate-300'
                          }`}>
                            {item.text}
                          </p>
                          <button
                            onClick={() => setExpandedInsight(prev => prev === idx ? null : idx)}
                            className={`ml-2 flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              isAnomaly
                                ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                                : 'bg-teal-500/10 text-teal-400 hover:bg-teal-500/20'
                            }`}
                          >
                            {isExpanded ? 'Hide Details' : 'View Details'}
                          </button>
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className={`px-5 pb-5 border-t ${
                              isAnomaly ? 'border-amber-500/15 bg-amber-500/[0.05]' : 'border-white/[0.04] bg-white/[0.02]'
                            }`}
                          >
                            <p className="text-sm text-slate-400 leading-relaxed pt-4 pb-4">
                              {item.details}
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              <button className="px-4 py-2 bg-teal-500 text-white text-xs font-semibold rounded-xl hover:bg-teal-600 transition-colors">
                                Start Monitoring
                              </button>
                              <button className="px-4 py-2 bg-white/[0.05] border border-white/[0.10] text-slate-300 text-xs font-semibold rounded-xl hover:bg-white/[0.08] transition-colors">
                                Check-in Later
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
