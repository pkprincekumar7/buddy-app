import { useEffect, useRef, useReducer, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, RotateCcw } from 'lucide-react';
import { createPageUrl } from "@/utils";

import WelcomePhase from '../components/onboarding/WelcomePhase';
import ConversationalOnboarding from '../components/onboarding/ConversationalOnboarding';
import PersonalityAnalysis from '../components/shared/PersonalityAnalysis';
import RecommendationsPhase from '../components/onboarding/RecommendationsPhase';
import { slimChildConversationForStorage, pickSavedQuestionnaireForChatbot, CHATBOT_CAPTURED_FIELDS, normalizeOnboardingChildDataBlob, conversationDraftFromChildRecord } from '@/lib/onboardingChildData';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { DEFAULT_CHILD_STATE, mergeChildDraft } from '@/lib/onboardingHelpers';
import { usePersonalityAnalysis } from '@/hooks/usePersonalityAnalysis';
import { useJourneyRecommendations } from '@/hooks/useJourneyRecommendations';
import { useOnboardingComplete } from '@/hooks/useOnboardingComplete';
import { SPINNER, PAGE_SLIDE } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';

const phases = [
  { id: 'welcome', label: 'Welcome', icon: '👋' },
  { id: 'conversation', label: 'Getting to Know', icon: '💬' },
  { id: 'personality', label: 'Personality Analysis', icon: '⭐' },
  { id: 'recommendations', label: 'Your Journey', icon: '💡' }
];

// ─── Wizard state management ─────────────────────────────────────────────────

const initialWizardState = {
  currentPhase: 0,
  hydrated: false,
  appStateReady: false,
  conversationBootKey: 0,
  personalityBusy: false,
  journeyBusy: false,
  completionBusy: false,
  childData: { ...DEFAULT_CHILD_STATE },
  mbtiResult: null,
  generatedProfile: null,
  recommendations: null,
  pendingActivities: [],
  recPhaseHasNext: false,
};

function wizardReducer(state, action) {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, currentPhase: action.payload };
    case 'INCREMENT_PHASE':
      return { ...state, currentPhase: Math.min(state.currentPhase + 1, phases.length - 1) };
    case 'DECREMENT_PHASE':
      return { ...state, currentPhase: Math.max(state.currentPhase - 1, 0) };
    case 'SET_HYDRATED':
      return { ...state, hydrated: action.payload };
    case 'SET_APP_STATE_READY':
      return { ...state, appStateReady: action.payload };
    case 'BUMP_CONVERSATION_KEY':
      return { ...state, conversationBootKey: state.conversationBootKey + 1 };
    case 'SET_PERSONALITY_BUSY':
      return { ...state, personalityBusy: action.payload };
    case 'SET_JOURNEY_BUSY':
      return { ...state, journeyBusy: action.payload };
    case 'SET_COMPLETION_BUSY':
      return { ...state, completionBusy: action.payload };
    case 'SET_CHILD_DATA':
      return { ...state, childData: action.payload };
    case 'MERGE_CHILD_DATA':
      return { ...state, childData: mergeChildDraft({ ...state.childData, ...action.payload }) };
    case 'CLEAR_CHATBOT_FIELDS': {
      const next = { ...state.childData };
      for (const k of CHATBOT_CAPTURED_FIELDS) delete next[k];
      return { ...state, childData: mergeChildDraft(next) };
    }
    case 'SET_MBTI_RESULT':
      return { ...state, mbtiResult: action.payload };
    case 'SET_GENERATED_PROFILE':
      return { ...state, generatedProfile: action.payload };
    case 'SET_RECOMMENDATIONS':
      return { ...state, recommendations: action.payload };
    case 'ADD_PENDING_ACTIVITY':
      return { ...state, pendingActivities: [...state.pendingActivities, action.payload] };
    case 'SET_REC_PHASE_HAS_NEXT':
      return { ...state, recPhaseHasNext: action.payload };
    case 'RESET_WIZARD':
      return {
        ...initialWizardState,
        conversationBootKey: state.conversationBootKey + 1,
        currentPhase: 1,
      };
    default:
      return state;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const {
    currentPhase, hydrated, appStateReady, conversationBootKey,
    personalityBusy, journeyBusy, completionBusy,
    childData, mbtiResult, generatedProfile, recommendations,
    pendingActivities, recPhaseHasNext,
  } = state;
  const wizardBusy = personalityBusy || journeyBusy || completionBusy;
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const recPhaseBackRef = useRef(null);
  const recPhaseNextRef = useRef(null);
  const phasePatchTimerRef = useRef(null);

  // Delegate phase-specific LLM effects to dedicated hooks.
  usePersonalityAnalysis({ hydrated, currentPhase, dispatch });
  useJourneyRecommendations({ hydrated, currentPhase, dispatch });

  const handleComplete = useOnboardingComplete({
    dispatch, childData, mbtiResult, generatedProfile, recommendations, pendingActivities,
  });

  useEffect(() => {
    if (isLoadingAuth) return;
    let cancelled = false;

    const applyServerState = (s) => {
      if (typeof s.phase === 'number') dispatch({ type: 'SET_PHASE', payload: s.phase });

      if (s.child_data) {
        const normalizedChild = normalizeOnboardingChildDataBlob(s.child_data);
        if (normalizedChild) dispatch({ type: 'SET_CHILD_DATA', payload: mergeChildDraft(normalizedChild) });
      }

      if (s.personality?.view_model) {
        const vm = s.personality.view_model;
        if (vm?.type && vm?.profile) {
          const clampedVm = maybeClampStoredPersonalityDescription(vm, {
            analysisSource: s.personality.source,
          });
          dispatch({ type: 'SET_MBTI_RESULT', payload: clampedVm });
          dispatch({ type: 'SET_GENERATED_PROFILE', payload: onboardingProfileFromViewModel(clampedVm) });
        }
      }

      if (s.recommendations) dispatch({ type: 'SET_RECOMMENDATIONS', payload: s.recommendations });
    };

    const hydrateFromServer = async () => {
      if (!isAuthenticated) {
        dispatch({ type: 'SET_HYDRATED', payload: true });
        dispatch({ type: 'SET_APP_STATE_READY', payload: true });
        dispatch({ type: 'BUMP_CONVERSATION_KEY' });
        return;
      }
      dispatch({ type: 'SET_APP_STATE_READY', payload: false });
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
          } catch (err) {
            console.warn('[Onboarding] Could not fetch child list during hydration:', err);
          }
          const fromChild = conversationDraftFromChildRecord(childRecord);
          if (fromChild) {
            mergedForChat = mergeChildDraft({ ...(fromChild || {}), ...(normalized || {}) });
            slimCheck = pickSavedQuestionnaireForChatbot(mergedForChat);
            if (Object.keys(slimCheck).length > 0) {
              dispatch({ type: 'SET_CHILD_DATA', payload: mergedForChat });
              const slim = slimChildConversationForStorage(mergedForChat);
              if (Object.keys(slim).length > 0) {
                void api.onboarding.patch({ child_data: slim }).catch((err) => {
                  console.warn('[Onboarding] Auto-save child data failed:', err);
                });
              }
            }
          }
        }

        if (!cancelled) dispatch({ type: 'BUMP_CONVERSATION_KEY' });
      } catch (err) {
        console.warn('[Onboarding] Server hydration failed:', err);
      } finally {
        if (!cancelled) {
          dispatch({ type: 'SET_HYDRATED', payload: true });
          dispatch({ type: 'SET_APP_STATE_READY', payload: true });
        }
      }
    };

    void hydrateFromServer();
    return () => { cancelled = true; };
  }, [isLoadingAuth, isAuthenticated, queryClient]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [currentPhase]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    clearTimeout(phasePatchTimerRef.current);
    phasePatchTimerRef.current = setTimeout(() => {
      api.onboarding.patch({ phase: currentPhase }).catch((err) => {
        console.warn('[Onboarding] Auto-save phase failed:', err);
      });
    }, 500);
    return () => clearTimeout(phasePatchTimerRef.current);
  }, [currentPhase, hydrated, isAuthenticated]);

  const handleConversationComplete = useCallback(async (conversationData) => {
    const mergedDraft = mergeChildDraft({
      ...childData,
      ...conversationData,
      personality_traits: conversationData.strengths || [],
      interests: conversationData.hobbies || [],
    });
    const slim = slimChildConversationForStorage(mergedDraft);

    dispatch({ type: 'SET_MBTI_RESULT', payload: null });
    dispatch({ type: 'SET_GENERATED_PROFILE', payload: null });
    dispatch({ type: 'SET_RECOMMENDATIONS', payload: null });

    try {
      await Promise.all([
        api.onboarding.patch({
          child_data: slim,
          clear_personality: true,
          clear_recommendations: true,
        }),
        api.recommendationsProgress.patch({ step: 'intro' }),
      ]);
    } catch (err) {
      console.warn('[Onboarding] Could not persist conversation data, still advancing wizard:', err);
    }

    dispatch({ type: 'SET_CHILD_DATA', payload: mergedDraft });
    dispatch({ type: 'SET_PHASE', payload: 2 });
  }, [childData, dispatch]);

  const handleWizardStartOver = useCallback(async () => {
    try {
      if (childData?.name) {
        const existingChildren = await api.entities.Child.list('-created_date');
        const match = existingChildren?.find(
          c => c.name?.toLowerCase() === childData.name.toLowerCase()
        );
        if (match) {
          try { await api.entities.Child.delete(match.id); } catch (err) { if (err?.status !== 404) console.warn('[Onboarding] Child delete failed:', err); }
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
    } catch (err) {
      console.warn('[Onboarding] Start over cleanup had errors:', err);
    }
    dispatch({ type: 'RESET_WIZARD' });
  }, [childData, queryClient, dispatch]);

  const handleNext = useCallback(async () => {
    if (currentPhase === 2) {
      try {
        await api.recommendationsProgress.patch({ step: 'intro' });
      } catch (err) {
        console.warn('[Onboarding] Could not patch recommendations progress:', err);
      }
    }
    dispatch({ type: 'INCREMENT_PHASE' });
  }, [currentPhase, dispatch]);

  const handleBack = useCallback(() => {
    dispatch({ type: 'DECREMENT_PHASE' });
  }, [dispatch]);


  const handleRegisterBack = useCallback((fn) => {
    recPhaseBackRef.current = fn;
  }, []);

  const handleRegisterNext = useCallback((fn) => {
    recPhaseNextRef.current = fn;
    dispatch({ type: 'SET_REC_PHASE_HAS_NEXT', payload: !!fn });
  }, []);

  const handleRecNext = useCallback(() => {
    recPhaseNextRef.current?.();
  }, []);

  const canProceed = useMemo(() => {
    switch(currentPhase) {
      case 0: return isAuthenticated;
      case 1: return false;
      case 2: return mbtiResult !== null;
      case 3: return true;
      default: return true;
    }
  }, [currentPhase, isAuthenticated, mbtiResult]);

  const renderPhase = () => {
    switch(currentPhase) {
      case 0:
        return <WelcomePhase onContinue={() => dispatch({ type: 'SET_PHASE', payload: 1 })} isAuthenticated={isAuthenticated} user={user} />;
      case 1:
        return (
          <ConversationalOnboarding
            key={conversationBootKey}
            user={user}
            resumeHydrationReady={hydrated && !isLoadingAuth && appStateReady}
            onContinueToPersonality={() => dispatch({ type: 'SET_PHASE', payload: 2 })}
            onQuestionnairePersisted={(slice) => dispatch({ type: 'MERGE_CHILD_DATA', payload: slice })}
            onQuestionnaireCleared={() => dispatch({ type: 'CLEAR_CHATBOT_FIELDS' })}
            onComplete={handleConversationComplete}
          />
        );
      case 2:
        return mbtiResult ? (
          <PersonalityAnalysis mbtiResult={mbtiResult} childName={childData.name} />
        ) : null;
      case 3:
        return null;
      default:
        return null;
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div {...SPINNER} className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isAuthenticated && !appStateReady) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <motion.div {...SPINNER} className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full" />
        <p className="text-sm text-slate-500 text-center max-w-sm">Restoring your onboarding progress from your account…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {currentPhase > 0 && (
        <div className="bg-sidebar/90 backdrop-blur-xl border-b-edge-faint sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
              {phases.slice(1).map((phase, index) => (
                <div
                  key={phase.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all whitespace-nowrap ${
                    index + 1 === currentPhase
                      ? 'bg-teal-500/10 border border-teal-500/25'
                      : index + 1 < currentPhase
                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                        : 'bg-ghost border-edge-faint opacity-50'
                  }`}
                >
                  <span className="text-base" aria-hidden="true">{phase.icon}</span>
                  <span className={`text-xs font-medium hidden sm:block ${
                    index + 1 === currentPhase ? 'text-teal-400' : index + 1 < currentPhase ? 'text-emerald-400' : 'text-slate-600'
                  }`}>
                    {phase.label}
                  </span>
                  {index + 1 < currentPhase && (
                    <span className="text-emerald-400 text-xs">✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
        <AnimatePresence mode="wait">
          <motion.div key={currentPhase} {...PAGE_SLIDE}>
            {wizardBusy ? (
              <div className="flex flex-col items-center justify-center py-20">
                <motion.div {...SPINNER} className="w-12 h-12 border-2 border-teal-500 border-t-transparent rounded-full mb-4" />
                <p className="text-slate-400 font-medium text-center max-w-md">
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
                  onActivityAdd={(activity) => dispatch({ type: 'ADD_PENDING_ACTIVITY', payload: activity })}
                  onRegisterBack={handleRegisterBack}
                  onRegisterNext={handleRegisterNext}
                  onPhaseBack={handleBack}
                />
              ) : (
                renderPhase()
              )
            )}
          </motion.div>
        </AnimatePresence>

        {!wizardBusy && currentPhase >= 2 && (
          <PageActions
            className="mt-12"
            left={
              <Button
                variant="outline"
                onClick={() => currentPhase === 3 && recPhaseBackRef.current ? recPhaseBackRef.current() : handleBack()}
                className="h-12 w-full sm:w-auto px-6 rounded-2xl btn-secondary transition-all"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            }
            center={
              <Button
                type="button"
                variant="outline"
                onClick={handleWizardStartOver}
                className="h-12 w-full sm:w-auto px-6 rounded-2xl btn-start-over transition-all"
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Start Over
              </Button>
            }
            right={
              currentPhase === 2 ? (
                <Button
                  onClick={handleNext}
                  disabled={!canProceed}
                  className="h-12 w-full sm:w-auto px-8 rounded-2xl btn-primary disabled:opacity-50"
                >
                  Continue
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              ) : currentPhase === 3 && recPhaseHasNext ? (
                <Button
                  onClick={handleRecNext}
                  className="h-12 w-full sm:w-auto px-8 rounded-2xl btn-primary"
                >
                  Next
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}
