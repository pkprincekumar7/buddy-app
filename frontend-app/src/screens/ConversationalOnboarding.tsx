import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { useNavigate, useParams } from '@/lib/router';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import PageLoader from '@/components/shared/PageLoader';
import PageBackRow from '@/components/layout/PageBackRow';
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
import { raw } from '@/theme';
import type { EnqueueJobPayload } from '@/types/api';

// web: initial={{ opacity: 0 }} animate={{ opacity: 1 }}, 0.8s easeOut.
const PAGE_FADE = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1, easing: Easing.out(Easing.ease) },
}).duration(800);

const ERROR_FADE_IN = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1 },
}).duration(300);
const ERROR_FADE_OUT = new Keyframe({
  0: { opacity: 1 },
  100: { opacity: 0 },
}).duration(300);

const DEEP_BG = { backgroundColor: raw['bg-deep-3'] };

export default function ConversationalOnboarding() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const childDataRef = useRef<Record<string, unknown> | null>(null);
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Holds the freshly-fetched child record so useJob can pick up active_jobs.
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
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
      const pendingVm = (child?.pending_personality_vm ??
        personality?.pending_view_model) as Record<string, unknown> | undefined;
      const merged = childDataRef.current;

      if (pendingVm && merged) {
        const adapted = adaptAiPersonalityToViewModel(
          pendingVm,
          merged.name as string,
        );
        await api.entities.Child.update(childId, {
          personality: {
            source: 'llm',
            view_model: stripViewModelImages(adapted),
          },
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
      console.warn(
        '[ConversationalOnboarding] Failed to finalize personality:',
        err,
      );
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
      const mergedDraft = mergeChildDraft({
        ...(childDataRef.current ?? {}),
        ...conversationData,
      });
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
        console.warn(
          '[ConversationalOnboarding] Could not save chatbot data:',
          err,
        );
      }

      // If personality already exists, no analysis job needed — go straight through.
      if (hasPersonality) {
        void navigate(`/PersonalityJourney/${childId}`);
        return;
      }

      // Kick off personality analysis job; navigation happens via useJob onCompleted.
      try {
        // web: `childId!` — a missing id fails the same way (into the catch below).
        if (!childId) throw new Error('Missing childId');
        const freshChild = await api.entities.Child.get(childId);
        setChildData(freshChild);

        const activeJobId = (
          freshChild as Record<string, Record<string, string>>
        )?.active_jobs?.generate_personality_analysis;

        const payload: EnqueueJobPayload = {
          type: 'generate_personality_analysis',
          child_id: childId,
          payload: {
            prompt: buildPersonalityAnalysisPrompt({
              childData: mergedDraft,
              personalityTypeKeys: PERSONALITY_TYPE_KEYS,
            }),
            response_json_schema: personalityLlmSchema(),
          },
          write_back: {
            collection: 'children',
            filter: {},
            field: 'pending_personality_vm',
          },
        };
        jobPayloadRef.current = payload;
        processingRef.current = true;

        if (!activeJobId) {
          await enqueueJob(payload);
        }
        // else: useJob picks up activeJobId via setChildData and polls automatically.
      } catch (err) {
        console.warn(
          '[ConversationalOnboarding] Could not start personality job:',
          err,
        );
        processingRef.current = false;
        setJobFailed(true);
      }
    },
    [childId, hasPersonality, navigate, enqueueJob],
  );

  return (
    <View className="flex-1 bg-background">
      <PageBackRow />
      {/* Page content — fades in smoothly */}
      <Animated.View entering={PAGE_FADE} className="flex-1">
        {isLoadingAuth || !hydrated ? (
          <PageLoader />
        ) : (
          <View className="relative flex-1" style={DEEP_BG}>
            {/* Chat fills remaining height */}
            <View className="min-h-0 flex-1">
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
            </View>

            {/* Error overlay — fades in over the loading screen when the analysis job fails */}
            {jobFailed && (
              <Animated.View
                key="job-error"
                entering={ERROR_FADE_IN}
                exiting={ERROR_FADE_OUT}
                className="absolute inset-0 items-center justify-center gap-4 px-6 pb-20"
                style={DEEP_BG}
              >
                <Text
                  accessibilityRole="header"
                  className="w-full max-w-2xl text-center text-3xl font-bold text-white/90"
                  style={{ lineHeight: 30 * 1.08 }}
                >
                  Something went wrong
                </Text>
                <Text className="text-center text-base text-white/60">
                  We couldn&apos;t create your child&apos;s profile. Please try
                  again.
                </Text>
                <Button
                  onPress={() => void handleRetry()}
                  size="lg"
                  className="mt-4"
                  accessibilityLabel="Try again"
                >
                  Try again
                </Button>
              </Animated.View>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}
