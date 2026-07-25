import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Brain, Star, Sprout, Compass } from 'lucide-react';
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
  {
    label: 'Reading personality traits',
    Icon: Brain,
    heading: (name: string) => `Reading ${name}'s personality traits...`,
    subtitle: 'Looking at how your child thinks, feels and responds.',
    iconBg: 'bg-primary/15',
    iconColor: 'text-primary',
    glow: 'shadow-[0_0_28px_rgba(45,212,191,0.2)]',
    ring: 'ring-primary/20',
  },
  {
    label: 'Mapping strengths & interests',
    Icon: Star,
    heading: (_name: string) => 'Mapping strengths & interests...',
    subtitle: "Connecting the dots between what they love and what they're great at.",
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    glow: 'shadow-[0_0_28px_rgba(245,158,11,0.2)]',
    ring: 'ring-amber-400/20',
  },
  {
    label: 'Building growth profile',
    Icon: Sprout,
    heading: (_name: string) => 'Building the growth profile...',
    subtitle: 'Shaping a personal plan rooted in their unique strengths.',
    iconBg: 'bg-primary/15',
    iconColor: 'text-primary',
    glow: 'shadow-[0_0_28px_rgba(45,212,191,0.2)]',
    ring: 'ring-primary/20',
  },
  {
    label: 'Finalizing personalized journey',
    Icon: Compass,
    heading: (_name: string) => 'Finalizing the personalized journey...',
    subtitle: 'Almost there — preparing recommendations made just for them.',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-400',
    glow: 'shadow-[0_0_28px_rgba(139,92,246,0.2)]',
    ring: 'ring-violet-400/20',
  },
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
  progressPct,
}: {
  childName: string;
  completedSteps: number;
  progressPct: number;
}) {
  const activeIdx = Math.min(completedSteps, ANALYSIS_STEPS.length - 1);
  const activeStep = ANALYSIS_STEPS[activeIdx] ?? ANALYSIS_STEPS[0]!;
  const stepNum = Math.min(completedSteps + 1, ANALYSIS_STEPS.length);

  return (
    <div className="flex min-h-screen flex-col items-start bg-background px-4">
      <OnboardingProgressHeader phases={HEADER_PHASES} />

      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
          Personality Analysis · Step {stepNum} / {ANALYSIS_STEPS.length}
        </p>

        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/[0.08] bg-card p-6 text-center">
          {/* Step icon */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIdx}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 18 }}
              className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${activeStep.iconBg} ${activeStep.glow} ring-4 ${activeStep.ring}`}
            >
              <activeStep.Icon className={`h-10 w-10 ${activeStep.iconColor}`} />
            </motion.div>
          </AnimatePresence>

          {/* Heading + subtitle */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`text-${activeIdx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="space-y-1.5"
            >
              <h2 className="text-xl font-bold text-foreground">
                {activeStep.heading(childName || 'your child')}
              </h2>
              <p className="text-sm text-muted-foreground">{activeStep.subtitle}</p>
            </motion.div>
          </AnimatePresence>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-violet-400"
                initial={{ width: '0%' }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <p className="text-xs font-semibold tracking-wider text-muted-foreground">
              {progressPct}%
            </p>
          </div>

          {/* Checklist */}
          <div className="space-y-2.5">
            {ANALYSIS_STEPS.map((step, idx) => {
              const isDone = idx < completedSteps;
              const isActive = idx === completedSteps;
              return (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + idx * 0.12, duration: 0.4, ease: 'easeOut' }}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                    isDone
                      ? 'border-primary/30 bg-primary/[0.07]'
                      : isActive
                        ? 'border-primary/40 bg-surface-elevated'
                        : 'border-white/[0.06] bg-transparent opacity-40'
                  }`}
                >
                  <step.Icon
                    className={`h-4 w-4 shrink-0 ${
                      isDone
                        ? 'text-primary'
                        : isActive
                          ? 'text-foreground/70'
                          : 'text-muted-foreground/30'
                    }`}
                  />
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
                    {isActive && (
                      <motion.span
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="ml-1"
                      >
                        ...
                      </motion.span>
                    )}
                  </span>
                  {isDone && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200 }}
                      className="ml-auto"
                    >
                      <Check className="h-3.5 w-3.5 text-primary" />
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
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
  const [progressPct, setProgressPct] = useState(0);
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
    setProgressPct(Math.round(progress));
  }, [job.isLoading, job.elapsedMs, mbtiResult]);

  // When job is done, animate remaining steps one-by-one then navigate
  useEffect(() => {
    if (!mbtiResult || navigatingAway) return;
    if (completedSteps < ANALYSIS_STEPS.length) {
      const next = completedSteps + 1;
      const t = setTimeout(() => {
        setCompletedSteps(next);
        setProgressPct(Math.round((next / ANALYSIS_STEPS.length) * 100));
      }, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setNavigatingAway(true);
      void navigate(`/PersonalityJourney/${childId ?? ''}`);
    }, 1200);
    return () => clearTimeout(t);
  }, [mbtiResult, completedSteps, navigatingAway, childId, navigate]);

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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <AnalysisLoadingScreen
        childName={childName}
        completedSteps={completedSteps}
        progressPct={progressPct}
      />
    </motion.div>
  );
}
