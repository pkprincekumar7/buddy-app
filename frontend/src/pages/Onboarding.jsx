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
import { CHATBOT_CAPTURED_FIELDS, normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
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
  recPhaseHasNext: false,
  activeChildId: null,
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
    case 'SET_REC_PHASE_HAS_NEXT':
      return { ...state, recPhaseHasNext: action.payload };
    case 'SET_ACTIVE_CHILD_ID':
      return { ...state, activeChildId: action.payload };
    case 'RESET_WIZARD':
      return {
        ...initialWizardState,
        // Preserve auth/hydration state — user is still logged in and the page is already initialized.
        hydrated: state.hydrated,
        appStateReady: state.appStateReady,
        conversationBootKey: state.conversationBootKey + 1,
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
    recPhaseHasNext, activeChildId,
  } = state;
  const wizardBusy = personalityBusy || journeyBusy || completionBusy;
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const recPhaseBackRef = useRef(null);
  const recPhaseNextRef = useRef(null);

  // Delegate phase-specific LLM effects to dedicated hooks.
  usePersonalityAnalysis({ hydrated, currentPhase, activeChildId, dispatch });
  useJourneyRecommendations({ hydrated, currentPhase, activeChildId, dispatch });

  const handleComplete = useOnboardingComplete({
    dispatch, activeChildId, childData, recommendations,
  });

  useEffect(() => {
    if (isLoadingAuth) return;
    let cancelled = false;

    const hydrateFromServer = async () => {
      if (!isAuthenticated) {
        dispatch({ type: 'SET_HYDRATED', payload: true });
        dispatch({ type: 'SET_APP_STATE_READY', payload: true });
        dispatch({ type: 'BUMP_CONVERSATION_KEY' });
        return;
      }
      dispatch({ type: 'SET_APP_STATE_READY', payload: false });
      try {
        // All state lives on the child record — resume with the most recent child.
        const list = await api.entities.Child.list('-created_date', 1);
        if (cancelled) return;
        const child = list?.[0];

        if (child) {
          dispatch({ type: 'SET_ACTIVE_CHILD_ID', payload: child.id });
          dispatch({ type: 'SET_PHASE', payload: child.onboarding_phase || 1 });

          // Restore child data from the child record fields.
          const normalized = normalizeOnboardingChildDataBlob(child);
          if (normalized) dispatch({ type: 'SET_CHILD_DATA', payload: mergeChildDraft(normalized) });

          // Restore personality if already analysed.
          if (child.personality?.view_model?.type && child.personality?.view_model?.profile) {
            const clampedVm = maybeClampStoredPersonalityDescription(child.personality.view_model, {
              analysisSource: child.personality.source,
            });
            dispatch({ type: 'SET_MBTI_RESULT', payload: clampedVm });
            dispatch({ type: 'SET_GENERATED_PROFILE', payload: onboardingProfileFromViewModel(clampedVm) });
          }

          if (child.recommendations) dispatch({ type: 'SET_RECOMMENDATIONS', payload: child.recommendations });
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

  // Creates a child stub at chatbot start; all subsequent writes go directly to the child record.
  const handleStartChat = useCallback(async () => {
    if (!isAuthenticated) { dispatch({ type: 'SET_PHASE', payload: 1 }); return; }
    let childId = activeChildId;
    try {
      if (!childId) {
        const created = await api.entities.Child.create({ onboarding_phase: 1, onboarding_completed: false });
        childId = created?.id;
        if (childId) dispatch({ type: 'SET_ACTIVE_CHILD_ID', payload: childId });
      }
    } catch (err) {
      console.warn('[Onboarding] Could not create child stub, proceeding anyway:', err);
    }
    dispatch({ type: 'SET_PHASE', payload: 1 });
  }, [isAuthenticated, activeChildId, dispatch]);

  const handleConversationComplete = useCallback(async (conversationData) => {
    const mergedDraft = mergeChildDraft({
      ...childData,
      ...conversationData,
    });

    dispatch({ type: 'SET_MBTI_RESULT', payload: null });
    dispatch({ type: 'SET_GENERATED_PROFILE', payload: null });
    dispatch({ type: 'SET_RECOMMENDATIONS', payload: null });

    const childId = activeChildId;
    try {
      if (childId) {
        // Update stub with real chatbot data and advance phase; everything lives on the child record.
        await api.entities.Child.update(childId, {
          ...mergedDraft,
          onboarding_phase: 2,
          onboarding_completed: false,
          personality: null,
          recommendations: null,
        });
        await api.recommendationsProgress.patch(childId, { step: 'intro' });
      }
    } catch (err) {
      console.warn('[Onboarding] Could not update child after chatbot:', err);
    }

    dispatch({ type: 'SET_CHILD_DATA', payload: mergedDraft });
    dispatch({ type: 'SET_PHASE', payload: 2 });
  }, [childData, activeChildId, dispatch]);

  const handleWizardStartOver = useCallback(async () => {
    // Deleting the child cascades all related data (goals, recommendations, growth_areas).
    // No separate onboarding reset needed — all state lives on the child record.
    if (activeChildId) {
      try { await api.entities.Child.delete(activeChildId); } catch (err) { if (err?.status !== 404) console.warn('[Onboarding] Child delete failed:', err); }
    }
    queryClient.invalidateQueries({ queryKey: ['children'] });
    dispatch({ type: 'RESET_WIZARD' });
  }, [activeChildId, queryClient, dispatch]);

  const handleNext = useCallback(async () => {
    if (currentPhase === 2 && activeChildId) {
      try {
        await Promise.all([
          api.recommendationsProgress.patch(activeChildId, { step: 'intro' }),
          api.entities.Child.update(activeChildId, { onboarding_phase: 3 }),
        ]);
      } catch (err) {
        console.warn('[Onboarding] Could not advance to phase 3:', err);
      }
    }
    dispatch({ type: 'INCREMENT_PHASE' });
  }, [currentPhase, activeChildId, dispatch]);

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
        return <WelcomePhase onContinue={handleStartChat} isAuthenticated={isAuthenticated} user={user} />;
      case 1:
        return (
          <ConversationalOnboarding
            key={conversationBootKey}
            user={user}
            activeChildId={activeChildId}
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
                  activeChildId={activeChildId}
                  onFinish={handleComplete}
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
                  disabled={completionBusy}
                  className="h-12 w-full sm:w-auto px-8 rounded-2xl btn-primary disabled:opacity-50"
                >
                  Finish
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              ) : currentPhase === 3 ? (
                <Button
                  onClick={handleComplete}
                  disabled={completionBusy}
                  className="h-12 w-full sm:w-auto px-8 rounded-2xl btn-primary disabled:opacity-50"
                >
                  Finish
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
