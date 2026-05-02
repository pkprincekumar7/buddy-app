import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { TrendingUp, Sparkles, ChevronRight, Award, Target, CheckCircle, X } from 'lucide-react';
import TextareaWithVoice from '../components/shared/TextareaWithVoice';
import { createPageUrl } from "@/utils";
import { api } from '@/api/client';
import { USER_APP_FULL_ONBOARDING_KEYS, patchBodyClearKeys } from '@/lib/userAppStateKeys';
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
  const [childData, setChildData] = useState(null);
  const [profile, setProfile] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completedAreas, setCompletedAreas] = useState([]);
  const [showConcernModal, setShowConcernModal] = useState(false);
  const [concernInput, setConcernInput] = useState('');
  const [concernSubmitted, setConcernSubmitted] = useState(false);

  useEffect(() => {
    const loadChildData = async () => {
      try {
        const currentUser = await api.auth.me();
        setUser(currentUser);

        const s = await api.userAppState.get();

        let resolvedChildData = null;
        const children = await api.entities.Child.list('-created_date', 1);
        if (children && children.length > 0) {
          resolvedChildData = children[0];
        } else if (s?.onboarding_childData && typeof s.onboarding_childData === 'object') {
          resolvedChildData = s.onboarding_childData;
        }
        if (resolvedChildData) setChildData(resolvedChildData);

        const profileFromState =
          s?.onboarding_profile && typeof s.onboarding_profile === 'object' ? s.onboarding_profile : null;
        const vm =
          s?.onboarding_personality_analysis?.view_model &&
          typeof s.onboarding_personality_analysis.view_model === 'object'
            ? s.onboarding_personality_analysis.view_model
            : null;
        const legacyVm =
          !vm && s?.onboarding_mbti && typeof s.onboarding_mbti === 'object' ? s.onboarding_mbti : null;
        const reuseVm = vm || legacyVm;
        const resolvedProfile =
          profileFromState ||
          (reuseVm?.type && reuseVm?.profile ? onboardingProfileFromViewModel(reuseVm) : null);
        if (resolvedProfile) setProfile(resolvedProfile);

        const savedCompletedAreas = s?.completed_growth_areas;
        let parsedAreas = [];
        if (savedCompletedAreas && Array.isArray(savedCompletedAreas)) {
          parsedAreas = savedCompletedAreas;
          setCompletedAreas(parsedAreas);
        }


      } catch (error) {
        console.error('Failed to load child data:', error);
      }
      setIsLoading(false);
    };

    loadChildData();
  }, []);



  const handleStartJourney = () => {
    setShowConcernModal(true);
  };

  const handleConcernSubmit = async () => {
    if (!concernInput.trim()) return;
    try {
      await api.userAppState.patch({ parent_concern: concernInput.trim() });
      setConcernSubmitted(true);
    } catch {
      /* still allow UX to proceed */
      setConcernSubmitted(true);
    }
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

  /** Prefill concern textarea from saved app-state when opening the modal */
  useEffect(() => {
    if (!showConcernModal) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.userAppState.get();
        if (cancelled) return;
        const stored = typeof s.parent_concern === 'string' ? s.parent_concern.trim() : '';
        if (stored) setConcernInput(stored);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showConcernModal]);

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
        point[area.id] = Math.min(Math.round(val), 100);
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
        (areaMilestoneMap[area.id] || []).map(m => ({
          age: currentAge + m.yearOffset,
          text: m.text,
          area: area.name,
          color: areaColors[area.id] || '#10b981'
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center"
            >
              <TrendingUp className="w-10 h-10 text-white" />
            </motion.div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-800">
              Take a look at {childData?.name}'s life journey planned and powered by Buddy360
            </h1>
            {completedAreas.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {completedAreas.map(area => (
                  <span
                    key={area.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white"
                    style={{ backgroundColor: areaColors[area.id] || '#10b981' }}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {area.name}
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
            className="bg-white rounded-3xl p-6 md:p-8 border-2 border-slate-200 shadow-xl"
          >
            <div className="text-center mb-6">
              <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">
                10-Year Growth Journey Comparison
              </h2>
              <p className="text-slate-600">
                See how {childData?.name}'s development accelerates with Buddy360
                {completedAreas.length > 0 && ` across ${completedAreas.length} growth area${completedAreas.length > 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="h-80 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={journeyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="year" stroke="#64748b" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#64748b" style={{ fontSize: '12px' }}
                    label={{ value: 'Growth Level', angle: -90, position: 'insideLeft', style: { fontSize: '12px' } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}
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
                        key={area.id}
                        type="monotone"
                        dataKey={area.id}
                        stroke={areaColors[area.id] || '#10b981'}
                        strokeWidth={3}
                        name={`${area.name} (Buddy360)`}
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
              <div className="bg-slate-50 rounded-2xl p-4 mb-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">● Milestone markers on the Buddy360 line</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {buddy360Milestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: m.color }}
                      />
                      <span className="font-medium text-slate-700 w-14 flex-shrink-0">Age {m.age}</span>
                      <span>{m.text}</span>
                      {m.area !== 'Core' && (
                        <span
                          className="ml-auto text-xs px-1.5 py-0.5 rounded-full text-white flex-shrink-0"
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
            <div className="grid md:grid-cols-2 gap-6">
              {/* Standard Journey */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold">1</span>
                  <h3 className="text-xl font-bold text-slate-800">Standard Life Journey</h3>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4">
                  <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-slate-600" />
                    The Analysis
                  </h4>
                  <p className="text-sm text-slate-600">
                    {profile?.summary || `${childData?.name} shows natural growth through standard educational pathways with typical developmental milestones.`}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4">
                  <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-600" />
                    Key Milestones
                  </h4>
                  <div className="space-y-3">
                    {standardMilestones.map((milestone, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-16 flex-shrink-0 text-xs font-medium text-slate-500">Age {milestone.age}</div>
                        <div className="flex-1 text-sm text-slate-700">{milestone.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Buddy360 Journey */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold">2</span>
                  <h3 className="text-xl font-bold text-slate-800">{childData?.name}'s Life Journey using Buddy360</h3>
                </div>

                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200">
                  <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    Analysis
                  </h4>
                  <p className="text-sm text-slate-700">
                    {profile?.summary || `${childData?.name} experiences accelerated holistic growth through personalized guidance, targeted skill development, and continuous support.`}
                    {completedAreas.length > 0 && ` Development is boosted across ${completedAreas.map(a => a.name).join(', ')}.`}
                  </p>
                </div>

                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200">
                  <h4 className="font-semibold text-slate-800 mb-2 text-sm">Strengths Improvised by Buddy360</h4>
                  <ul className="space-y-1.5">
                    {strengths.map((strength, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                        <span className="text-emerald-500 mt-0.5">✓</span>
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200">
                  <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                    <Award className="w-4 h-4 text-emerald-600" />
                    Accomplishments & Milestones
                  </h4>
                  <div className="space-y-3">
                    {buddy360Milestones.map((milestone, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-16 flex-shrink-0 text-xs font-medium text-emerald-700">Age {milestone.age}</div>
                        <div className="flex-1 text-sm text-slate-700 font-medium">{milestone.text}</div>
                        {milestone.area !== 'Core' && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full text-white flex-shrink-0 self-start"
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="space-y-4"
            >
              <h2 className="text-2xl font-bold text-slate-800">Growth Area Insights</h2>
              <p className="text-slate-500">Recommendations for each area for {childData?.name}</p>

              {completedAreas.map((area, idx) => {
                const color = areaColors[area.id] || '#10b981';
                const recs = area.recommendations || [];
                const answers = area.answers || {};
                return (
                  <motion.div
                    key={area.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * idx }}
                    className="bg-white rounded-3xl p-6 border-2 border-slate-100 shadow-sm"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <span
                        className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        {idx + 1}
                      </span>
                      <h3 className="text-xl font-bold text-slate-800">{area.name}</h3>
                      <span
                        className="ml-auto text-xs px-2 py-1 rounded-full text-white font-medium"
                        style={{ backgroundColor: color }}
                      >
                        Completed
                      </span>
                    </div>



                    {recs.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">3-Month Recommendations</p>
                        <ul className="space-y-2">
                          {recs.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <span
                                className="flex-shrink-0 w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold mt-0.5"
                                style={{ backgroundColor: color }}
                              >
                                {i + 1}
                              </span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {recs.length === 0 && (
                      <p className="text-sm text-slate-400 italic">No recommendations generated for this area yet.</p>
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
              <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 shadow-2xl border-2 border-amber-200">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <Sparkles className="w-8 h-8 text-amber-400" />
                  <span className="text-3xl">🎉</span>
                  <Sparkles className="w-8 h-8 text-amber-400" />
                </div>
                <p className="text-slate-800 text-2xl md:text-3xl font-bold leading-relaxed">
                  Welcome{' '}
                  <span className="text-teal-600">{user?.full_name?.split(' ')[0] || 'Parent'}</span>
                  {' '}and{' '}
                  <span className="text-emerald-600">{childData.name}</span>
                  {' '}to Buddy360. We look forward to powering up your life in all possible dimensions.
                </p>
              </div>
            )}
            <div className="max-w-3xl mx-auto">
              <p className="text-slate-500 mt-2">Click below to continue this interesting journey with Buddy360.</p>
            </div>
            {/* sm+: left | center | right; mobile: stacked full-width */}
            <div className="grid w-full grid-cols-1 gap-3 pt-4 sm:grid-cols-3 sm:items-center">
              <div className="flex w-full sm:justify-start">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border-2"
                >
                  ← Back
                </Button>
              </div>
              <div className="flex w-full sm:justify-center">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const existingChildren = await api.entities.Child.list('-created_date');
                      await Promise.all(existingChildren.map((c) => api.entities.Child.delete(c.id)));
                      await api.userAppState.patch(patchBodyClearKeys(USER_APP_FULL_ONBOARDING_KEYS));
                    } catch {
                      /* ignore */
                    }
                    window.location.href = createPageUrl('Onboarding');
                  }}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl border-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                >
                  🔄 Start Over
                </Button>
              </div>
              <div className="flex w-full sm:justify-end">
                <Button
                  onClick={handleStartJourney}
                  className="h-11 w-full sm:w-auto px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold shadow-xl shadow-teal-500/25"
                >
                  Continue Journey
                  <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Concern Modal */}
      {showConcernModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={closeConcernModal}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative bg-white rounded-3xl p-8 pt-12 max-w-lg w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeConcernModal}
              className="absolute top-4 right-4 rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
            {!concernSubmitted ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">One last thing!</h3>
                    <p className="text-sm text-slate-500">Buddy360 wants to know</p>
                  </div>
                </div>
                <p className="text-slate-700 text-lg leading-relaxed">
                  Hey <span className="font-semibold text-teal-600">{user?.full_name?.split(' ')[0] || 'there'}</span>, is there anything that you want Buddy360 to work on currently with respect to <span className="font-semibold text-emerald-600">{childData?.name}</span>?
                </p>
                <TextareaWithVoice
                  value={concernInput}
                  onChange={(e) => setConcernInput(e.target.value)}
                  placeholder={`e.g., I want to improve English speaking skills for ${childData?.name}.`}
                  className="w-full min-h-[120px] p-4 rounded-2xl border-2 border-slate-200 focus:border-teal-400 focus:outline-none text-slate-700 resize-none"
                />
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={handleProceedToDashboard}
                    className="flex-1 h-12 rounded-2xl border-2"
                  >
                    Skip for now
                  </Button>
                  <Button
                    onClick={handleConcernSubmit}
                    disabled={!concernInput.trim()}
                    className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 disabled:opacity-50"
                  >
                    Submit
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                  <span className="text-3xl">✅</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-xl mb-2">Got it!</h3>
                  <p className="text-slate-600 text-lg leading-relaxed">
                    I got that. We will work with <span className="font-semibold text-emerald-600">{childData?.name}</span> on the same.
                  </p>
                </div>
                <Button
                  onClick={handleProceedToDashboard}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
                >
                  Go to Dashboard
                  <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}