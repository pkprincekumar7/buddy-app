import { useState, useEffect, useCallback, useMemo } from 'react';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { TrendingUp, Sparkles, ChevronRight, Award, Target, CheckCircle, X } from 'lucide-react';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { useLifePathwayData } from '@/hooks/useLifePathwayData';
import { SPINNER, MODAL_BACKDROP, MODAL_SCALE, slideUp } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';
import StartOverButton from '@/components/shared/StartOverButton';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Hex values kept for recharts SVG strokes and chart dot fills.
const areaColors = {
  life_ambition: '#8b5cf6',
  self_care: '#ec4899',
  critical_thinking: '#3b82f6',
  creativity: '#f59e0b',
  physical_wellness: '#10b981',
  social_skills: '#7c3aed',
};

// Tailwind bg classes for CSS (non-SVG) elements — avoids inline backgroundColor styles.
const areaBgTw = {
  life_ambition: 'bg-violet-500',
  self_care: 'bg-pink-500',
  critical_thinking: 'bg-blue-500',
  creativity: 'bg-amber-400',
  physical_wellness: 'bg-emerald-500',
  social_skills: 'bg-violet-600',
};

// Milestone events per growth area mapped to journey years
const areaMilestoneMap = {
  life_ambition: [
    { yearOffset: 0, text: 'Life ambition clarified' },
    { yearOffset: 3, text: 'Career path explored' },
    { yearOffset: 7, text: 'Purpose solidified' },
  ],
  self_care: [
    { yearOffset: 0, text: 'Self-care habits formed' },
    { yearOffset: 4, text: 'Emotional resilience built' },
    { yearOffset: 8, text: 'Lifelong wellness achieved' },
  ],
  critical_thinking: [
    { yearOffset: 0, text: 'Problem-solving enhanced' },
    { yearOffset: 4, text: 'Analytical thinking mastered' },
    { yearOffset: 9, text: 'Strategic mindset developed' },
  ],
  creativity: [
    { yearOffset: 0, text: 'Creative confidence unlocked' },
    { yearOffset: 5, text: 'Artistic expression flourishing' },
    { yearOffset: 9, text: 'Innovation mindset instilled' },
  ],
  physical_wellness: [
    { yearOffset: 0, text: 'Healthy habits started' },
    { yearOffset: 3, text: 'Physical goals achieved' },
    { yearOffset: 7, text: 'Lifelong fitness culture' },
  ],
  social_skills: [
    { yearOffset: 0, text: 'Communication skills built' },
    { yearOffset: 4, text: 'Leadership emerging' },
    { yearOffset: 8, text: 'Strong social network' },
  ],
};

function getAreaBoost(area: Record<string, unknown>) {
  const answers = (area['answers'] as Record<string, unknown> | undefined) ?? {};
  const answerCount = Object.values(answers).filter(Boolean).length;
  const aiRecs = area['ai_three_month_recommendations'];
  const recs: unknown[] =
    Array.isArray(aiRecs) && aiRecs.length > 0
      ? aiRecs
      : Array.isArray(area['recommendations'])
        ? (area['recommendations'] as unknown[])
        : [];
  return 5 + answerCount * 0.8 + (recs.length > 0 ? 2 : 0);
}

// Defined at module level so React never sees a new component type between renders.
// milestoneAgeColorMap is passed as a prop because recharts forwards custom props to dot components.
function CustomDot({
  cx = 0,
  cy = 0,
  payload,
  milestoneAgeColorMap,
}: {
  cx?: number;
  cy?: number;
  payload?: Record<string, unknown>;
  milestoneAgeColorMap: Record<number, string>;
}) {
  const color = milestoneAgeColorMap?.[payload?.['age'] as number];
  return color ? (
    <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />
  ) : (
    <circle cx={cx} cy={cy} r={4} fill="#10b981" />
  );
}

export default function LifePathway() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user } = useAuth();
  const { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern } =
    useLifePathwayData(childId);
  const childName = (childData?.['name'] as string | undefined) ?? '';
  const [showSplash, startTimer] = useStageSplash();

  const [showConcernModal, setShowConcernModal] = useState(false);
  const [concernInput, setConcernInput] = useState('');
  const [concernSubmitted, setConcernSubmitted] = useState(false);

  const closeConcernModal = useCallback(() => {
    setShowConcernModal(false);
    setConcernSubmitted(false);
    setConcernInput('');
  }, []);

  // Escape key to close modal.
  useEffect(() => {
    if (!showConcernModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConcernModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showConcernModal, closeConcernModal]);

  // On bfcache restore (Back from GoalsDashboard), close any open modal.
  // Also calls closeConcernModal on component unmount via the cleanup.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) closeConcernModal();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      closeConcernModal();
    };
  }, [closeConcernModal]);

  const handleStartJourney = () => {
    if (savedConcern) {
      navigate(`/GoalsDashboard/${childId}`);
      return;
    }
    setShowConcernModal(true);
  };

  const handleConcernSubmit = useCallback(async () => {
    const activeChildId = childData?.['id'] as string | undefined;
    if (!concernInput.trim() || !activeChildId) return;
    try {
      await api.goals.patch(activeChildId, { parent_concern: concernInput.trim() });
      setSavedConcern(concernInput.trim());
    } catch (err) {
      console.warn('[LifePathway] Could not persist concern, proceeding anyway:', err);
    }
    setConcernSubmitted(true);
  }, [childData, concernInput, setSavedConcern]);

  const handleProceedToDashboard = () => {
    closeConcernModal();
    navigate(`/GoalsDashboard/${childId}`);
  };

  const handleBack = () => navigate(`/GrowthAreas/${childId}`, { state: { fromBack: true } });

  const strengths = useMemo(
    () =>
      (profile?.top_strengths as string[] | undefined) ?? [
        'Creative problem solver',
        'Strong leadership qualities',
        'Excellent communication skills',
      ],
    [profile],
  );

  const currentAge = useMemo(
    () => parseInt(String((childData?.['age'] as string | number | null | undefined) ?? '')) || 10,
    [childData],
  );

  const journeyData = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => {
        const age = currentAge + i;
        const point: Record<string, number | string> = {
          age,
          year: `Age ${age}`,
          standard: Math.min(40 + i * 4, 100),
        };
        if (completedAreas.length > 0) {
          completedAreas.forEach((area) => {
            const boost = getAreaBoost(area);
            const areaId = area['area_id'];
            if (areaId) point[areaId] = Math.min(Math.round(40 + i * boost + i * i * 0.25), 100);
          });
        } else {
          point['buddy360'] = Math.min(Math.round(40 + i * 6.5 + i * i * 0.3), 100);
        }
        return point;
      }),
    [completedAreas, currentAge],
  );

  const standardMilestones = useMemo(
    () => [
      { age: currentAge, text: 'Basic education foundation' },
      { age: currentAge + 3, text: 'Intermediate skills developed' },
      { age: currentAge + 6, text: 'Advanced academic progress' },
      { age: currentAge + 10, text: 'College preparation' },
    ],
    [currentAge],
  );

  const buddy360Milestones = useMemo(
    () =>
      completedAreas.length > 0
        ? completedAreas
            .flatMap((area) => {
              const areaId = area.area_id;
              const areaName = area.area_name;
              const milestones: { yearOffset: number; text: string }[] =
                (areaId
                  ? (areaMilestoneMap as Record<string, { yearOffset: number; text: string }[]>)[
                      areaId
                    ]
                  : undefined) ?? [];
              return milestones.map((m) => ({
                age: currentAge + m.yearOffset,
                text: m.text,
                area: areaName ?? '',
                color:
                  (areaId ? (areaColors as Record<string, string>)[areaId] : undefined) ??
                  '#10b981',
              }));
            })
            .sort((a, b) => a.age - b.age)
        : [
            {
              age: currentAge,
              text: 'Personalized profile created',
              area: 'Core',
              color: '#10b981',
            },
            {
              age: currentAge + 1,
              text: 'Core strengths identified & enhanced',
              area: 'Core',
              color: '#10b981',
            },
            {
              age: currentAge + 2,
              text: 'Weekly missions mastered',
              area: 'Core',
              color: '#10b981',
            },
            {
              age: currentAge + 5,
              text: 'Multiple talents developed',
              area: 'Core',
              color: '#10b981',
            },
            {
              age: currentAge + 7,
              text: 'Character strengths solidified',
              area: 'Core',
              color: '#10b981',
            },
            {
              age: currentAge + 10,
              text: 'Ready for exceptional future',
              area: 'Core',
              color: '#10b981',
            },
          ],
    [completedAreas, currentAge],
  );

  const milestoneAgeColorMap = useMemo(
    () =>
      buddy360Milestones.reduce<Record<number, string>>((acc, m) => {
        acc[m.age] ??= m.color;
        return acc;
      }, {}),
    [buddy360Milestones],
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoading ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-12 w-12 rounded-full border-4 border-teal-500 border-t-transparent"
            />
          </div>
        ) : (
          <div key={showSplash ? 'splash' : 'content'} className="min-h-screen bg-background">
            <div className="mx-auto max-w-6xl px-4 py-12">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="space-y-8"
              >
                {/* Header */}
                <motion.div {...slideUp(0.1)} className="space-y-4 text-center">
                  <div className="glow-teal-sm mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600">
                    <TrendingUp className="h-8 w-8 text-white" />
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                    Take a look at {childName}'s life journey planned and powered by Buddy360
                  </h1>
                  {completedAreas.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 pt-2">
                      {completedAreas.map((area) => (
                        <span
                          key={area.area_id ?? area.area_name}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-white',
                            (area.area_id && (areaBgTw as Record<string, string>)[area.area_id]) ??
                              'bg-emerald-500',
                          )}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          {area.area_name}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>

                {/* Chart */}
                <motion.div
                  {...slideUp(0.8)}
                  className="border-edge rounded-2xl bg-card p-6 md:p-8"
                >
                  <div className="mb-6 text-center">
                    <h2 className="mb-2 text-2xl font-bold tracking-tight text-white md:text-3xl">
                      10-Year Growth Journey Comparison
                    </h2>
                    <p className="text-slate-400">
                      See how {childName}'s development accelerates with Buddy360
                      {completedAreas.length > 0 &&
                        ` across ${completedAreas.length} growth area${completedAreas.length > 1 ? 's' : ''}`}
                    </p>
                  </div>

                  <div className="mb-6 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={journeyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="year" stroke="#475569" style={{ fontSize: '12px' }} />
                        <YAxis
                          stroke="#475569"
                          style={{ fontSize: '12px' }}
                          label={{
                            value: 'Growth Level',
                            angle: -90,
                            position: 'insideLeft',
                            style: { fontSize: '12px', fill: '#475569' },
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1a1a1a',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '12px',
                            padding: '12px',
                            color: '#e2e8f0',
                          }}
                          formatter={(value, name) => [`${String(value)}%`, name]}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Line
                          type="monotone"
                          dataKey="standard"
                          stroke="#94a3b8"
                          strokeWidth={3}
                          name="Standard Journey"
                          dot={{ fill: '#94a3b8', r: 4 }}
                        />
                        {completedAreas.length > 0 ? (
                          completedAreas.map((area) => (
                            <Line
                              key={area.area_id ?? area.area_name}
                              type="monotone"
                              dataKey={area.area_id ?? ''}
                              stroke={
                                (area.area_id &&
                                  (areaColors as Record<string, string>)[area.area_id]) ??
                                '#10b981'
                              }
                              strokeWidth={3}
                              name={`${area.area_name ?? ''} (Buddy360)`}
                              dot={<CustomDot milestoneAgeColorMap={milestoneAgeColorMap} />}
                            />
                          ))
                        ) : (
                          <Line
                            type="monotone"
                            dataKey="buddy360"
                            stroke="#10b981"
                            strokeWidth={3}
                            name="Buddy360 Journey"
                            dot={<CustomDot milestoneAgeColorMap={milestoneAgeColorMap} />}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Milestone Legend */}
                  {buddy360Milestones.length > 0 && (
                    <div className="border-edge-faint mb-6 rounded-xl bg-surface-elevated p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                        ● Milestone markers on the Buddy360 line
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {buddy360Milestones.map((m) => (
                          <div
                            key={`${m.age}-${m.text}`}
                            className="flex items-center gap-2 text-sm text-slate-400"
                          >
                            <span
                              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: m.color }}
                            />
                            <span className="w-14 flex-shrink-0 font-medium text-slate-300">
                              Age {m.age}
                            </span>
                            <span className="text-xs">{m.text}</span>
                            {m.area !== 'Core' && (
                              <span
                                className="ml-auto flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs text-white"
                                style={{ backgroundColor: m.color }}
                              >
                                {m.area}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Journey Details Grid */}
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* Standard Journey */}
                    <div className="space-y-4">
                      <div className="mb-4 flex items-center gap-2">
                        <span className="bg-ghost-strong inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-slate-300">
                          1
                        </span>
                        <h3 className="text-lg font-bold text-white">Standard Life Journey</h3>
                      </div>
                      <div className="border-edge-faint rounded-xl bg-surface-elevated p-4">
                        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                          <Sparkles className="h-4 w-4 text-slate-400" />
                          The Analysis
                        </h4>
                        <p className="text-sm text-slate-400">
                          {profile?.summary ??
                            `${childName} shows natural growth through standard educational pathways with typical developmental milestones.`}
                        </p>
                      </div>
                      <div className="border-edge-faint rounded-xl bg-surface-elevated p-4">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                          <Target className="h-4 w-4 text-slate-400" />
                          Key Milestones
                        </h4>
                        <div className="space-y-2.5">
                          {standardMilestones.map((milestone) => (
                            <div key={milestone.text} className="flex items-start gap-3">
                              <div className="w-14 flex-shrink-0 text-xs font-medium text-slate-500">
                                Age {milestone.age}
                              </div>
                              <div className="flex-1 text-xs text-slate-400">{milestone.text}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Buddy360 Journey */}
                    <div className="space-y-4">
                      <div className="mb-4 flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-sm font-bold text-white">
                          2
                        </span>
                        <h3 className="text-lg font-bold text-white">
                          {childName}'s Journey with Buddy360
                        </h3>
                      </div>

                      <div className="bg-brand-teal rounded-xl border border-teal-500/20 p-4">
                        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-teal-400">
                          <Sparkles className="h-4 w-4" />
                          Analysis
                        </h4>
                        <p className="text-sm text-slate-400">
                          {profile?.summary ??
                            `${childName} experiences accelerated holistic growth through personalized guidance, targeted skill development, and continuous support.`}
                          {completedAreas.length > 0 &&
                            ` Development is boosted across ${completedAreas.map((a) => a.area_name).join(', ')}.`}
                        </p>
                      </div>

                      <div className="bg-brand-teal rounded-xl border border-teal-500/20 p-4">
                        <h4 className="mb-2 text-sm font-semibold text-teal-400">
                          Strengths Improvised by Buddy360
                        </h4>
                        <ul className="space-y-1.5">
                          {strengths.map((strength) => (
                            <li
                              key={strength}
                              className="flex items-start gap-2 text-sm text-slate-400"
                            >
                              <span className="mt-0.5 text-teal-400">✓</span>
                              <span>{strength}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-brand-teal rounded-xl border border-teal-500/20 p-4">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-teal-400">
                          <Award className="h-4 w-4" />
                          Accomplishments & Milestones
                        </h4>
                        <div className="space-y-2.5">
                          {buddy360Milestones.map((milestone) => (
                            <div
                              key={`${milestone.age}-${milestone.text}`}
                              className="flex items-start gap-3"
                            >
                              <div className="w-14 flex-shrink-0 text-xs font-medium text-teal-500">
                                Age {milestone.age}
                              </div>
                              <div className="flex-1 text-xs font-medium text-slate-300">
                                {milestone.text}
                              </div>
                              {milestone.area !== 'Core' && (
                                <span
                                  className="flex-shrink-0 self-start rounded-full px-1.5 py-0.5 text-xs text-white"
                                  style={{ backgroundColor: milestone.color }}
                                >
                                  {milestone.area}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Per-Growth-Area Detail Sections */}
                {completedAreas.length > 0 && (
                  <motion.div {...slideUp(1.6)} className="space-y-4">
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Growth Area Insights
                    </h2>
                    <p className="text-slate-400">Recommendations for each area for {childName}</p>

                    {completedAreas.map((area, idx) => {
                      const bgTw =
                        (area.area_id && (areaBgTw as Record<string, string>)[area.area_id]) ??
                        'bg-emerald-500';
                      const recs: unknown[] =
                        Array.isArray(area.ai_three_month_recommendations) &&
                        area.ai_three_month_recommendations.length > 0
                          ? area.ai_three_month_recommendations
                          : (area.recommendations ?? []);
                      return (
                        <motion.div
                          key={area.area_id ?? idx}
                          {...slideUp(2.0 + idx * 0.3)}
                          className="border-edge rounded-2xl bg-card p-6"
                        >
                          <div className="mb-4 flex items-center gap-3">
                            <span
                              className={cn(
                                'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl font-bold text-white',
                                bgTw,
                              )}
                            >
                              {idx + 1}
                            </span>
                            <h3 className="text-lg font-bold text-white">{area.area_name}</h3>
                            <span
                              className={cn(
                                'ml-auto rounded-full px-2 py-0.5 text-xs font-medium text-white',
                                bgTw,
                              )}
                            >
                              Completed
                            </span>
                          </div>

                          {recs.length > 0 ? (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                                3-Month Recommendations
                              </p>
                              <ul className="space-y-2">
                                {recs.map((rec, i) => (
                                  <li
                                    key={`${area.area_id ?? idx}-${i}`}
                                    className="flex items-start gap-2 text-sm text-slate-400"
                                  >
                                    <span
                                      className={cn(
                                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                                        bgTw,
                                      )}
                                    >
                                      {i + 1}
                                    </span>
                                    <span>{String(rec)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="text-sm italic text-slate-600">
                              No recommendations generated for this area yet.
                            </p>
                          )}
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}

                {/* CTA */}
                <motion.div {...slideUp(1.8)} className="space-y-6 pt-8 text-center">
                  {childName && (
                    <div className="mx-auto max-w-3xl rounded-2xl border border-amber-500/20 bg-card p-8">
                      <div className="mb-4 flex items-center justify-center gap-3">
                        <Sparkles className="h-6 w-6 text-amber-400" />
                        <span className="text-3xl">🎉</span>
                        <Sparkles className="h-6 w-6 text-amber-400" />
                      </div>
                      <p className="text-xl font-bold leading-relaxed text-white md:text-2xl">
                        Welcome{' '}
                        <span className="text-teal-400">
                          {user?.full_name?.split(' ')[0] ?? 'Parent'}
                        </span>{' '}
                        and <span className="text-emerald-400">{childName}</span> to Buddy360. We
                        look forward to powering up your life in all possible dimensions.
                      </p>
                    </div>
                  )}
                  <div className="mx-auto max-w-3xl">
                    <p className="mt-2 text-sm text-slate-500">
                      Click below to continue this interesting journey with Buddy360.
                    </p>
                  </div>
                  <PageActions
                    className="pt-4"
                    left={
                      <Button
                        variant="outline"
                        onClick={handleBack}
                        className="btn-secondary h-11 w-full rounded-2xl px-6 sm:w-auto"
                      >
                        ← Back
                      </Button>
                    }
                    center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
                    right={
                      <Button
                        onClick={handleStartJourney}
                        className="btn-primary h-11 w-full rounded-2xl px-6 sm:w-auto"
                      >
                        Continue Journey
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    }
                  />
                </motion.div>
              </motion.div>
            </div>

            {/* Concern Modal */}
            <AnimatePresence>
              {showConcernModal && (
                <motion.div
                  {...MODAL_BACKDROP}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
                  onClick={closeConcernModal}
                  role="presentation"
                >
                  <motion.div
                    {...MODAL_SCALE}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Share your concern"
                    className="border-edge-strong relative w-full max-w-lg rounded-2xl bg-surface-elevated p-8 pt-12"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={closeConcernModal}
                      className="hover:bg-ghost-strong absolute right-4 top-4 rounded-xl p-2 text-slate-500 transition-colors hover:text-white focus:outline-none"
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" />
                    </button>
                    <AnimatePresence mode="wait">
                      {!concernSubmitted ? (
                        <motion.div
                          key="form"
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{
                            opacity: 0,
                            y: -12,
                            transition: { duration: 0.3, ease: 'easeIn' },
                          }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                          className="space-y-5"
                        >
                          <div className="mb-2 flex items-center gap-3">
                            <div className="glow-teal-sm flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600">
                              <Sparkles className="h-5 w-5 text-white" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-white">One last thing!</h3>
                              <p className="text-sm text-slate-500">Buddy360 wants to know</p>
                            </div>
                          </div>
                          <p className="text-base leading-relaxed text-slate-300">
                            Hey{' '}
                            <span className="font-semibold text-teal-400">
                              {user?.full_name?.split(' ')[0] ?? 'there'}
                            </span>
                            , is there anything that you want Buddy360 to work on currently with
                            respect to{' '}
                            <span className="font-semibold text-emerald-400">{childName}</span>?
                          </p>
                          <TextareaWithVoice
                            value={concernInput}
                            onChange={(e) => setConcernInput(e.target.value)}
                            placeholder={`e.g., I want to improve English speaking skills for ${childName}.`}
                            className="border-edge-strong min-h-[120px] w-full resize-none rounded-xl bg-section-dark p-4 text-white placeholder:text-slate-600 focus:border-teal-500/50"
                          />
                          <div className="flex gap-3">
                            <Button
                              variant="outline"
                              onClick={handleProceedToDashboard}
                              className="border-edge-strong hover:bg-subtle h-11 flex-1 rounded-xl bg-transparent text-slate-300"
                            >
                              Skip for now
                            </Button>
                            <Button
                              onClick={() => {
                                void handleConcernSubmit();
                              }}
                              disabled={!concernInput.trim()}
                              className="btn-primary h-11 flex-1 rounded-xl disabled:opacity-40"
                            >
                              Submit
                              <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="success"
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                          className="space-y-6 text-center"
                        >
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500">
                            <span className="text-2xl">✅</span>
                          </div>
                          <div>
                            <h3 className="mb-2 text-lg font-bold text-white">Got it!</h3>
                            <p className="leading-relaxed text-slate-400">
                              I got that. We will work with{' '}
                              <span className="font-semibold text-emerald-400">{childName}</span> on
                              the same.
                            </p>
                          </div>
                          <Button
                            onClick={handleProceedToDashboard}
                            className="btn-primary h-11 w-full rounded-xl"
                          >
                            Go to Dashboard
                            <ChevronRight className="ml-2 h-4 w-4" />
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={4} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
