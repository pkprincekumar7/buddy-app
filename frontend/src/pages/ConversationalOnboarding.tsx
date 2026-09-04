import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import PageLoader from '@/components/shared/PageLoader';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import { stripViewModelImages } from '@/lib/avatarUtils';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import { useJob } from '@/hooks/useJob';
import { Button } from '@/components/ui/button';
import type { EnqueueJobPayload } from '@/types/api';

export default function ConversationalOnboarding() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const childDataRef = useRef<Record<string, unknown> | null>(null);
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Holds the freshly-fetched child record so useJob can pick up active_jobs.
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  // True once handleComplete has kicked off personality analysis.
  const processingRef = useRef(false);
  const [jobFailed, setJobFailed] = useState(false);
  const jobPayloadRef = useRef<EnqueueJobPayload | null>(null);
  // bootKey is a static mount key for the chat component; held as a constant since it never changes.
  const bootKey = 0;

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;

        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }

        // Preload existing data — no auto-redirect forward even if personality is ready.
        const viewModel = child.personality?.view_model;
        const personalityReady = !!(viewModel?.type && viewModel?.profile);
        setHasPersonality(personalityReady);
        const normalized = normalizeOnboardingChildDataBlob(child);
        if (normalized) {
          childDataRef.current = mergeChildDraft(normalized);
        }
      } catch (err) {
        console.warn('[ConversationalOnboarding] Hydration failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ?? personality?.pending_view_model) as
        | Record<string, unknown>
        | undefined;
      const merged = childDataRef.current;

      if (pendingVm && merged) {
        const adapted = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
        await api.entities.Child.update(childId, {
          personality: { source: 'llm', view_model: stripViewModelImages(adapted) },
          onboarding_phase: 3,
          onboarding_completed: true,
        });
      } else {
        // No pending vm — still mark journey complete
        await api.entities.Child.update(childId, {
          onboarding_phase: 3,
          onboarding_completed: true,
        });
      }
    } catch (err) {
      console.warn('[ConversationalOnboarding] Failed to finalize personality:', err);
      setJobFailed(true);
      return;
    }
    void navigate(`/PersonalityJourney/${childId}`);
  }, [childId, navigate]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_personality_analysis',
    onCompleted: finalizePersonality,
  });

  const { enqueue: enqueueJob, retry: retryJob } = job;

  // On job failure show the inline error screen instead of navigating away.
  useEffect(() => {
    if (job.isFailed && processingRef.current) {
      setJobFailed(true);
    }
  }, [job.isFailed]);

  const handleRetry = useCallback(async () => {
    if (!jobPayloadRef.current) return;
    setJobFailed(false);
    processingRef.current = true;
    try {
      await retryJob(jobPayloadRef.current);
    } catch (err) {
      console.warn('[ConversationalOnboarding] Retry failed:', err);
      setJobFailed(true);
    }
  }, [retryJob]);

  const handleComplete = useCallback(
    async (conversationData: Record<string, unknown>) => {
      const mergedDraft = mergeChildDraft({ ...(childDataRef.current ?? {}), ...conversationData });
      childDataRef.current = mergedDraft;

      try {
        if (childId) {
          await api.entities.Child.update(childId, {
            ...mergedDraft,
            onboarding_phase: 2,
            onboarding_completed: false,
            ...(!hasPersonality && { personality: null }),
          });
        }
      } catch (err) {
        console.warn('[ConversationalOnboarding] Could not save chatbot data:', err);
      }

      // If personality already exists, no analysis job needed — go straight through.
      if (hasPersonality) {
        void navigate(`/PersonalityJourney/${childId}`);
        return;
      }

      // Kick off personality analysis job; navigation happens via useJob onCompleted.
      try {
        const freshChild = await api.entities.Child.get(childId!);
        setChildData(freshChild);

        const activeJobId = (freshChild as Record<string, Record<string, string>>)?.active_jobs
          ?.generate_personality_analysis;

        const payload: EnqueueJobPayload = {
          type: 'generate_personality_analysis',
          child_id: childId!,
          payload: {
            prompt: buildPersonalityAnalysisPrompt({
              childData: mergedDraft,
              personalityTypeKeys: PERSONALITY_TYPE_KEYS,
            }),
            response_json_schema: personalityLlmSchema(),
          },
          write_back: { collection: 'children', filter: {}, field: 'pending_personality_vm' },
        };
        jobPayloadRef.current = payload;
        processingRef.current = true;

        if (!activeJobId) {
          await enqueueJob(payload);
        }
        // else: useJob picks up activeJobId via setChildData and polls automatically.
      } catch (err) {
        console.warn('[ConversationalOnboarding] Could not start personality job:', err);
        processingRef.current = false;
        setJobFailed(true);
      }
    },
    [childId, hasPersonality, navigate, enqueueJob],
  );

  return (
    <>
      {/* Page content — hidden while splash is showing, then fades in smoothly */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || !hydrated ? (
          <PageLoader />
        ) : (
          <div className="relative flex h-[calc(100vh-7rem)] flex-col bg-[var(--bg-deep-3)]">
            {/* Chat fills remaining height */}
            <div className="flex min-h-0 flex-1 flex-col">
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated}
                onComplete={handleComplete}
                onContinueToPersonality={() => {
                  void handleComplete({});
                }}
              />
            </div>

            {/* Error overlay — fades in over the loading screen when the analysis job fails */}
            <AnimatePresence>
              {jobFailed && (
                <motion.div
                  key="job-error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 pb-20"
                  style={{ background: 'var(--bg-deep-3)' }}
                >
                  <p className="w-full max-w-2xl text-center text-3xl font-bold leading-[1.08] text-white/90 sm:text-4xl">
                    Something went wrong
                  </p>
                  <p className="text-center text-base text-white/60">
                    We couldn&apos;t create your child&apos;s profile. Please try again.
                  </p>
                  <Button onClick={() => void handleRetry()} size="lg" className="mt-4">
                    Try again
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </>
  );
}
