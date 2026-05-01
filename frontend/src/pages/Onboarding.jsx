import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { debounce } from 'lodash';
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronLeft, Sparkles, TreeDeciduous, Loader2 } from 'lucide-react';
import { createPageUrl } from "@/utils";

import WelcomePhase from '../components/onboarding/WelcomePhase';
import ConversationalOnboarding from '../components/onboarding/ConversationalOnboarding';
import PersonalityAnalysis, { calculateMBTI } from '../components/shared/PersonalityAnalysis';
import RecommendationsPhase from '../components/onboarding/RecommendationsPhase';

const phases = [
  { id: 'welcome', label: 'Welcome', icon: '👋' },
  { id: 'conversation', label: 'Getting to Know', icon: '💬' },
  { id: 'personality', label: 'Personality Analysis', icon: '⭐' },
  { id: 'recommendations', label: 'Your Journey', icon: '💡' }
];

const DEFAULT_CHILD_STATE = {
  name: '',
  age: '',
  school: '',
  strengths: [],
  hobbies: [],
  thinking_pattern: '',
  communication_style: '',
  energy_level: '',
  social_preference: '',
  decision_making: '',
  structure_preference: '',
  avatar_style: 'explorer',
  pillar_scores: { cognitive: 25, emotional: 25, physical: 25, talent: 25, character: 25, future: 25 },
  current_phase: 'foundation',
  onboarding_completed: false
};

export default function Onboarding() {
  const debouncedPersistChild = useMemo(
    () => debounce((data) => api.userAppState.patch({ onboarding_childData: data }), 500),
    []
  );
  const debouncedPersistMbti = useMemo(
    () => debounce((data) => api.userAppState.patch({ onboarding_mbti: data }), 400),
    []
  );

  useEffect(() => {
    return () => {
      debouncedPersistChild.cancel();
      debouncedPersistMbti.cancel();
    };
  }, [debouncedPersistChild, debouncedPersistMbti]);

  const [currentPhase, setCurrentPhase] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [childData, setChildData] = useState(() => ({ ...DEFAULT_CHILD_STATE }));
  const [mbtiResult, setMbtiResult] = useState(null);
  const [generatedProfile, setGeneratedProfile] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [pendingActivities, setPendingActivities] = useState([]);
  const recPhaseBackRef = useRef(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authenticated = await api.auth.isAuthenticated();
        setIsAuthenticated(authenticated);
        if (authenticated) {
          const currentUser = await api.auth.me();
          setUser(currentUser);
        }
      } catch (e) {
        setIsAuthenticated(false);
      }
      setCheckingAuth(false);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (checkingAuth) return;
    let cancelled = false;

    const hydrateFromServer = async () => {
      try {
        if (isAuthenticated) {
          const s = await api.userAppState.get();
          if (cancelled) return;
          const ph = s.onboarding_phase;
          if (ph !== undefined && ph !== null && String(ph) !== '') {
            const n = typeof ph === 'number' ? ph : parseInt(String(ph), 10);
            if (!Number.isNaN(n)) setCurrentPhase(n);
          }
          if (s.onboarding_childData && typeof s.onboarding_childData === 'object') {
            setChildData({ ...DEFAULT_CHILD_STATE, ...s.onboarding_childData });
          }
          if (s.onboarding_mbti) setMbtiResult(s.onboarding_mbti);
          if (s.onboarding_profile) setGeneratedProfile(s.onboarding_profile);
          if (s.onboarding_recommendations) setRecommendations(s.onboarding_recommendations);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    hydrateFromServer();

    return () => {
      cancelled = true;
    };
  }, [checkingAuth, isAuthenticated]);

  useEffect(() => {
    if (!hydrated) return;
    api.userAppState.patch({ onboarding_phase: currentPhase }).catch(() => {});
  }, [currentPhase, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    debouncedPersistChild(childData);
  }, [childData, hydrated, debouncedPersistChild]);

  useEffect(() => {
    if (!hydrated || !mbtiResult) return;
    debouncedPersistMbti(mbtiResult);
  }, [mbtiResult, hydrated, debouncedPersistMbti]);

  const updateChildData = (updates) => {
    setChildData(prev => ({ ...prev, ...updates }));
  };

  const handleConversationComplete = (conversationData) => {
    const updatedData = {
      ...childData,
      ...conversationData,
      personality_traits: conversationData.strengths || [],
      interests: conversationData.hobbies || []
    };
    setChildData(updatedData);
    
    // Calculate MBTI
    const mbti = calculateMBTI(updatedData);
    setMbtiResult(mbti);
    
    setCurrentPhase(2); // Go to personality analysis
  };

  const calculateAge = (dob) => {
    if (!dob) return null;
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };

  const determinePhase = (age) => {
    if (!age) return 'foundation';
    if (age >= 15) return 'direction';
    if (age >= 12) return 'exploration';
    return 'foundation';
  };

  const generateProfile = async () => {
    // Profile is now generated from MBTI calculation
    if (mbtiResult) {
      const profile = {
        summary: mbtiResult.profile.description,
        top_strengths: mbtiResult.profile.strengths.map(s => ({ strength: s, description: '' })),
        personality_type: `${mbtiResult.type} - ${mbtiResult.profile.name}`,
        growth_areas: mbtiResult.profile.growthAreas
      };
      setGeneratedProfile(profile);
      api.userAppState.patch({ onboarding_profile: profile }).catch(() => {});
    }
  };

  const generateRecommendations = async () => {
    setIsLoading(true);
    
    const age = parseInt(childData.age) || 10;
    const phase = determinePhase(age);
    
    const prompt = `Based on this child's profile, generate personalized growth recommendations:

Name: ${childData.name}, Age: ${age}
School: ${childData.school}
Current Phase: ${phase}
Personality Type: ${mbtiResult?.type || 'Unknown'} - ${mbtiResult?.profile?.name || ''}

Strengths: ${childData.strengths?.join(', ') || 'Not specified'}
Hobbies: ${childData.hobbies?.join(', ') || 'Not specified'}
Thinking Pattern: ${childData.thinking_pattern}
Communication Style: ${childData.communication_style}
Energy Level: ${childData.energy_level}

Generate:
1. A personalized 9-year pathway overview (2-3 sentences)
2. 4 immediate focus areas (one per growth pillar: Mind, Heart, Body, Talent)
3. 3 suggested weekly missions to start with`;

    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            pathway_overview: { type: "string" },
            focus_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pillar: { type: "string" },
                  focus: { type: "string" },
                  why: { type: "string" }
                }
              }
            },
            initial_missions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  pillar: { type: "string" }
                }
              }
            }
          }
        }
      });

      await generateProfile();
      setRecommendations(result);
      if (result) {
        await api.userAppState.patch({ onboarding_recommendations: result });
      }
      setIsLoading(false);
      return result;
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
      // Still generate profile and proceed even if LLM fails
      await generateProfile();
      setIsLoading(false);
      return null;
    }
  };

  const handleNext = async () => {
    if (currentPhase === 2) {
      await generateRecommendations();
      await api.userAppState.patch({
        recommendations_progress: null,
        completed_growth_areas: null,
      });
    }
    setCurrentPhase((prev) => Math.min(prev + 1, phases.length - 1));
  };

  const handleBack = () => {
    setCurrentPhase(prev => Math.max(prev - 1, 0));
  };

  const handleComplete = async () => {
    setIsLoading(true);
    const age = parseInt(childData.age) || 10;
    const phase = determinePhase(age);
    
    // Check if child already exists
    const existingChildren = await api.entities.Child.list('-created_date', 1);
    const childExists = existingChildren && existingChildren.length > 0 && existingChildren[0].name === childData.name;
    
    const finalData = {
      ...childData,
      date_of_birth: new Date(new Date().setFullYear(new Date().getFullYear() - age)).toISOString().split('T')[0],
      current_phase: phase,
      onboarding_completed: true,
      personality_traits: childData.strengths || [],
      interests: childData.hobbies || [],
      mbti_type: mbtiResult?.type,
      generated_profile: generatedProfile,
      recommendations: recommendations
    };
    
    if (!childExists) {
      await api.entities.Child.create(finalData);
    }
    
    // Get the child (newly created or existing)
    const children = await api.entities.Child.list('-created_date', 1);
    const newChild = children[0];
    
    // Check if missions already exist for this child
    const existingMissions = await api.entities.GrowthMission.filter({ child_id: newChild.id });
    const missionsExist = existingMissions && existingMissions.length > 0;
    
    if (newChild) {
      const allMissions = [];
      
      // Create initial missions if recommendations exist
      if (recommendations?.initial_missions) {
        const pillarMap = {
          'Mind': 'cognitive',
          'Heart': 'emotional', 
          'Body': 'physical',
          'Talent': 'talent',
          'Character': 'character',
          'Future': 'future'
        };
        
        const missions = recommendations.initial_missions.map(m => ({
          child_id: newChild.id,
          title: m.title,
          description: m.description,
          pillar: pillarMap[m.pillar] || 'cognitive',
          status: 'active',
          difficulty: 'easy',
          week_number: 1
        }));
        
        allMissions.push(...missions);
      }
      
      // Create pending interactive activities from recommendations phase
      if (pendingActivities.length > 0) {
        const activityMissions = pendingActivities.map(activity => ({
          child_id: newChild.id,
          title: activity.title,
          description: activity.description,
          pillar: activity.pillar || 'future',
          status: 'active',
          difficulty: 'medium',
          week_number: 1,
          activity_type: 'interactive',
          activity_data: {
            questions: activity.questions || [],
            instructions: activity.instructions || [],
            estimated_time: activity.estimated_time || '10-15 min'
          }
        }));
        
        allMissions.push(...activityMissions);
      }
      
      if (allMissions.length > 0 && !missionsExist) {
        await api.entities.GrowthMission.bulkCreate(allMissions);
      }
    }
    
    setIsLoading(false);
    
    // Don't clear progress - let Life Journey handle it
    window.location.href = createPageUrl('LifePathway');
  };

  const canProceed = () => {
    switch(currentPhase) {
      case 0: return isAuthenticated;
      case 1: return false; // Handled by conversation component
      case 2: return mbtiResult !== null;
      case 3: return true;
      default: return true;
    }
  };

  const renderPhase = () => {
    switch(currentPhase) {
      case 0:
        return <WelcomePhase onContinue={() => setCurrentPhase(1)} isAuthenticated={isAuthenticated} user={user} />;
      case 1:
        return <ConversationalOnboarding user={user} onComplete={handleConversationComplete} />;
      case 2:
        return mbtiResult ? (
          <PersonalityAnalysis mbtiResult={mbtiResult} childName={childData.name} />
        ) : null;
      case 3:
        return null; // Rendered directly in AnimatePresence with onActivityAdd prop
      default:
        return null;
    }
  };

  if (checkingAuth) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30">
      {/* Phase Progress - hide on welcome */}
      {currentPhase > 0 && (
        <div className="bg-white/80 backdrop-blur-lg border-b border-slate-100 sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
              {phases.slice(1).map((phase, index) => (
                <div
                  key={phase.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all whitespace-nowrap ${
                    index + 1 === currentPhase 
                      ? 'bg-teal-50 border border-teal-200' 
                      : index + 1 < currentPhase 
                        ? 'bg-emerald-50 border border-emerald-200'
                        : 'bg-slate-50 border border-slate-200 opacity-50'
                  }`}
                >
                  <span className="text-lg">{phase.icon}</span>
                  <span className={`text-sm font-medium hidden sm:block ${
                    index + 1 === currentPhase ? 'text-teal-700' : index + 1 < currentPhase ? 'text-emerald-700' : 'text-slate-500'
                  }`}>
                    {phase.label}
                  </span>
                  {index + 1 < currentPhase && (
                    <span className="text-emerald-500 text-sm">✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPhase}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
          >
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full mb-4"
                />
                <p className="text-slate-600 font-medium">
                  {currentPhase === 2 ? "Creating your child's profile..." : "Generating personalized recommendations..."}
                </p>
              </div>
            ) : (
              currentPhase === 3 ? (
                <RecommendationsPhase 
                  data={childData} 
                  profile={generatedProfile} 
                  recommendations={recommendations}
                  onActivityAdd={(activity) => setPendingActivities(prev => [...prev, activity])}
                  onRegisterBack={(fn) => { recPhaseBackRef.current = fn; }}
                  onPhaseBack={handleBack}
                />
              ) : (
                renderPhase()
              )
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation - Back on phases 2+, Continue only on phase 2 */}
        {!isLoading && currentPhase >= 2 && (
          <div className="flex justify-between mt-12">
            <Button
              variant="outline"
              onClick={() => {
                if (currentPhase === 3 && recPhaseBackRef.current) {
                  recPhaseBackRef.current();
                } else {
                  handleBack();
                }
              }}
              className="h-12 px-6 rounded-2xl border-2 border-slate-200"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Back
            </Button>

            {currentPhase === 2 && (
              <Button
                onClick={handleNext}
                disabled={!canProceed()}
                className="h-12 px-8 rounded-2xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50"
              >
                Continue
                <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}