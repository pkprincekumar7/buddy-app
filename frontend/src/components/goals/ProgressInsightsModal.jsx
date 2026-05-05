import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, CheckCircle2, AlertTriangle, Clock, Lock,
  Minus, Lightbulb, BarChart3, Target, Star, RefreshCw,
} from 'lucide-react';
import { api } from '@/api/client';
import { unwrapLLM } from '@/lib/llmUtils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Cell, ResponsiveContainer, ReferenceLine, ReferenceArea, LabelList, Tooltip,
} from 'recharts';

// ── helpers ──────────────────────────────────────────────────────────────────

// Non-scorable activities have no numeric delta, so we use a fixed ±point value
// to make improvement/decline still visible on the chart.
const NON_SCORABLE_DELTA_PTS = 30;

const truncate = (str, n = 38) =>
  str && str.length > n ? str.slice(0, n - 1) + '…' : str || '';

const computeObservation = (original, followUp) => {
  if (!original) return { label: 'Not Started', type: 'notStarted' };
  if (!original.completed && !followUp?.completed)
    return { label: 'Not Started', type: 'notStarted' };
  if (original.completed && !followUp?.completed)
    return { label: 'In Progress', type: 'inProgress' };

  if (original.scorable !== false) {
    const origPct   = (original.score / 10) * 100;
    const followPct = (followUp.score / 10) * 100;
    if (origPct === 0) return { label: 'No Improvement', type: 'noImprovement' };
    if (followPct > origPct) {
      const pct = Math.round(((followPct - origPct) / origPct) * 100);
      return { label: `Improved by ${pct}%`, type: 'improved', percent: pct };
    }
    if (followPct < origPct) {
      const pct = Math.round(((origPct - followPct) / origPct) * 100);
      return { label: `Declined by ${pct}%`, type: 'declined', percent: pct };
    }
    return { label: 'No Improvement', type: 'noImprovement' };
  } else {
    // Use the LLM-computed comparison stored at follow-up completion time.
    const po = followUp.progress_observation;
    if (po === 'Improved')               return { label: 'Improved',               type: 'improved'      };
    if (po === 'Needs More Attention')   return { label: 'Needs More Attention',   type: 'declined'      };
    if (po === 'No Improvement')         return { label: 'No Improvement',         type: 'noImprovement' };
    // Fallback if the field is missing (e.g. completed before this feature)
    return { label: 'No Improvement', type: 'noImprovement' };
  }
};

const computeMonthScore = (pairs) => {
  let total = 0, count = 0;
  for (const { observation } of pairs) {
    if (observation.type === 'improved')      { total += observation.percent ?? NON_SCORABLE_DELTA_PTS; count++; }
    else if (observation.type === 'declined') { total -= observation.percent ?? NON_SCORABLE_DELTA_PTS; count++; }
    else if (observation.type === 'noImprovement') { count++; }
  }
  return count > 0 ? Math.round(total / count) : null;
};

// Maps a single pair observation to a chart score value.
// Non-scorable uses ±NON_SCORABLE_DELTA_PTS as a fixed unit so direction is still visible.
const obsToScore = (obs) => {
  if (obs.type === 'improved')      return obs.percent ?? NON_SCORABLE_DELTA_PTS;
  if (obs.type === 'declined')      return -(obs.percent ?? NON_SCORABLE_DELTA_PTS);
  if (obs.type === 'noImprovement') return 0;
  return null; // inProgress / notStarted → NA
};

// Count total completed activities in the plan — used as the staleness signature.
const completedCount = (plan) =>
  (plan?.months || []).reduce((total, month) =>
    total + (month.periods || []).reduce((mTotal, period) =>
      mTotal + (period.activities || []).filter(a => a.completed).length, 0), 0);

const buildInsightsPrompt = (childName, monthData) => {
  const name = childName || 'the child';
  const lines = [
    `Generate personalised progress insights for ${name} based on their 3-month goal plan assessments.\n`,
  ];

  monthData.forEach(({ month, pairs }) => {
    lines.push(`--- Month ${month.month}: ${month.goal} ---`);
    lines.push(`Month objective: ${month.objective}`);
    pairs.forEach((pair, pIdx) => {
      const orig = pair.original;
      const fu   = pair.followUp;
      lines.push(`\n  Objective ${pIdx + 1}: ${orig?.title || 'Unknown'}`);

      if (orig?.completed) {
        lines.push(`  Original (Week 1&2):`);
        if (orig.scorable !== false) {
          lines.push(`    Score: ${orig.score}/10`);
        } else {
          lines.push(`    Note: ${orig.note || 'none'}`);
        }
        lines.push(`    AI Feedback: ${orig.ai_feedback || 'none'}`);
        if (orig.parent_feedback) lines.push(`    Parent Feedback: ${orig.parent_feedback}`);
      } else {
        lines.push(`  Original (Week 1&2): Not completed`);
      }

      if (fu?.completed) {
        lines.push(`  Follow-up (Week 3&4): ${fu.title || 'Unknown'}`);
        if (fu.scorable !== false) {
          lines.push(`    Score: ${fu.score}/10`);
          lines.push(`    Progress: ${pair.observation.label}`);
        } else {
          lines.push(`    Note: ${fu.note || 'none'}`);
          lines.push(`    Progress: ${fu.progress_observation || 'No Improvement'}`);
        }
        lines.push(`    AI Feedback: ${fu.ai_feedback || 'none'}`);
        if (fu.parent_feedback) lines.push(`    Parent Feedback: ${fu.parent_feedback}`);
      } else {
        lines.push(`  Follow-up (Week 3&4): Not completed`);
      }
    });
    lines.push('');
  });

  lines.push(`Based on the data above, provide all of the following:`);
  lines.push(`1. overall_summary: 2–3 sentences personalised to ${name}'s specific results, referencing actual activities and outcomes. Be warm and encouraging.`);
  lines.push(`2. monthly_insights: An array of 3 objects, one per month. Each has "month" (1/2/3) and "insight" (1–2 sentences specific to that month's actual data).`);
  lines.push(`3. recommendations: An array of 3–5 specific, actionable strings tailored to this child's strengths and areas needing attention.`);
  lines.push(`4. strongest_area: A short phrase naming the activity or skill where ${name} showed the most progress (null if insufficient data).`);
  lines.push(`5. focus_area: A short phrase naming the activity or skill that needs the most attention going forward (null if insufficient data).`);

  return lines.join('\n');
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
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-lg text-sm max-w-[200px]">
      <p className="font-semibold text-slate-700 leading-snug mb-0.5 break-words">{entry.fullLabel}</p>
      <p className="text-slate-400 text-xs">Month {entry.monthNum} · Activity {entry.actIdx + 1}</p>
      <p className={`font-medium mt-1 ${obsColor}`}>{entry.obsLabel}</p>
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

export default function ProgressInsightsModal({ goalPlan, childName, onPlanUpdate, onClose }) {
  const [activeTab,      setActiveTab]      = useState('progress');
  const [progressTab,    setProgressTab]    = useState('monthly');
  const [insightsData,   setInsightsData]   = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError,  setInsightsError]  = useState(false);

  const monthData = useMemo(() => {
    return (goalPlan?.months || []).map(month => {
      const pairs = [0, 1].map(actIdx => {
        const original = month.periods?.[0]?.activities?.[actIdx];
        const followUp = month.periods?.[1]?.activities?.[actIdx];
        return {
          original,
          followUp,
          label:       truncate(original?.title || `Activity ${actIdx + 1}`),
          scorable:    original?.scorable !== false,
          observation: computeObservation(original, followUp),
        };
      });
      return { month, pairs, score: computeMonthScore(pairs) };
    });
  }, [goalPlan]);

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
    if (activeTab !== 'insights' || insightsData || insightsLoading) return;

    const currentCount = completedCount(goalPlan);

    // Valid cached insights exist and match the current completion state → reuse.
    if (goalPlan?.insights && goalPlan?.insights_signature === currentCount) {
      setInsightsData(goalPlan.insights);
      return;
    }

    // No valid cache — generate fresh insights.
    const generate = async () => {
      setInsightsLoading(true);
      setInsightsError(false);
      try {
        const prompt = buildInsightsPrompt(childName, monthData);
        const result = await api.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: {
            type: 'object',
            properties: {
              overall_summary:  { type: 'string' },
              monthly_insights: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    month:   { type: 'number' },
                    insight: { type: 'string' },
                  },
                },
              },
              recommendations: { type: 'array', items: { type: 'string' } },
              strongest_area:  { type: 'string' },
              focus_area:      { type: 'string' },
            },
          },
        });
        const data = result.properties ?? result;
        const payload = {
          overall_summary:  unwrapLLM(data.overall_summary)  || '',
          monthly_insights: Array.isArray(data.monthly_insights) ? data.monthly_insights : [],
          recommendations:  Array.isArray(data.recommendations)  ? data.recommendations  : [],
          strongest_area:   unwrapLLM(data.strongest_area) || null,
          focus_area:       unwrapLLM(data.focus_area)     || null,
        };

        // Persist insights + signature into the plan so future opens skip the LLM call.
        const updatedPlan = { ...goalPlan, insights: payload, insights_signature: currentCount };
        try {
          await api.goals.patch({ plan: updatedPlan });
          onPlanUpdate?.(updatedPlan);
        } catch {
          // Save failure is non-fatal — insights still show for this session.
        }

        setInsightsData(payload);
      } catch {
        setInsightsError(true);
      }
      setInsightsLoading(false);
    };
    generate();
  // goalPlan/childName/monthData are intentionally omitted from deps: insights
  // should only regenerate when the tab is opened fresh or the user retries, not
  // on every plan mutation. The insights_signature cache-bust handles staleness
  // when the modal is reopened after new activities are completed.
  }, [activeTab, insightsData, insightsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthColors = [
    { bg: 'bg-teal-50 border-teal-100',    title: 'text-teal-800',   badge: 'text-teal-400' },
    { bg: 'bg-blue-50 border-blue-100',    title: 'text-blue-800',   badge: 'text-blue-400' },
    { bg: 'bg-purple-50 border-purple-100', title: 'text-purple-800', badge: 'text-purple-400' },
  ];

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
        className="bg-white rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
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
        <div className="flex border-b border-slate-100 px-6 pt-3 flex-shrink-0 bg-white">
          {[['progress', 'Progress'], ['insights', 'Insights']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`pb-3 px-5 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-teal-500 text-teal-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
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
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Monthly table */}
              {progressTab === 'monthly' && (
                <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 w-20 border-b border-slate-100">Month</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 border-b border-slate-100">Goal</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 border-b border-slate-100">Objective</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 border-b border-slate-100">Observation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthData.map(({ month, pairs }, mIdx) =>
                        pairs.map((pair, pIdx) => (
                          <tr
                            key={`${mIdx}-${pIdx}`}
                            className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors"
                          >
                            {pIdx === 0 && (
                              <td
                                rowSpan={pairs.length}
                                className="px-4 py-3 font-bold text-slate-700 align-middle border-r border-slate-100 whitespace-nowrap"
                              >
                                Month {month.month}
                              </td>
                            )}
                            {pIdx === 0 && (
                              <td
                                rowSpan={pairs.length}
                                className="px-4 py-3 text-slate-700 align-middle border-r border-slate-100 max-w-[160px]"
                              >
                                {truncate(month.goal, 42)}
                              </td>
                            )}
                            <td className="px-4 py-3 text-slate-600 border-r border-slate-100 max-w-[160px]">
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
                  <p className="text-sm text-slate-500 mb-4 text-center">
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
                      <ReferenceArea x1="1-0" x2="1-1" fill="#f0fdf9" fillOpacity={0.8} ifOverflow="visible" />
                      <ReferenceArea x1="2-0" x2="2-1" fill="#eff6ff" fillOpacity={0.8} ifOverflow="visible" />
                      <ReferenceArea x1="3-0" x2="3-1" fill="#faf5ff" fillOpacity={0.8} ifOverflow="visible" />

                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
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
                      <span className="w-3 h-3 rounded-sm bg-slate-200 inline-block" /> N/A
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
                  <p className="text-slate-600 font-semibold">Generating personalised insights…</p>
                  <p className="text-slate-400 text-sm">Analysing {childName ? `${childName}'s` : 'the'} assessment data</p>
                </div>
              )}

              {/* Error */}
              {insightsError && !insightsLoading && (
                <div className="py-16 flex flex-col items-center gap-4">
                  <p className="text-slate-500 text-sm">Failed to generate insights. Please try again.</p>
                  <button
                    onClick={() => { setInsightsError(false); setInsightsData(null); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 text-white text-sm font-semibold hover:bg-teal-600 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                </div>
              )}

              {/* Insights content */}
              {insightsData && !insightsLoading && (
                <div className="space-y-5">
                  {/* Overall summary */}
                  <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-5 h-5 text-teal-600" />
                      <h3 className="font-bold text-teal-800">Overall Summary</h3>
                    </div>
                    <p className="text-slate-600 text-sm leading-relaxed">{insightsData.overall_summary}</p>
                  </div>

                  {/* Strongest / Focus area highlights */}
                  {(insightsData.strongest_area || insightsData.focus_area) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {insightsData.strongest_area && (
                        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex gap-3 items-start">
                          <Star className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-0.5">Strongest Area</p>
                            <p className="text-slate-700 text-sm font-medium">{insightsData.strongest_area}</p>
                          </div>
                        </div>
                      )}
                      {insightsData.focus_area && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 items-start">
                          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-0.5">Needs Focus</p>
                            <p className="text-slate-700 text-sm font-medium">{insightsData.focus_area}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Per-month insights */}
                  {insightsData.monthly_insights?.map((mi, mIdx) => {
                    const c = monthColors[mIdx] || monthColors[0];
                    const md = monthData.find(m => m.month.month === mi.month);
                    return (
                      <div key={mIdx} className={`border rounded-2xl p-5 ${c.bg}`}>
                        <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${c.badge}`}>Month {mi.month}</p>
                        {md && <h4 className={`font-bold text-sm mb-2 ${c.title}`}>{md.month.goal}</h4>}
                        <p className="text-slate-600 text-sm leading-relaxed">{mi.insight}</p>
                      </div>
                    );
                  })}

                  {/* Recommendations */}
                  {insightsData.recommendations?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Lightbulb className="w-5 h-5 text-amber-500" />
                        <h3 className="font-bold text-amber-800">Recommendations</h3>
                      </div>
                      <ul className="space-y-2.5">
                        {insightsData.recommendations.map((rec, idx) => (
                          <li key={idx} className="text-sm text-slate-600 flex gap-2">
                            <span className="text-amber-500 flex-shrink-0 mt-0.5">•</span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
