import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { sanitizeViewModelAvatars, stripViewModelImages } from '@/lib/avatarUtils';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import { useJob } from '@/hooks/useJob';
import OnboardingProgressHeader from '@/components/onboarding/OnboardingProgressHeader';
import type { PhaseEntry } from '@/components/onboarding/OnboardingProgressHeader';

// ── Analysis checklist steps ────────────────────────────────────────────────

const ANALYSIS_STEPS = [
  { label: 'Processing questionnaire' },
  { label: 'Matching personality patterns' },
  { label: "Building your child's profile" },
  { label: 'Preparing your results' },
];

const HEADER_PHASES: PhaseEntry[] = [
  { num: 1, label: 'Getting to Know', status: 'done' },
  { num: 2, label: 'Personality Analysis', status: 'active', progress: 50 },
  { num: 3, label: 'Your Journey', status: 'upcoming' },
];

// ── Animated checklist loading screen ────────────────────────────────────────

function AnalysisLoadingScreen({
  childName,
  completedSteps,
}: {
  childName: string;
  completedSteps: number;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4">
      <OnboardingProgressHeader phases={HEADER_PHASES} />

      <div className="w-full max-w-sm space-y-6 text-center">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 70, damping: 12 }}
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 shadow-[0_0_28px_rgba(45,212,191,0.2)] ring-4 ring-primary/20"
        >
          <motion.div
            animate={{ rotate: completedSteps >= ANALYSIS_STEPS.length ? 0 : 360 }}
            transition={
              completedSteps >= ANALYSIS_STEPS.length
                ? { duration: 0.3 }
                : { duration: 2.4, repeat: Infinity, ease: 'linear' }
            }
          >
            {completedSteps >= ANALYSIS_STEPS.length ? (
              <Check className="h-10 w-10 text-primary" />
            ) : (
              <svg viewBox="0 0 40 42" className="h-10 w-10" fill="none">
                <line
                  x1="20"
                  y1="34"
                  x2="20"
                  y2="22"
                  stroke="hsl(174 72% 56%)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M20 28 C20 22 13 18 13 13 C13 8.5 16.2 6 20 6 C23.8 6 27 8.5 27 13 C27 18 20 22 20 28"
                  stroke="hsl(174 72% 56%)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            )}
          </motion.div>
        </motion.div>

        <div className="space-y-1.5">
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-xl font-bold text-foreground"
          >
            Analysing <span className="text-primary">{childName || 'your child'}</span>
            's personality
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-muted-foreground"
          >
            This takes a moment — hang tight!
          </motion.p>
        </div>

        {/* Checklist */}
        <div className="space-y-3">
          {ANALYSIS_STEPS.map((step, idx) => {
            const isDone = idx < completedSteps;
            const isActive = idx === completedSteps;
            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + idx * 0.18, duration: 0.4, ease: 'easeOut' }}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  isDone
                    ? 'border-primary/30 bg-primary/[0.07]'
                    : isActive
                      ? 'border-white/[0.12] bg-surface-elevated'
                      : 'border-white/[0.06] bg-transparent opacity-40'
                }`}
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all ${
                    isDone
                      ? 'border-primary bg-primary'
                      : isActive
                        ? 'border-primary/60 bg-transparent'
                        : 'border-white/[0.15] bg-transparent'
                  }`}
                >
                  {isDone ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200 }}
                    >
                      <Check className="h-3.5 w-3.5 text-primary-foreground" />
                    </motion.div>
                  ) : isActive ? (
                    <motion.div
                      animate={{ scale: [0.8, 1.2, 0.8] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                      className="h-2 w-2 rounded-full bg-primary"
                    />
                  ) : null}
                </div>
                <span
                  className={`text-sm font-medium ${
                    isDone
                      ? 'text-primary'
                      : isActive
                        ? 'text-foreground'
                        : 'text-muted-foreground/40'
                  }`}
                >
                  {step.label}
                </span>
                {isActive && (
                  <motion.span
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="ml-auto text-xs text-primary"
                  >
                    …
                  </motion.span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PersonalityType() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [mbtiResult, setMbtiResult] = useState<Record<string, unknown> | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [navigatingAway, setNavigatingAway] = useState(false);
  const mergedDataRef = useRef<Record<string, unknown> | null>(null);

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ?? personality?.pending_view_model) as
        | Record<string, unknown>
        | undefined;
      const merged = mergedDataRef.current;

      if (pendingVm && merged) {
        const vm = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
        setMbtiResult(sanitizeViewModelAvatars(vm));
        api.entities.Child.update(childId, {
          personality: { source: 'llm', view_model: stripViewModelImages(vm) },
          onboarding_phase: 2,
        }).catch((err) => console.error('[PersonalityType] Failed to persist personality:', err));
      } else if (personality?.view_model?.profile?.name) {
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

  // Advance checklist as job progresses
  useEffect(() => {
    if (!job.isLoading || mbtiResult) return;
    const progress = Math.min((job.elapsedMs / 1000 / 30) * 100, 95);
    const steps = progress < 25 ? 0 : progress < 50 ? 1 : progress < 75 ? 2 : progress < 95 ? 3 : 4;
    setCompletedSteps(steps);
  }, [job.isLoading, job.elapsedMs, mbtiResult]);

  // Animate all steps done → navigate to journey
  useEffect(() => {
    if (!mbtiResult || navigatingAway) return;
    setCompletedSteps(ANALYSIS_STEPS.length);
    const t = setTimeout(() => {
      setNavigatingAway(true);
      void navigate(`/PersonalityJourney/${childId ?? ''}`);
    }, 1600);
    return () => clearTimeout(t);
  }, [mbtiResult, childId, navigate, navigatingAway]);

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

        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        mergedDataRef.current = merged;
        setChildName(merged.name || '');
        setChildData(child);

        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (viewModel?.profile?.name) {
          const clamped = maybeClampStoredPersonalityDescription(viewModel, {
            analysisSource: personality?.source,
          });
          setMbtiResult(sanitizeViewModelAvatars(clamped));
          setIsInitializing(false);
          return;
        }

        const pendingVm = (child.pending_personality_vm ?? personality?.pending_view_model) as
          | Record<string, unknown>
          | undefined;
        if (pendingVm) {
          const vm = adaptAiPersonalityToViewModel(pendingVm, merged.name);
          if (cancelled) return;
          setMbtiResult(sanitizeViewModelAvatars(vm));
          setIsInitializing(false);
          api.entities.Child.update(childId, {
            personality: { source: 'llm', view_model: stripViewModelImages(vm) },
            onboarding_phase: 2,
          }).catch(console.error);
          return;
        }

        if (!merged.name?.trim()) {
          void navigate(`/ConversationalOnboarding/${childId}`, { replace: true });
          return;
        }

        const activeJobId = child.active_jobs?.generate_personality_analysis;
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
        setCompletedSteps(1);
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityType] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const isError = initError || job.isFailed;

  if (isLoadingAuth || isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="text-muted-foreground">Something went wrong. Please try again.</p>
        <Button
          onClick={() => {
            void navigate(childId ? `/ConversationalOnboarding/${childId}` : '/Home');
          }}
          className="btn-primary rounded-2xl px-8"
        >
          Go Back
        </Button>
      </div>
    );
  }

  // Analysing — show animated checklist
  if (!mbtiResult || navigatingAway) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="analysing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <AnalysisLoadingScreen childName={childName} completedSteps={completedSteps} />
        </motion.div>
      </AnimatePresence>
    );
  }

  // mbtiResult ready → will navigate away via useEffect above; show completion briefly
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="complete"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
      >
        <AnalysisLoadingScreen childName={childName} completedSteps={ANALYSIS_STEPS.length} />
      </motion.div>
    </AnimatePresence>
  );
}
