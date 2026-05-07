import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, RotateCcw } from 'lucide-react';
import { createPageUrl } from "@/utils";

import WelcomePhase from '../components/onboarding/WelcomePhase';
import ConversationalOnboarding from '../components/onboarding/ConversationalOnboarding';
import PersonalityAnalysis, {
  calculateMBTI,
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '../components/shared/PersonalityAnalysis';
import RecommendationsPhase from '../components/onboarding/RecommendationsPhase';
import { slimChildConversationForStorage, pickSavedQuestionnaireForChatbot, CHATBOT_CAPTURED_FIELDS, normalizeOnboardingChildDataBlob, conversationDraftFromChildRecord } from '@/lib/onboardingChildData';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';

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

function mergeChildDraft(partial) {
  return {
    ...DEFAULT_CHILD_STATE,
    ...(partial && typeof partial === 'object' ? partial : {}),
  };
}

/** Human-readable questionnaire lines for prompts (persisted questionnaire fields only). */
function questionnaireMarkdown(mergedDraft) {
  const slim = slimChildConversationForStorage(mergedDraft);
  const labelFor = {
    name: 'Name',
    age: 'Age',
    school: 'School',
    strengths: 'Top strengths',
    hobbies: 'Hobbies',
    thinking_pattern: 'Thinking pattern',
    communication_style: 'Communication style',
    energy_level: 'Energy level',
    social_behaviour: 'Social behaviour',
    emotional_behaviour: 'Emotional behaviour',
  };
  const pairs = [];
  for (const [k, v] of Object.entries(slim)) {
    const lbl = labelFor[k] || k;
    if (Array.isArray(v)) pairs.push(`${lbl}: ${v.join(', ')}`);
    else pairs.push(`${lbl}: ${String(v)}`);
  }
  return pairs.length ? pairs.join('\n') : '(no questionnaire stored yet)';
}

function personalityLlmSchema() {
  const styleEnumItem = PERSONALITY_TYPE_KEYS.length
    ? { type: 'string', enum: [...PERSONALITY_TYPE_KEYS] }
    : { type: 'string' };
  return {
    type: 'object',
    properties: {
      dominant_style: styleEnumItem,
      personality_category: {
        type: 'string',
        enum: ['motivators', 'socializers', 'creatives', 'adventurers'],
      },
      secondary_styles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            personality_style: styleEnumItem,
            prominence: { type: 'number' },
          },
        },
      },
      personalized_traits: { type: 'array', items: { type: 'string' }, minItems: 4 },
      personalized_description: { type: 'string', maxLength: 180 },
      personalized_growth_areas: { type: 'array', items: { type: 'string' }, minItems: 3 },
      role_models: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        minItems: 2,
      },
      strength_summary_bullets: { type: 'array', items: { type: 'string' }, minItems: 3 },
    },
    required: [
      'dominant_style',
      'personality_category',
      'secondary_styles',
      'personalized_traits',
      'personalized_description',
      'personalized_growth_areas',
      'role_models',
      'strength_summary_bullets',
    ],
  };
}

function recommendationsJourneySchema() {
  return {
    type: 'object',
    properties: {
      pathway_overview: { type: 'string' },
      focus_areas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pillar: { type: 'string' },
            focus: { type: 'string' },
            why: { type: 'string' },
          },
        },
      },
      initial_missions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            pillar: { type: 'string' },
          },
        },
      },
    },
  };
}

export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentPhase, setCurrentPhase] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  /** Authed: false until GET /user/app-state finishes; guest: set true in hydrate effect. Chat must not mount before this. */
  const [appStateReady, setAppStateReady] = useState(false);
  /** Bump after server hydration so chat remounts with fresh refs + savedAnswers (avoids stale session lock). */
  const [conversationBootKey, setConversationBootKey] = useState(0);
  const [personalityBusy, setPersonalityBusy] = useState(false);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const [completionBusy, setCompletionBusy] = useState(false);
  const wizardBusy = personalityBusy || journeyBusy || completionBusy;
  const { user, isAuthenticated, isLoadingAuth } = useAuth();

  const [childData, setChildData] = useState(() => ({ ...DEFAULT_CHILD_STATE }));
  const [mbtiResult, setMbtiResult] = useState(null);
  const [generatedProfile, setGeneratedProfile] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [pendingActivities, setPendingActivities] = useState([]);
  const recPhaseBackRef = useRef(null);
  const recPhaseNextRef = useRef(null);
  const [recPhaseHasNext, setRecPhaseHasNext] = useState(false);
  const personalityEffectStampRef = useRef(0);
  const journeyEffectStampRef = useRef(0);
  const phasePatchTimerRef = useRef(null);


  const determinePhase = (age) => {
    if (!age) return 'foundation';
    if (age >= 15) return 'direction';
    if (age >= 12) return 'exploration';
    return 'foundation';
  };

  useEffect(() => {
    if (isLoadingAuth) return;
    let cancelled = false;

    const applyServerState = (s) => {
      if (typeof s.phase === 'number') setCurrentPhase(s.phase);

      if (s.child_data) {
        const normalizedChild = normalizeOnboardingChildDataBlob(s.child_data);
        if (normalizedChild) setChildData(mergeChildDraft(normalizedChild));
      }

      if (s.personality?.view_model) {
        const vm = s.personality.view_model;
        if (vm?.type && vm?.profile) {
          const clampedVm = maybeClampStoredPersonalityDescription(vm, {
            analysisSource: s.personality.source,
          });
          setMbtiResult(clampedVm);
          setGeneratedProfile(onboardingProfileFromViewModel(clampedVm));
        }
      }

      if (s.recommendations) setRecommendations(s.recommendations);
    };

    const hydrateFromServer = async () => {
      if (!isAuthenticated) {
        setHydrated(true);
        setAppStateReady(true);
        setConversationBootKey((k) => k + 1);
        return;
      }
      setAppStateReady(false);
      try {
        const s = await api.onboarding.get();
        if (cancelled) return;
        queryClient.setQueryData(['onboarding'], s);
        applyServerState(s);

        const normalized = normalizeOnboardingChildDataBlob(s.child_data);
        let mergedForChat = mergeChildDraft(normalized || {});
        let slimCheck = pickSavedQuestionnaireForChatbot(mergedForChat);
        if (Object.keys(slimCheck).length === 0) {
          let childRecord = null;
          try {
            const list = await api.entities.Child.list('-created_date', 1);
            if (list?.length) childRecord = list[0];
          } catch {
            /* ignore */
          }
          const fromChild = conversationDraftFromChildRecord(childRecord);
          if (fromChild) {
            mergedForChat = mergeChildDraft({ ...(fromChild || {}), ...(normalized || {}) });
            slimCheck = pickSavedQuestionnaireForChatbot(mergedForChat);
            if (Object.keys(slimCheck).length > 0) {
              setChildData(mergedForChat);
              const slim = slimChildConversationForStorage(mergedForChat);
              if (Object.keys(slim).length > 0) {
                void api.onboarding.patch({ child_data: slim }).catch((err) => {
                  console.warn('Auto-save child data failed:', err);
                });
              }
            }
          }
        }

        if (!cancelled) setConversationBootKey((k) => k + 1);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          setHydrated(true);
          setAppStateReady(true);
        }
      }
    };

    void hydrateFromServer();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, queryClient]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    clearTimeout(phasePatchTimerRef.current);
    phasePatchTimerRef.current = setTimeout(() => {
      api.onboarding.patch({ phase: currentPhase }).catch((err) => {
        console.warn('Auto-save phase failed:', err);
      });
    }, 500);
    return () => clearTimeout(phasePatchTimerRef.current);
  }, [currentPhase, hydrated, isAuthenticated]);

  useEffect(() => {
    if (!hydrated || currentPhase !== 2) return;

    personalityEffectStampRef.current += 1;
    const stamp = personalityEffectStampRef.current;

    let cancelled = false;

    (async () => {
      try {
        const s = await api.onboarding.get();
        if (cancelled || stamp !== personalityEffectStampRef.current) return;

        const normalized = normalizeOnboardingChildDataBlob(s.child_data);
        const mergedFromServer = mergeChildDraft(normalized || {});

        if (s.personality?.view_model?.type && s.personality?.view_model?.profile) {
          const clampedReuse = maybeClampStoredPersonalityDescription(s.personality.view_model, {
            analysisSource: s.personality.source,
          });
          setMbtiResult(clampedReuse);
          setGeneratedProfile(onboardingProfileFromViewModel(clampedReuse));
          return;
        }

        if (!mergedFromServer.name?.trim?.()) {
          setMbtiResult(null);
          setGeneratedProfile(null);
          return;
        }

        if (cancelled || stamp !== personalityEffectStampRef.current) return;

        setPersonalityBusy(true);
        try {
          const prompt = `You analyze a single child using a Buddy360 onboarding questionnaire answered by their parent/caregiver.

Return JSON ONLY that conforms to the response schema.

Collected questionnaire responses:
"""
${questionnaireMarkdown(mergedFromServer)}
"""

Requirements:
• dominant_style must be EXACTLY one of: ${PERSONALITY_TYPE_KEYS.join(', ')}.
• personality_category must be one of: motivators, socializers, creatives, adventurers.
• secondary_styles: up to TWO additional entries from dominant_style enum (different archetypes each with prominence 40–92).
• personalized_traits: 4–6 succinct trait chips anchored in BOTH the questionnaire wording and calibrated interpretation.
• personalized_description: EXACTLY ONE short sentence (max ~160 characters), caregiver-facing; name "${String(mergedFromServer.name || '').replace(/"/g, '')}" naturally once; tie survey cues to temperament without invented facts; no second sentence, bullets, or line breaks.
• personalized_growth_areas: 4–7 crisp growth bullets aligned with the dominant temperament and parent's observations.
• role_models: EXACTLY two admirable real public figures relevant to temperament (full names).
• strength_summary_bullets: exactly 6 strength-focused bullets synthesized from parent's answers plus measured inference.
Stay evidence-led; acknowledge uncertainty subtly when extrapolating.`;

          if (cancelled || stamp !== personalityEffectStampRef.current) return;

          const ai = await api.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: personalityLlmSchema(),
          });
          if (cancelled || stamp !== personalityEffectStampRef.current) return;
          const vm = adaptAiPersonalityToViewModel(ai || {}, mergedFromServer.name);
          const prof = onboardingProfileFromViewModel(vm);
          await api.onboarding.patch({ personality: { source: 'llm', view_model: vm } });
          if (cancelled || stamp !== personalityEffectStampRef.current) return;
          setMbtiResult(vm);
          if (prof) setGeneratedProfile(prof);
        } catch {
          if (cancelled || stamp !== personalityEffectStampRef.current) return;
          const ruleVm = calculateMBTI(mergedFromServer);
          const prof = onboardingProfileFromViewModel(ruleVm);
          try {
            await api.onboarding.patch({ personality: { source: 'rule_fallback', view_model: ruleVm } });
          } catch {
            /* ignore */
          }
          if (cancelled || stamp !== personalityEffectStampRef.current) return;
          setMbtiResult(ruleVm);
          if (prof) setGeneratedProfile(prof);
        } finally {
          if (!cancelled && stamp === personalityEffectStampRef.current) setPersonalityBusy(false);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      setPersonalityBusy(false);
    };
  }, [hydrated, currentPhase]);

  useEffect(() => {
    if (!hydrated || currentPhase !== 3) return;

    journeyEffectStampRef.current += 1;
    const stamp = journeyEffectStampRef.current;

    let cancelled = false;

    (async () => {
      try {
        const s = await api.onboarding.get();
        if (cancelled || stamp !== journeyEffectStampRef.current) return;

        if (
          s.recommendations &&
          (typeof s.recommendations.pathway_overview === 'string' ||
            (Array.isArray(s.recommendations.focus_areas) && s.recommendations.focus_areas.length > 0))
        ) {
          setRecommendations(s.recommendations);
          return;
        }

        const normalizedChild = normalizeOnboardingChildDataBlob(s.child_data);
        const mergedChild = mergeChildDraft(normalizedChild || {});
        if (!mergedChild.name?.trim?.()) return;

        const vmJ = s.personality?.view_model;
        const gp = vmJ?.type && vmJ?.profile ? onboardingProfileFromViewModel(vmJ) : null;

        setJourneyBusy(true);
        if (cancelled || stamp !== journeyEffectStampRef.current) {
          setJourneyBusy(false);
          return;
        }

        const age = parseInt(String(mergedChild.age), 10) || 10;
        const lifePhase = determinePhase(age);

        const prompt = `Based on this child's onboarding questionnaire responses and synthesized personality briefing, propose personalized Buddy360 journey scaffolding.

Structured answers we already persisted:
"""
${questionnaireMarkdown(mergedChild)}
"""

AI personality synopsis:
• Archetype: ${gp?.personality_type || `${vmJ?.type || 'Unknown'} (${vmJ?.profile?.name || ''})`}
• Narrative: ${gp?.summary || '(unavailable)'}

Growth areas already highlighted for downstream experiences:
${Array.isArray(gp?.growth_areas) && gp.growth_areas.length ? gp.growth_areas.map((x) => `• ${x}`).join('\n') : '(not captured)'}

Logistics recap:
• Name / Age / Phase: ${mergedChild.name || 'unknown'}, Age ${age}, life-phase bucket ${lifePhase}
• School context: ${mergedChild.school || 'not captured'}
• Reported strengths parent listed: ${mergedChild.strengths?.join(', ') || 'unknown'}
• Interests referenced: ${mergedChild.hobbies?.join(', ') || 'unknown'}

Generate:
1. A personalized 9-year pathway overview (2–3 vivid sentences grounding in BOTH answers AND personality synopsis)
2. Four immediate growth focus areas spanning Mind, Heart, Body, Talent (explicit pillar labels — no repeats)
3. Three attainable starter weekly missions referencing strengths or hobbies cues when plausible`;

        try {
          if (cancelled || stamp !== journeyEffectStampRef.current) return;

          const result = await api.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: recommendationsJourneySchema(),
          });
          if (cancelled || stamp !== journeyEffectStampRef.current) return;
          setRecommendations(result);
          if (result) {
            await api.onboarding.patch({ recommendations: result });
          }
        } catch (error) {
          console.error('Failed to generate recommendations:', error);
        } finally {
          if (!cancelled && stamp === journeyEffectStampRef.current) setJourneyBusy(false);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      setJourneyBusy(false);
    };
  }, [hydrated, currentPhase]);

  const handleConversationComplete = async (conversationData) => {
    const mergedDraft = mergeChildDraft({
      ...childData,
      ...conversationData,
      personality_traits: conversationData.strengths || [],
      interests: conversationData.hobbies || [],
    });
    const slim = slimChildConversationForStorage(mergedDraft);

    setMbtiResult(null);
    setGeneratedProfile(null);
    setRecommendations(null);

    try {
      await Promise.all([
        api.onboarding.patch({
          child_data: slim,
          clear_personality: true,
          clear_recommendations: true,
        }),
        api.recommendationsProgress.patch({ step: 'intro' }),
      ]);
    } catch {
      /* still advance wizard */
    }

    setChildData(mergedDraft);
    setCurrentPhase(2);
  };

  const handleWizardStartOver = async () => {
    try {
      // Delete only the child currently being onboarded, matched by name (same
      // logic as handleComplete). If the child hasn't been saved to DB yet
      // (mid-wizard), no deletion happens — which is the correct behaviour.
      if (childData?.name) {
        const existingChildren = await api.entities.Child.list('-created_date');
        const match = existingChildren?.find(
          c => c.name?.toLowerCase() === childData.name.toLowerCase()
        );
        if (match) {
          try { await api.entities.Child.delete(match.id); } catch { /* 404 ok */ }
        }
      }
      await Promise.all([
        api.onboarding.patch({
          phase: 0,
          clear_child_data: true,
          clear_personality: true,
          clear_recommendations: true,
        }),
        api.recommendationsProgress.patch({ step: 'intro' }),
        api.goals.patch({ clear_plan: true, clear_concern: true }),
        api.completedGrowthAreas.clear(),
      ]);
      queryClient.invalidateQueries({ queryKey: ['children'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    } catch {
      /* ignore */
    }
    setPendingActivities([]);
    setRecommendations(null);
    setMbtiResult(null);
    setGeneratedProfile(null);
    setChildData({ ...DEFAULT_CHILD_STATE });
    setCurrentPhase(1);
    setConversationBootKey((k) => k + 1);
  };

  const handleNext = async () => {
    if (currentPhase === 2) {
      try {
        await api.recommendationsProgress.patch({ step: 'intro' });
      } catch {
        /* ignore */
      }
    }
    setCurrentPhase((prev) => Math.min(prev + 1, phases.length - 1));
  };

  const handleBack = () => {
    setCurrentPhase(prev => Math.max(prev - 1, 0));
  };

  const handleComplete = async () => {
    setCompletionBusy(true);
    try {
      const age = parseInt(childData.age, 10) || 10;
      const phase = determinePhase(age);

      // Check if child already exists (case-insensitive name match)
      const existingChildren = await api.entities.Child.list('-created_date', 1);
      const childExists =
        existingChildren &&
        existingChildren.length > 0 &&
        existingChildren[0].name?.toLowerCase() === childData.name?.toLowerCase();

      // Compute DOB accounting for whether the birthday has passed this year
      const today = new Date();
      const dob = new Date(today.getFullYear() - age, today.getMonth(), today.getDate());

      const finalData = {
        ...childData,
        date_of_birth: dob.toISOString().split('T')[0],
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

      // Single history entry; Back from Life Journey uses browser/history -1
      navigate(createPageUrl('LifePathway'), { replace: true });
    } catch {
      toast.error('Something went wrong saving your journey. Please try again.');
    } finally {
      setCompletionBusy(false);
    }
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
        return (
          <ConversationalOnboarding
            key={conversationBootKey}
            user={user}
            resumeHydrationReady={hydrated && !isLoadingAuth && appStateReady}
            onContinueToPersonality={() => setCurrentPhase(2)}
            onQuestionnairePersisted={(slice) =>
              setChildData((prev) => mergeChildDraft({ ...prev, ...slice }))
            }
            onQuestionnaireCleared={() =>
              setChildData((prev) => {
                const next = { ...prev };
                for (const k of CHATBOT_CAPTURED_FIELDS) delete next[k];
                return mergeChildDraft(next);
              })
            }
            onComplete={handleConversationComplete}
          />
        );
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

  if (isLoadingAuth) {
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

  if (isAuthenticated && !appStateReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex flex-col items-center justify-center gap-4 px-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full"
        />
        <p className="text-sm text-slate-600 text-center max-w-sm">Restoring your onboarding progress from your account…</p>
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
            {wizardBusy ? (
              <div className="flex flex-col items-center justify-center py-20">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full mb-4"
                />
                <p className="text-slate-600 font-medium text-center max-w-md">
                  {completionBusy
                    ? 'Saving journey data…'
                    : journeyBusy
                      ? 'Mapping personalized recommendations…'
                      : 'Shaping personality insights from your questionnaire…'}
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
                  onRegisterNext={(fn) => { recPhaseNextRef.current = fn; setRecPhaseHasNext(!!fn); }}
                  onPhaseBack={handleBack}
                />
              ) : (
                renderPhase()
              )
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation — mobile: stacked full-width; sm+: Back | Start Over | Continue */}
        {!wizardBusy && currentPhase >= 2 && (
          <div className="mt-12 flex w-full flex-col gap-3 sm:grid sm:grid-cols-3 sm:items-center">
            <div className="flex w-full sm:justify-start sm:justify-self-start">
              <Button
                variant="outline"
                onClick={() => {
                  if (currentPhase === 3 && recPhaseBackRef.current) {
                    recPhaseBackRef.current();
                  } else {
                    handleBack();
                  }
                }}
                className="h-12 w-full sm:w-auto px-6 rounded-2xl border-2 border-slate-200"
              >
                <ChevronLeft className="w-5 h-5 mr-1" />
                Back
              </Button>
            </div>
            <div className="flex w-full sm:justify-center sm:justify-self-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleWizardStartOver()}
                className="h-12 w-full sm:w-auto px-6 rounded-2xl border-2 border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                <RotateCcw className="w-5 h-5 mr-1" />
                Start Over
              </Button>
            </div>
            <div
              className={`flex w-full sm:justify-end sm:justify-self-end ${currentPhase === 2 || (currentPhase === 3 && recPhaseHasNext) ? '' : 'hidden sm:flex'}`}
            >
              {currentPhase === 2 ? (
                <Button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className="h-12 w-full sm:w-auto px-8 rounded-2xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50"
                >
                  Continue
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              ) : currentPhase === 3 && recPhaseHasNext ? (
                <Button
                  onClick={() => recPhaseNextRef.current?.()}
                  className="h-12 w-full sm:w-auto px-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
                >
                  Next
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              ) : (
                <span className="hidden sm:block sm:invisible sm:pointer-events-none sm:h-12 sm:w-px" aria-hidden />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}