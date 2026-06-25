import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import PersonalityAnalysis, {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import type { MbtiResult } from '@/components/shared/PersonalityAnalysis';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { sanitizeViewModelAvatars, stripViewModelImages } from '@/lib/avatarUtils';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import { SPINNER } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';
import StartOverButton from '@/components/shared/StartOverButton';
import { useJob } from '@/hooks/useJob';

export default function PersonalityType() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [mbtiResult, setMbtiResult] = useState<Record<string, unknown> | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [showSplash, startTimer] = useStageSplash(0);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  // Stores merged child data for the onCompleted callback without re-render dependencies.
  const mergedDataRef = useRef<Record<string, unknown> | null>(null);

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ?? personality?.pending_view_model) as Record<string, unknown> | undefined;
      const merged = mergedDataRef.current;

      if (pendingVm && merged) {
        const vm = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
        // Show result immediately — don't block on the save.
        setMbtiResult(sanitizeViewModelAvatars(vm));
        // Strip SVG data-URI images before saving — WAF blocks payloads containing
        // <svg>/<text> tags. sanitizeViewModelAvatars regenerates them on next load.
        api.entities.Child.update(childId, {
          personality: { source: 'llm', view_model: stripViewModelImages(vm) },
          onboarding_phase: 2,
        }).catch((err) => console.error('[PersonalityType] Failed to persist personality:', err));
      } else if (personality?.view_model?.type && personality?.view_model?.profile) {
        // Another device already finalized — use that result
        const clamped = maybeClampStoredPersonalityDescription(personality.view_model, {
          analysisSource: personality?.source,
        });
        setMbtiResult(sanitizeViewModelAvatars(clamped));
      }
    } catch (err) {
      console.error('[PersonalityType] Failed to finalize personality:', err);
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_personality_analysis',
    onCompleted: finalizePersonality,
  });

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [child, prefs] = await Promise.all([
          api.entities.Child.get(childId),
          api.preferences.get().catch(() => null),
        ]);
        if (cancelled) return;

        if (!child) {
          navigate('/Home', { replace: true });
          return;
        }

        if (prefs && typeof prefs.tts_enabled === 'boolean') {
          setTtsEnabled(prefs.tts_enabled);
        }

        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        mergedDataRef.current = merged as Record<string, unknown>;
        setChildName(merged.name || '');
        setChildData(child as Record<string, unknown>);

        // Already analysed — show result immediately
        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (viewModel?.type && viewModel?.profile) {
          const clamped = maybeClampStoredPersonalityDescription(viewModel, {
            analysisSource: personality?.source,
          });
          setMbtiResult(sanitizeViewModelAvatars(clamped));
          setIsInitializing(false);
          return;
        }

        // pending_personality_vm means worker succeeded but client crashed before finalizing
        const pendingVm = (child.pending_personality_vm ?? personality?.pending_view_model) as Record<string, unknown> | undefined;
        if (pendingVm) {
          const vm = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
          if (cancelled) return;
          setMbtiResult(sanitizeViewModelAvatars(vm));
          setIsInitializing(false);
          api.entities.Child.update(childId, {
            personality: { source: 'llm', view_model: stripViewModelImages(vm) },
            onboarding_phase: 2,
          }).catch((err) => console.error('[PersonalityType] Failed to persist recovered personality:', err));
          return;
        }

        if (!merged.name?.trim()) {
          navigate(`/ConversationalOnboarding/${childId}`, { replace: true });
          return;
        }

        // Only enqueue if no active job is already polling (useJob picks it up via childData)
        const activeJobId = (child.active_jobs as Record<string, string> | undefined)
          ?.generate_personality_analysis;
        if (!activeJobId) {
          await job.enqueue({
            type: 'generate_personality_analysis',
            child_id: childId,
            payload: {
              prompt: buildPersonalityAnalysisPrompt({
                childData: merged,
                personalityTypeKeys: PERSONALITY_TYPE_KEYS,
              }),
              response_json_schema: personalityLlmSchema(),
            },
            write_back: { collection: 'children', filter: {}, field: 'pending_personality_vm' },
          });
        }
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityType] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => { cancelled = true; };
    // job.enqueue intentionally excluded — stable ref, but adding it re-triggers the
    // effect after the enqueue updates job state causing a double-enqueue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const isAnalysing = !isInitializing && job.isLoading;
  const isError = initError || job.isFailed;
  const status = isLoadingAuth || isInitializing
    ? 'loading'
    : isAnalysing
      ? 'analysing'
      : isError
        ? 'error'
        : mbtiResult
          ? 'ready'
          : 'analysing';

  const handleContinue = async () => {
    if (childId) {
      await api.entities.Child.update(childId, { onboarding_phase: 3 }).catch(() => {});
    }
    navigate(`/PersonalityJourney/${childId}`);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || status === 'loading' ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
            />
          </div>
        ) : status === 'analysing' ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
            <motion.div
              {...SPINNER}
              className="h-12 w-12 rounded-full border-2 border-primary border-t-transparent"
            />
            <p className="max-w-md text-center font-medium text-muted-foreground">
              Shaping personality insights from your questionnaire…
            </p>
          </div>
        ) : status === 'error' || !mbtiResult ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
            <p className="text-muted-foreground">Something went wrong. Please try again.</p>
            <Button
              onClick={() => navigate(childId ? `/ConversationalOnboarding/${childId}` : '/Home')}
              className="btn-primary rounded-2xl px-8"
            >
              Go Back
            </Button>
          </div>
        ) : (
          <div key={showSplash ? 'splash' : 'content'} className="min-h-screen bg-background">
            {/* Progress indicator */}
            <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
              <div className="mx-auto max-w-4xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {[
                    { label: 'Getting to Know', icon: '💬', done: true },
                    { label: 'Personality Analysis', icon: '⭐', active: true },
                    { label: 'Your Journey', icon: '💡', active: false },
                  ].map((phase) => (
                    <div
                      key={phase.label}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 transition-all ${
                        phase.active
                          ? 'border border-primary/25 bg-primary/10'
                          : phase.done
                            ? 'border border-success/20 bg-success/10'
                            : 'bg-ghost border-edge-faint opacity-50'
                      }`}
                    >
                      <span className="text-base" aria-hidden="true">
                        {phase.icon}
                      </span>
                      <span
                        className={`hidden text-xs font-medium sm:block ${phase.active ? 'text-primary' : phase.done ? 'text-success-bright' : 'text-muted-foreground'}`}
                      >
                        {phase.label}
                      </span>
                      {phase.done && <span className="text-xs text-success-bright">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
              <PersonalityAnalysis
                mbtiResult={mbtiResult as unknown as MbtiResult}
                childName={childName}
                ready={!showSplash}
                ttsEnabled={ttsEnabled}
              />

              <PageActions
                className="mt-12"
                left={
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate(`/ConversationalOnboarding/${childId}`, {
                        state: { fromBack: true },
                      })
                    }
                    className="btn-secondary h-12 w-full rounded-2xl px-6 text-base sm:w-auto"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                }
                center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
                right={
                  <Button
                    size="xl"
                    onClick={() => {
                      void handleContinue();
                    }}
                    className="btn-primary w-full rounded-2xl px-8 sm:w-auto"
                  >
                    Continue
                    <ChevronRight className="ml-1 h-5 w-5" />
                  </Button>
                }
              />
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={2} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
