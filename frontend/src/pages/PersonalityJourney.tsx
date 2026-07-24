import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Star, Zap, Clock, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { SPINNER } from '@/lib/animations';
import OnboardingProgressHeader from '@/components/onboarding/OnboardingProgressHeader';
import type { PhaseEntry } from '@/components/onboarding/OnboardingProgressHeader';

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

// ── Step definitions ──────────────────────────────────────────────────────────

// Steps:
//  1 – THE REVEAL splash
//  2 – Personality card (type + traits)
//  3 – In a nutshell (description)
//  4 – Emerging Strengths set 1 (strengths 0-2)
//  5 – Emerging Strengths set 2 (strengths 3-5)
//  6 – What's next intro
//  7 – CTA (Continue Now / Catch Up Later)
const TOTAL_STEPS = 7;

// ── Sub-screens ───────────────────────────────────────────────────────────────

function TheRevealScreen({
  childName,
  personalityType,
}: {
  childName: string;
  personalityType: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 text-center">
      <motion.p
        initial={{ opacity: 0, letterSpacing: '0.5em' }}
        animate={{ opacity: 1, letterSpacing: '0.25em' }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary"
      >
        ✨ The Reveal
      </motion.p>

      <div className="relative flex flex-col items-center gap-4">
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 60, damping: 10, delay: 0.2 }}
          className="flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/30 to-violet-500/30 text-6xl shadow-[0_0_48px_rgba(45,212,191,0.3)] ring-4 ring-primary/20"
        >
          🌟
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs"
        >
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </motion.div>
      </div>

      <div className="space-y-3">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-sm text-muted-foreground"
        >
          {childName} is…
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.85, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl"
        >
          THE{' '}
          <span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">
            {(personalityType?.split(' - ')[1] ?? personalityType ?? 'Unique One').toUpperCase()}
          </span>
        </motion.h1>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.3, duration: 0.5 }}
        className="max-w-xs text-sm italic text-muted-foreground/70"
      >
        Tap "Next" to explore what this means
      </motion.p>
    </div>
  );
}

function PersonalityCardScreen({
  childName,
  personalityType,
  traits,
}: {
  childName: string;
  personalityType: string;
  traits: string[];
}) {
  const typeTitle = personalityType?.split(' - ')[1] ?? personalityType ?? 'Unique';
  const typeLabel = personalityType?.split(' - ')[0] ?? '';

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
          {childName}'s personality type
        </p>
        <h2 className="text-2xl font-extrabold text-foreground">
          {typeLabel && (
            <span className="mr-2 text-lg font-medium text-muted-foreground">{typeLabel} ·</span>
          )}
          {typeTitle}
        </h2>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="space-y-4 rounded-2xl border border-white/[0.08] bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-violet-500/30 text-2xl shadow-[0_0_18px_rgba(45,212,191,0.2)]">
            🌟
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">{typeTitle}</h3>
            <p className="text-xs font-medium text-primary">{childName}'s dominant style</p>
          </div>
        </div>

        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Key traits
          </p>
          <div className="flex flex-wrap gap-2">
            {traits.map((trait, idx) => (
              <motion.span
                key={trait}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.35 + idx * 0.07, duration: 0.3, ease: 'easeOut' }}
                className="rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-xs font-medium text-primary"
              >
                {trait}
              </motion.span>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function InANutshellScreen({ childName, description }: { childName: string; description: string }) {
  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
          In a nutshell
        </p>
        <h2 className="text-xl font-bold text-foreground">What makes {childName} unique</h2>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-violet-500/[0.06] p-6"
      >
        <div className="absolute left-4 top-4 h-6 w-1 rounded-full bg-gradient-to-b from-primary to-violet-400" />
        <p className="pl-4 text-base font-medium leading-relaxed text-foreground">
          "{description}"
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.4 }}
        className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-surface-elevated px-4 py-3"
      >
        <span className="text-lg">💡</span>
        <p className="text-xs text-muted-foreground">
          This description is personalised based on your answers about {childName}.
        </p>
      </motion.div>
    </div>
  );
}

function StrengthsScreen({
  childName,
  strengths,
  setLabel,
}: {
  childName: string;
  strengths: string[];
  setLabel: string;
}) {
  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
          Emerging strengths · {setLabel}
        </p>
        <h2 className="text-xl font-bold text-foreground">{childName}'s natural gifts</h2>
      </motion.div>

      <div className="space-y-3">
        {strengths.map((strength, idx) => {
          // Try to split "Title: description" or "Title — description"
          const sep = strength.match(/[:—–-](.+)/);
          const title = sep ? strength.slice(0, strength.indexOf(sep[0])).trim() : strength;
          const detail = sep ? (sep[1]?.trim() ?? '') : '';

          return (
            <motion.div
              key={strength}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + idx * 0.14, duration: 0.45, ease: 'easeOut' }}
              className="flex items-start gap-4 rounded-xl border border-white/[0.08] bg-card px-5 py-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/20 to-orange-500/10">
                <Star className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {detail && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function WhatsNextScreen({ childName }: { childName: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-6 text-center">
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 60, damping: 10 }}
        className="flex h-24 w-24 items-center justify-center rounded-full bg-violet-500/15 text-5xl shadow-[0_0_36px_rgba(139,92,246,0.25)] ring-4 ring-violet-400/20"
      >
        🧭
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="max-w-xs space-y-2"
      >
        <h2 className="text-2xl font-bold text-foreground">What's next for {childName}?</h2>
        <p className="text-sm text-muted-foreground">
          Discover specific growth areas and personalised activities to help {childName} become
          their best version.
        </p>
      </motion.div>
    </div>
  );
}

function FinalCTAScreen({
  childName,
  childId,
  onHome,
}: {
  childName: string;
  childId: string | undefined;
  onHome: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-4 rounded-2xl border border-personality/20 bg-card p-6 text-center"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-3xl">
          🚀
        </div>
        <h3 className="text-lg font-bold text-foreground">
          Ready to explore {childName}'s growth areas?
        </h3>
        <p className="text-sm text-muted-foreground">
          Personalised activities designed specifically for {childName}'s personality type.
        </p>

        <div className="flex flex-col gap-3 pt-2">
          <Button
            size="xl"
            onClick={() => {
              void navigate(`/GrowthAreas/${childId ?? ''}`);
            }}
            className="w-full rounded-2xl bg-gradient-to-r from-primary to-violet-400 font-semibold text-white shadow-[0_0_20px_rgba(45,212,191,0.2)] transition-opacity hover:opacity-90"
          >
            <Zap className="mr-2 h-4 w-4" />
            Continue Now
          </Button>
          <Button
            size="xl"
            variant="outline"
            onClick={onHome}
            className="w-full rounded-2xl border-white/[0.1] bg-transparent text-foreground transition-colors hover:bg-surface-elevated"
          >
            <Clock className="mr-2 h-4 w-4" />
            Catch Up Later
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PersonalityJourney() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [profile, setProfile] = useState<ProfileType>(null);
  const [viewModel, setViewModel] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = back

  const markJourneyComplete = useCallback(async () => {
    if (!childId) return;
    try {
      await api.entities.Child.update(childId, { onboarding_phase: 3, onboarding_completed: true });
    } catch {
      /* non-fatal */
    }
  }, [childId]);

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

        const personality = child.personality;
        const vm = personality?.view_model;
        if (!vm?.profile?.name) {
          void navigate(`/PersonalityType/${childId}`, { replace: true });
          return;
        }

        setViewModel(vm);
        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        setChildName(merged.name || '');
        setProfile(onboardingProfileFromViewModel(vm));

        if (!child.onboarding_completed) {
          await markJourneyComplete();
        }
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityJourney] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate, markJourneyComplete]);

  const goNext = () => {
    if (currentStep < TOTAL_STEPS) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    }
  };

  const goBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  };

  const status = isLoadingAuth || isInitializing ? 'loading' : initError ? 'error' : 'ready';

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="text-muted-foreground">Something went wrong. Please try again.</p>
        <Button
          onClick={() => {
            void navigate(childId ? `/PersonalityType/${childId}` : '/Home');
          }}
          className="btn-primary rounded-2xl px-8"
        >
          Go Back
        </Button>
      </div>
    );
  }

  const strengths = (profile?.top_strengths as string[]) ?? [];
  const traits = Array.isArray(viewModel?.profile)
    ? []
    : (((viewModel?.profile as Record<string, unknown> | undefined)?.traits as string[]) ?? []);
  const description = profile?.summary ?? '';
  const personalityType = profile?.personality_type ?? '';

  const variants = {
    enter: (d: number) => ({ opacity: 0, x: d * 40, scale: 0.97 }),
    center: { opacity: 1, x: 0, scale: 1 },
    exit: (d: number) => ({ opacity: 0, x: d * -40, scale: 0.97 }),
  };

  const progress = Math.round(((currentStep - 1) / (TOTAL_STEPS - 1)) * 100);
  const headerPhases: PhaseEntry[] = [
    { num: 1, label: 'Getting to Know', status: 'done' },
    { num: 2, label: 'Personality Analysis', status: 'done' },
    { num: 3, label: 'Your Journey', status: 'active', progress },
  ];

  return (
    <div className="min-h-screen bg-background">
      <OnboardingProgressHeader phases={headerPhases} />

      <div className="mx-auto max-w-lg px-4 py-8">
        {/* Step dots */}
        <div className="mb-8 flex justify-center gap-1.5">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i + 1 === currentStep
                  ? 'w-6 bg-primary'
                  : i + 1 < currentStep
                    ? 'w-1.5 bg-primary/40'
                    : 'w-1.5 bg-white/[0.1]',
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            {currentStep === 1 && (
              <TheRevealScreen childName={childName} personalityType={personalityType} />
            )}
            {currentStep === 2 && (
              <PersonalityCardScreen
                childName={childName}
                personalityType={personalityType}
                traits={traits}
              />
            )}
            {currentStep === 3 && (
              <InANutshellScreen childName={childName} description={description} />
            )}
            {currentStep === 4 && (
              <StrengthsScreen
                childName={childName}
                strengths={strengths.slice(0, 3)}
                setLabel="Part 1 of 2"
              />
            )}
            {currentStep === 5 && (
              <StrengthsScreen
                childName={childName}
                strengths={strengths.length > 3 ? strengths.slice(3) : strengths.slice(0, 3)}
                setLabel="Part 2 of 2"
              />
            )}
            {currentStep === 6 && <WhatsNextScreen childName={childName} />}
            {currentStep === 7 && (
              <FinalCTAScreen
                childName={childName}
                childId={childId}
                onHome={() => {
                  void navigate('/Home');
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Nav buttons */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={currentStep === 1}
            className={cn(
              'h-11 rounded-2xl border-white/[0.1] px-6 text-sm font-medium transition-all',
              currentStep === 1 ? 'pointer-events-none opacity-0' : '',
            )}
          >
            ← Back
          </Button>

          {currentStep < TOTAL_STEPS ? (
            <Button
              onClick={goNext}
              className="h-11 gap-2 rounded-2xl bg-primary px-8 font-semibold text-primary-foreground shadow-[0_0_16px_rgba(45,212,191,0.2)] transition-all hover:bg-primary/90"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
