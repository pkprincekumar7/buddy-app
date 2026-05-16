import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { TrendingUp, Sparkles, ChevronRight, Award, Target, CheckCircle, X } from 'lucide-react';
import TextareaWithVoice from '../components/shared/TextareaWithVoice';
import { createPageUrl } from "@/utils";
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts';

const areaColors = {
  life_ambition: '#8b5cf6',
  self_care: '#ec4899',
  critical_thinking: '#3b82f6',
  creativity: '#f59e0b',
  physical_wellness: '#10b981',
  social_skills: '#7c3aed',
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

export default function LifePathway() {
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    navigate(createPageUrl('Onboarding'));
  }, [navigate]);
  const { user } = useAuth();
  const [childData, setChildData] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completedAreas, setCompletedAreas] = useState([]);
  const [showConcernModal, setShowConcernModal] = useState(false);
  const [concernInput, setConcernInput] = useState('');
  const [concernSubmitted, setConcernSubmitted] = useState(false);
  const [savedConcern, setSavedConcern] = useState('');

  useEffect(() => {
    const loadChildData = async () => {
      try {
        const [onboarding, completedData, children, goals] = await Promise.all([
          api.onboarding.get(),
          api.completedGrowthAreas.list(),
          api.entities.Child.list('-created_date', 1),
          api.goals.get(),
        ]);

        const resolvedChildData = children?.[0] || onboarding?.child_data || null;
        if (resolvedChildData) setChildData(resolvedChildData);

        const vm = onboarding?.personality?.view_model;
        if (vm?.type && vm?.profile) {
          setProfile(onboardingProfileFromViewModel(vm));
        }

        if (completedData?.areas?.length) {
          setCompletedAreas(completedData.areas);
        }

        const stored = typeof goals?.parent_concern === 'string' ? goals.parent_concern.trim() : '';
        setSavedConcern(stored);
      } catch (error) {
        console.error('Failed to load child data:', error);
        toast.error('Failed to load your data. Please refresh and try again.');
      }
      setIsLoading(false);
    };

    loadChildData();
  }, []);



  const handleStartJourney = () => {
    if (savedConcern) {
      navigate(createPageUrl('GoalsDashboard'));
      return;
    }
    setShowConcernModal(true);
  };

  const handleConcernSubmit = async () => {
    if (!concernInput.trim()) return;
    try {
      await api.goals.patch({ parent_concern: concernInput.trim() });
      setSavedConcern(concernInput.trim());
    } catch {
      /* still allow UX to proceed */
    }
    setConcernSubmitted(true);
  };

  const handleProceedToDashboard = () => {
    closeConcernModal();
    navigate(createPageUrl('GoalsDashboard'));
  };

  const closeConcernModal = useCallback(() => {
    setShowConcernModal(false);
    setConcernSubmitted(false);
    setConcernInput('');
  }, []);

  useEffect(() => {
    if (!showConcernModal) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeConcernModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showConcernModal, closeConcernModal]);

  /** If this tab restores from bfcache, drop modal state so Back from Goals does not reopen it. */
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) closeConcernModal();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [closeConcernModal]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  const strengths = profile?.top_strengths?.map(s => s.strength) || [
    "Creative problem solver",
    "Strong leadership qualities",
    "Excellent communication skills"
  ];

  const currentAge = parseInt(childData?.age) || 10;

  // Compute per-area boost from answers: more detailed answers = higher engagement score
  const getAreaBoost = (area) => {
    const answers = area.answers || {};
    const answerCount = Object.values(answers).filter(Boolean).length;
    const hasRecs = area.recommendations && area.recommendations.length > 0;
    return 5 + answerCount * 0.8 + (hasRecs ? 2 : 0);
  };

  const journeyData = Array.from({ length: 11 }, (_, i) => {
    const age = currentAge + i;
    const standardGrowth = 40 + (i * 4);
    const point = { age, year: `Age ${age}`, standard: Math.min(standardGrowth, 100) };

    if (completedAreas.length > 0) {
      completedAreas.forEach(area => {
        const boost = getAreaBoost(area);
        const val = 40 + (i * boost) + (i * i * 0.25);
        point[area.area_id] = Math.min(Math.round(val), 100);
      });
    } else {
      // Default single buddy360 line
      point.buddy360 = Math.min(Math.round(40 + i * 6.5 + i * i * 0.3), 100);
    }
    return point;
  });

  const standardMilestones = [
    { age: currentAge, text: 'Basic education foundation' },
    { age: currentAge + 3, text: 'Intermediate skills developed' },
    { age: currentAge + 6, text: 'Advanced academic progress' },
    { age: currentAge + 10, text: 'College preparation' }
  ];

  const buddy360Milestones = completedAreas.length > 0
    ? completedAreas.flatMap(area =>
        (areaMilestoneMap[area.area_id] || []).map(m => ({
          age: currentAge + m.yearOffset,
          text: m.text,
          area: area.area_name,
          color: areaColors[area.area_id] || '#10b981'
        }))
      ).sort((a, b) => a.age - b.age)
    : [
        { age: currentAge, text: 'Personalized profile created', area: 'Core', color: '#10b981' },
        { age: currentAge + 1, text: 'Core strengths identified & enhanced', area: 'Core', color: '#10b981' },
        { age: currentAge + 2, text: 'Weekly missions mastered', area: 'Core', color: '#10b981' },
        { age: currentAge + 5, text: 'Multiple talents developed', area: 'Core', color: '#10b981' },
        { age: currentAge + 7, text: 'Character strengths solidified', area: 'Core', color: '#10b981' },
        { age: currentAge + 10, text: 'Ready for exceptional future', area: 'Core', color: '#10b981' },
      ];

  const milestoneAgeColorMap = buddy360Milestones.reduce((acc, m) => {
    if (!acc[m.age]) acc[m.age] = m.color;
    return acc;
  }, {});

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    const color = milestoneAgeColorMap[payload.age];
    if (color) {
      return <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={2} />;
    }
    return <circle cx={cx} cy={cy} r={4} fill="#10b981" />;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal-sm"
            >
              <TrendingUp className="w-8 h-8 text-white" />
            </motion.div>
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              Take a look at {childData?.name}'s life journey planned and powered by Buddy360
            </h1>
            {completedAreas.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {completedAreas.map(area => (
                  <span
                    key={area.area_id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white"
                    style={{ backgroundColor: areaColors[area.area_id] || '#10b981' }}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {area.area_name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/[0.08]"
          >
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
                  <Line
                    type="monotone"
                    dataKey="standard"
                    stroke="#94a3b8"
                    strokeWidth={3}
                    name="Standard Journey"
                    dot={{ fill: '#94a3b8', r: 4 }}
                  />
                  {completedAreas.length > 0 ? (
                    completedAreas.map(area => (
                      <Line
                        key={area.area_id}
                        type="monotone"
                        dataKey={area.area_id}
                        stroke={areaColors[area.area_id] || '#10b981'}
                        strokeWidth={3}
                        name={`${area.area_name} (Buddy360)`}
                        dot={<CustomDot />}
                      />
                    ))
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="buddy360"
                      stroke="#10b981"
                      strokeWidth={3}
                      name="Buddy360 Journey"
                      dot={<CustomDot />}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Milestone Legend */}
            {buddy360Milestones.length > 0 && (
              <div className="bg-[#1a1a1a] rounded-xl p-4 mb-6 border border-white/[0.06]">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">● Milestone markers on the Buddy360 line</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {buddy360Milestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-400">
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
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/[0.08] text-slate-300 font-bold text-sm">1</span>
                  <h3 className="text-lg font-bold text-white">Standard Life Journey</h3>
                </div>
                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/[0.06]">
                  <h4 className="font-semibold text-white text-sm mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-slate-400" />
                    The Analysis
                  </h4>
                  <p className="text-sm text-slate-400">
                    {profile?.summary || `${childData?.name} shows natural growth through standard educational pathways with typical developmental milestones.`}
                  </p>
                </div>
                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/[0.06]">
                  <h4 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-400" />
                    Key Milestones
                  </h4>
                  <div className="space-y-2.5">
                    {standardMilestones.map((milestone, i) => (
                      <div key={i} className="flex items-start gap-3">
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

                <div className="bg-teal-500/[0.07] rounded-xl p-4 border border-teal-500/20">
                  <h4 className="font-semibold text-teal-400 text-sm mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Analysis
                  </h4>
                  <p className="text-sm text-slate-400">
                    {profile?.summary || `${childData?.name} experiences accelerated holistic growth through personalized guidance, targeted skill development, and continuous support.`}
                    {completedAreas.length > 0 && ` Development is boosted across ${completedAreas.map(a => a.area_name).join(', ')}.`}
                  </p>
                </div>

                <div className="bg-teal-500/[0.07] rounded-xl p-4 border border-teal-500/20">
                  <h4 className="font-semibold text-teal-400 text-sm mb-2">Strengths Improvised by Buddy360</h4>
                  <ul className="space-y-1.5">
                    {strengths.map((strength, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                        <span className="text-teal-400 mt-0.5">✓</span>
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-teal-500/[0.07] rounded-xl p-4 border border-teal-500/20">
                  <h4 className="font-semibold text-teal-400 text-sm mb-3 flex items-center gap-2">
                    <Award className="w-4 h-4" />
                    Accomplishments & Milestones
                  </h4>
                  <div className="space-y-2.5">
                    {buddy360Milestones.map((milestone, i) => (
                      <div key={i} className="flex items-start gap-3">
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="space-y-4"
            >
              <h2 className="text-2xl font-bold text-white tracking-tight">Growth Area Insights</h2>
              <p className="text-slate-400">Recommendations for each area for {childData?.name}</p>

              {completedAreas.map((area, idx) => {
                const color = areaColors[area.area_id] || '#10b981';
                const recs = area.recommendations || [];
                return (
                  <motion.div
                    key={area.area_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * idx }}
                    className="bg-[#141414] rounded-2xl p-6 border border-white/[0.08]"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0" style={{ backgroundColor: color }}>
                        {idx + 1}
                      </span>
                      <h3 className="text-lg font-bold text-white">{area.area_name}</h3>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: color }}>
                        Completed
                      </span>
                    </div>

                    {recs.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">3-Month Recommendations</p>
                        <ul className="space-y-2">
                          {recs.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                              <span className="flex-shrink-0 w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold mt-0.5" style={{ backgroundColor: color }}>
                                {i + 1}
                              </span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {recs.length === 0 && (
                      <p className="text-sm text-slate-600 italic">No recommendations generated for this area yet.</p>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-center pt-8 space-y-6"
          >
            {/* Welcome Banner */}
            {childData?.name && (
              <div className="max-w-3xl mx-auto bg-[#141414] rounded-2xl p-8 border border-amber-500/20">
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
            <div className="grid w-full grid-cols-1 gap-3 pt-4 sm:grid-cols-3 sm:items-center">
              <div className="flex w-full sm:justify-start">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border border-white/[0.12] bg-transparent text-slate-300 hover:bg-white/[0.05]"
                >
                  ← Back
                </Button>
              </div>
              <div className="flex w-full sm:justify-center">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      if (childData?.id) {
                        try { await api.entities.Child.delete(childData.id); } catch { /* 404 ok */ }
                      }
                      await Promise.all([
                        api.onboarding.patch({ phase: 0, clear_child_data: true, clear_personality: true, clear_recommendations: true }),
                        api.recommendationsProgress.patch({ step: 'intro' }),
                        api.goals.patch({ clear_plan: true, clear_concern: true }),
                        api.completedGrowthAreas.clear(),
                      ]);
                    } catch { /* ignore */ }
                    navigate(createPageUrl('Onboarding'));
                  }}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border border-amber-500/30 bg-transparent text-amber-400 hover:bg-amber-500/10"
                >
                  🔄 Start Over
                </Button>
              </div>
              <div className="flex w-full sm:justify-end">
                <Button
                  onClick={handleStartJourney}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-[#0a0a0a] font-semibold glow-teal"
                >
                  Continue Journey
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Concern Modal */}
      <AnimatePresence>
        {showConcernModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
          onClick={closeConcernModal}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="relative bg-[#1a1a1a] rounded-2xl p-8 pt-12 max-w-lg w-full border border-white/[0.10]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeConcernModal}
              className="absolute top-4 right-4 rounded-xl p-2 text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors focus:outline-none"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
            {!concernSubmitted ? (
              <div className="space-y-5">
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
                  className="w-full min-h-[120px] p-4 rounded-xl bg-[#111111] border border-white/[0.10] text-white placeholder:text-slate-600 focus:border-teal-500/50 resize-none"
                />
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={handleProceedToDashboard}
                    className="flex-1 h-11 rounded-xl border border-white/[0.12] bg-transparent text-slate-300 hover:bg-white/[0.05]"
                  >
                    Skip for now
                  </Button>
                  <Button
                    onClick={handleConcernSubmit}
                    disabled={!concernInput.trim()}
                    className="flex-1 h-11 rounded-xl bg-gradient-to-r from-teal-500 to-teal-400 text-[#0a0a0a] font-semibold disabled:opacity-40"
                  >
                    Submit
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 text-center">
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
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-teal-500 to-teal-400 text-[#0a0a0a] font-semibold"
                >
                  Go to Dashboard
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}