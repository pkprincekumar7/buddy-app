import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { TrendingUp, Sparkles, ChevronRight, Award, Target, CheckCircle, X } from 'lucide-react';
import TextareaWithVoice from '../components/shared/TextareaWithVoice';
import { createPageUrl } from "@/utils";
import { api } from '@/api/client';
import { useLifePathwayData } from '@/hooks/useLifePathwayData';
import { SPINNER, MODAL_BACKDROP, MODAL_SCALE, slideUp } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Hex values kept for recharts SVG strokes and chart dot fills.
const areaColors = {
  life_ambition:     '#8b5cf6',
  self_care:         '#ec4899',
  critical_thinking: '#3b82f6',
  creativity:        '#f59e0b',
  physical_wellness: '#10b981',
  social_skills:     '#7c3aed',
};

// Tailwind bg classes for CSS (non-SVG) elements — avoids inline backgroundColor styles.
const areaBgTw = {
  life_ambition:     'bg-violet-500',
  self_care:         'bg-pink-500',
  critical_thinking: 'bg-blue-500',
  creativity:        'bg-amber-400',
  physical_wellness: 'bg-emerald-500',
  social_skills:     'bg-violet-600',
};

// Milestone events per growth area mapped to journey years
const areaMilestoneMap = {
  life_ambition:     [{ yearOffset: 0, text: 'Life ambition clarified' }, { yearOffset: 3, text: 'Career path explored' }, { yearOffset: 7, text: 'Purpose solidified' }],
  self_care:         [{ yearOffset: 0, text: 'Self-care habits formed' }, { yearOffset: 4, text: 'Emotional resilience built' }, { yearOffset: 8, text: 'Lifelong wellness achieved' }],
  critical_thinking: [{ yearOffset: 0, text: 'Problem-solving enhanced' }, { yearOffset: 4, text: 'Analytical thinking mastered' }, { yearOffset: 9, text: 'Strategic mindset developed' }],
  creativity:        [{ yearOffset: 0, text: 'Creative confidence unlocked' }, { yearOffset: 5, text: 'Artistic expression flourishing' }, { yearOffset: 9, text: 'Innovation mindset instilled' }],
  physical_wellness: [{ yearOffset: 0, text: 'Healthy habits started' }, { yearOffset: 3, text: 'Physical goals achieved' }, { yearOffset: 7, text: 'Lifelong fitness culture' }],
  social_skills:     [{ yearOffset: 0, text: 'Communication skills built' }, { yearOffset: 4, text: 'Leadership emerging' }, { yearOffset: 8, text: 'Strong social network' }],
};

function getAreaBoost(area) {
  const answerCount = Object.values(area.answers || {}).filter(Boolean).length;
  const hasRecs = area.recommendations && area.recommendations.length > 0;
  return 5 + answerCount * 0.8 + (hasRecs ? 2 : 0);
}

// Defined at module level so React never sees a new component type between renders.
// milestoneAgeColorMap is passed as a prop because recharts forwards custom props to dot components.
function CustomDot({ cx, cy, payload, milestoneAgeColorMap }) {
  const color = milestoneAgeColorMap?.[payload.age];
  return color
    ? <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />
    : <circle cx={cx} cy={cy} r={4} fill="#10b981" />;
}

export default function LifePathway() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern } = useLifePathwayData();

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
    const onKeyDown = (e) => { if (e.key === 'Escape') closeConcernModal(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showConcernModal, closeConcernModal]);

  // On bfcache restore (Back from GoalsDashboard), close any open modal.
  // Also calls closeConcernModal on component unmount via the cleanup.
  useEffect(() => {
    const onPageShow = (e) => { if (e.persisted) closeConcernModal(); };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      closeConcernModal();
    };
  }, [closeConcernModal]);

  const handleStartJourney = () => {
    if (savedConcern) {
      navigate(createPageUrl('GoalsDashboard'));
      return;
    }
    setShowConcernModal(true);
  };

  const handleConcernSubmit = async () => {
    if (!concernInput.trim() || !childData?.id) return;
    try {
      await api.goals.patch(childData?.id, { parent_concern: concernInput.trim() });
      setSavedConcern(concernInput.trim());
    } catch (err) {
      console.warn('[LifePathway] Could not persist concern, proceeding anyway:', err);
    }
    setConcernSubmitted(true);
  };

  const handleProceedToDashboard = () => {
    closeConcernModal();
    navigate(createPageUrl('GoalsDashboard'));
  };

  const handleStartOver = useCallback(async () => {
    try {
      if (childData?.id) {
        try {
          await api.entities.Child.delete(childData.id);
        } catch (err) {
          if (err?.status !== 404) console.warn('[LifePathway] Child delete failed:', err);
        }
      }
      // Child deletion cascades all related data — no additional resets needed.
    } catch (err) {
      console.warn('[LifePathway] Start over cleanup had errors:', err);
    }
    navigate(createPageUrl('Onboarding'));
  }, [childData, navigate]);

  const handleBack = () => navigate(createPageUrl('Onboarding'));

  const strengths = useMemo(() =>
    profile?.top_strengths || [
      'Creative problem solver',
      'Strong leadership qualities',
      'Excellent communication skills',
    ],
    [profile]
  );

  const currentAge = useMemo(() => parseInt(childData?.age) || 10, [childData?.age]);

  const journeyData = useMemo(() =>
    Array.from({ length: 11 }, (_, i) => {
      const age = currentAge + i;
      const point = { age, year: `Age ${age}`, standard: Math.min(40 + (i * 4), 100) };
      if (completedAreas.length > 0) {
        completedAreas.forEach(area => {
          const boost = getAreaBoost(area);
          point[area.area_id] = Math.min(Math.round(40 + (i * boost) + (i * i * 0.25)), 100);
        });
      } else {
        point.buddy360 = Math.min(Math.round(40 + i * 6.5 + i * i * 0.3), 100);
      }
      return point;
    }),
    [completedAreas, currentAge]
  );

  const standardMilestones = useMemo(() => [
    { age: currentAge, text: 'Basic education foundation' },
    { age: currentAge + 3, text: 'Intermediate skills developed' },
    { age: currentAge + 6, text: 'Advanced academic progress' },
    { age: currentAge + 10, text: 'College preparation' },
  ], [currentAge]);

  const buddy360Milestones = useMemo(() =>
    completedAreas.length > 0
      ? completedAreas.flatMap(area =>
          (areaMilestoneMap[area.area_id] || []).map(m => ({
            age: currentAge + m.yearOffset,
            text: m.text,
            area: area.area_name,
            color: areaColors[area.area_id] || '#10b981',
          }))
        ).sort((a, b) => a.age - b.age)
      : [
          { age: currentAge, text: 'Personalized profile created', area: 'Core', color: '#10b981' },
          { age: currentAge + 1, text: 'Core strengths identified & enhanced', area: 'Core', color: '#10b981' },
          { age: currentAge + 2, text: 'Weekly missions mastered', area: 'Core', color: '#10b981' },
          { age: currentAge + 5, text: 'Multiple talents developed', area: 'Core', color: '#10b981' },
          { age: currentAge + 7, text: 'Character strengths solidified', area: 'Core', color: '#10b981' },
          { age: currentAge + 10, text: 'Ready for exceptional future', area: 'Core', color: '#10b981' },
        ],
    [completedAreas, currentAge]
  );

  const milestoneAgeColorMap = useMemo(() =>
    buddy360Milestones.reduce((acc, m) => {
      if (!acc[m.age]) acc[m.age] = m.color;
      return acc;
    }, {}),
    [buddy360Milestones]
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div {...SPINNER} className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="space-y-8"
        >
          {/* Header */}
          <motion.div {...slideUp(0.1)} className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal-sm">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              Take a look at {childData?.name}'s life journey planned and powered by Buddy360
            </h1>
            {completedAreas.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {completedAreas.map(area => (
                  <span
                    key={area.area_id}
                    className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white', areaBgTw[area.area_id] ?? 'bg-emerald-500')}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {area.area_name}
                  </span>
                ))}
              </div>
            )}
          </motion.div>

          {/* Chart */}
          <motion.div {...slideUp(0.8)} className="bg-card rounded-2xl p-6 md:p-8 border-edge">
            <div className="text-center mb-6">
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">
                10-Year Growth Journey Comparison
              </h2>
              <p className="text-slate-400">
                See how {childData?.name}'s development accelerates with Buddy360
                {completedAreas.length > 0 && ` across ${completedAreas.length} growth area${completedAreas.length > 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="h-80 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={journeyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="year" stroke="#475569" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#475569" style={{ fontSize: '12px' }}
                    label={{ value: 'Growth Level', angle: -90, position: 'insideLeft', style: { fontSize: '12px', fill: '#475569' } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', color: '#e2e8f0' }}
                    formatter={(value, name) => [`${value}%`, name]}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Line type="monotone" dataKey="standard" stroke="#94a3b8" strokeWidth={3} name="Standard Journey" dot={{ fill: '#94a3b8', r: 4 }} />
                  {completedAreas.length > 0 ? (
                    completedAreas.map(area => (
                      <Line
                        key={area.area_id}
                        type="monotone"
                        dataKey={area.area_id}
                        stroke={areaColors[area.area_id] || '#10b981'}
                        strokeWidth={3}
                        name={`${area.area_name} (Buddy360)`}
                        dot={<CustomDot milestoneAgeColorMap={milestoneAgeColorMap} />}
                      />
                    ))
                  ) : (
                    <Line type="monotone" dataKey="buddy360" stroke="#10b981" strokeWidth={3} name="Buddy360 Journey" dot={<CustomDot milestoneAgeColorMap={milestoneAgeColorMap} />} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Milestone Legend */}
            {buddy360Milestones.length > 0 && (
              <div className="bg-surface-elevated rounded-xl p-4 mb-6 border-edge-faint">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">● Milestone markers on the Buddy360 line</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {buddy360Milestones.map((m) => (
                    <div key={`${m.age}-${m.text}`} className="flex items-center gap-2 text-sm text-slate-400">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                      <span className="font-medium text-slate-300 w-14 flex-shrink-0">Age {m.age}</span>
                      <span className="text-xs">{m.text}</span>
                      {m.area !== 'Core' && (
                        <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full text-white flex-shrink-0" style={{ backgroundColor: m.color }}>
                          {m.area}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Journey Details Grid */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Standard Journey */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-ghost-strong text-slate-300 font-bold text-sm">1</span>
                  <h3 className="text-lg font-bold text-white">Standard Life Journey</h3>
                </div>
                <div className="bg-surface-elevated rounded-xl p-4 border-edge-faint">
                  <h4 className="font-semibold text-white text-sm mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-slate-400" />
                    The Analysis
                  </h4>
                  <p className="text-sm text-slate-400">
                    {profile?.summary || `${childData?.name} shows natural growth through standard educational pathways with typical developmental milestones.`}
                  </p>
                </div>
                <div className="bg-surface-elevated rounded-xl p-4 border-edge-faint">
                  <h4 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-400" />
                    Key Milestones
                  </h4>
                  <div className="space-y-2.5">
                    {standardMilestones.map((milestone) => (
                      <div key={milestone.text} className="flex items-start gap-3">
                        <div className="w-14 flex-shrink-0 text-xs font-medium text-slate-500">Age {milestone.age}</div>
                        <div className="flex-1 text-xs text-slate-400">{milestone.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Buddy360 Journey */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-white font-bold text-sm">2</span>
                  <h3 className="text-lg font-bold text-white">{childData?.name}'s Journey with Buddy360</h3>
                </div>

                <div className="bg-brand-teal rounded-xl p-4 border border-teal-500/20">
                  <h4 className="font-semibold text-teal-400 text-sm mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Analysis
                  </h4>
                  <p className="text-sm text-slate-400">
                    {profile?.summary || `${childData?.name} experiences accelerated holistic growth through personalized guidance, targeted skill development, and continuous support.`}
                    {completedAreas.length > 0 && ` Development is boosted across ${completedAreas.map(a => a.area_name).join(', ')}.`}
                  </p>
                </div>

                <div className="bg-brand-teal rounded-xl p-4 border border-teal-500/20">
                  <h4 className="font-semibold text-teal-400 text-sm mb-2">Strengths Improvised by Buddy360</h4>
                  <ul className="space-y-1.5">
                    {strengths.map((strength) => (
                      <li key={strength} className="flex items-start gap-2 text-sm text-slate-400">
                        <span className="text-teal-400 mt-0.5">✓</span>
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-brand-teal rounded-xl p-4 border border-teal-500/20">
                  <h4 className="font-semibold text-teal-400 text-sm mb-3 flex items-center gap-2">
                    <Award className="w-4 h-4" />
                    Accomplishments & Milestones
                  </h4>
                  <div className="space-y-2.5">
                    {buddy360Milestones.map((milestone) => (
                      <div key={`${milestone.age}-${milestone.text}`} className="flex items-start gap-3">
                        <div className="w-14 flex-shrink-0 text-xs font-medium text-teal-500">Age {milestone.age}</div>
                        <div className="flex-1 text-xs text-slate-300 font-medium">{milestone.text}</div>
                        {milestone.area !== 'Core' && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full text-white flex-shrink-0 self-start" style={{ backgroundColor: milestone.color }}>
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
              <h2 className="text-2xl font-bold text-white tracking-tight">Growth Area Insights</h2>
              <p className="text-slate-400">Recommendations for each area for {childData?.name}</p>

              {completedAreas.map((area, idx) => {
                const bgTw = areaBgTw[area.area_id] ?? 'bg-emerald-500';
                const recs = area.recommendations || [];
                return (
                  <motion.div
                    key={area.area_id}
                    {...slideUp(2.0 + idx * 0.3)}
                    className="bg-card rounded-2xl p-6 border-edge"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0', bgTw)}>
                        {idx + 1}
                      </span>
                      <h3 className="text-lg font-bold text-white">{area.area_name}</h3>
                      <span className={cn('ml-auto text-xs px-2 py-0.5 rounded-full text-white font-medium', bgTw)}>
                        Completed
                      </span>
                    </div>

                    {recs.length > 0 ? (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">3-Month Recommendations</p>
                        <ul className="space-y-2">
                          {recs.map((rec, i) => (
                            <li key={`${area.area_id}-${i}`} className="flex items-start gap-2 text-sm text-slate-400">
                              <span className={cn('flex-shrink-0 w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold mt-0.5', bgTw)}>
                                {i + 1}
                              </span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600 italic">No recommendations generated for this area yet.</p>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* CTA */}
          <motion.div {...slideUp(1.8)} className="text-center pt-8 space-y-6">
            {childData?.name && (
              <div className="max-w-3xl mx-auto bg-card rounded-2xl p-8 border border-amber-500/20">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <Sparkles className="w-6 h-6 text-amber-400" />
                  <span className="text-3xl">🎉</span>
                  <Sparkles className="w-6 h-6 text-amber-400" />
                </div>
                <p className="text-white text-xl md:text-2xl font-bold leading-relaxed">
                  Welcome{' '}
                  <span className="text-teal-400">{user?.full_name?.split(' ')[0] || 'Parent'}</span>
                  {' '}and{' '}
                  <span className="text-emerald-400">{childData.name}</span>
                  {' '}to Buddy360. We look forward to powering up your life in all possible dimensions.
                </p>
              </div>
            )}
            <div className="max-w-3xl mx-auto">
              <p className="text-slate-500 mt-2 text-sm">Click below to continue this interesting journey with Buddy360.</p>
            </div>
            <PageActions
              className="pt-4"
              left={
                <Button variant="outline" onClick={handleBack} className="h-11 w-full sm:w-auto px-6 rounded-2xl btn-secondary">
                  ← Back
                </Button>
              }
              center={
                <Button variant="outline" onClick={handleStartOver} className="h-11 w-full sm:w-auto px-6 rounded-2xl btn-start-over">
                  🔄 Start Over
                </Button>
              }
              right={
                <Button onClick={handleStartJourney} className="h-11 w-full sm:w-auto px-6 rounded-2xl btn-primary">
                  Continue Journey
                  <ChevronRight className="w-4 h-4 ml-2" />
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
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
            onClick={closeConcernModal}
            role="presentation"
          >
            <motion.div
              {...MODAL_SCALE}
              role="dialog"
              aria-modal="true"
              aria-label="Share your concern"
              className="relative bg-surface-elevated rounded-2xl p-8 pt-12 max-w-lg w-full border-edge-strong"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeConcernModal}
                className="absolute top-4 right-4 rounded-xl p-2 text-slate-500 hover:text-white hover:bg-ghost-strong transition-colors focus:outline-none"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
              <AnimatePresence mode="wait">
                {!concernSubmitted ? (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12, transition: { duration: 0.3, ease: 'easeIn' } }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="space-y-5"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal-sm">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-lg">One last thing!</h3>
                        <p className="text-sm text-slate-500">Buddy360 wants to know</p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-base leading-relaxed">
                      Hey <span className="font-semibold text-teal-400">{user?.full_name?.split(' ')[0] || 'there'}</span>, is there anything that you want Buddy360 to work on currently with respect to <span className="font-semibold text-emerald-400">{childData?.name}</span>?
                    </p>
                    <TextareaWithVoice
                      value={concernInput}
                      onChange={(e) => setConcernInput(e.target.value)}
                      placeholder={`e.g., I want to improve English speaking skills for ${childData?.name}.`}
                      className="w-full min-h-[120px] p-4 rounded-xl bg-section-dark border-edge-strong text-white placeholder:text-slate-600 focus:border-teal-500/50 resize-none"
                    />
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={handleProceedToDashboard}
                        className="flex-1 h-11 rounded-xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle"
                      >
                        Skip for now
                      </Button>
                      <Button
                        onClick={handleConcernSubmit}
                        disabled={!concernInput.trim()}
                        className="flex-1 h-11 rounded-xl btn-primary disabled:opacity-40"
                      >
                        Submit
                        <ChevronRight className="w-4 h-4 ml-1" />
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
                    <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                      <span className="text-2xl">✅</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg mb-2">Got it!</h3>
                      <p className="text-slate-400 leading-relaxed">
                        I got that. We will work with <span className="font-semibold text-emerald-400">{childData?.name}</span> on the same.
                      </p>
                    </div>
                    <Button
                      onClick={handleProceedToDashboard}
                      className="w-full h-11 rounded-xl btn-primary"
                    >
                      Go to Dashboard
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
