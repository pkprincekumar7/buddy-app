import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Star,
  Clock,
  Brain,
  Pencil,
  Info,
  Eye,
  Smile,
  Users,
  Heart,
  MessageCircle,
  Compass,
  Wand2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { personalityTypes } from '@/components/shared/PersonalityAnalysis';
import { generateAvatarDataUri } from '@/lib/avatarUtils';
import { SPINNER } from '@/lib/animations';
import OnboardingProgressHeader from '@/components/onboarding/OnboardingProgressHeader';
import type { PhaseEntry } from '@/components/onboarding/OnboardingProgressHeader';

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

// ── Step definitions ──────────────────────────────────────────────────────────
// 1 – THE REVEAL splash
// 2 – Personality card (type + traits)
// 3 – In a nutshell (description)
// 4 – Strengths intro (auto-advance)
// 5 – Emerging Strengths set 1 (strengths 0–2)
// 6 – Emerging Strengths set 2 (strengths 3–5)
// 7 – What's next
// 8 – CTA (Continue Now / Catch Up Later)
const TOTAL_STEPS = 8;

// ── Strength badge styles ─────────────────────────────────────────────────────
const STRENGTH_BADGE_STYLES = [
  { numBg: 'badge-1-bg', numText: 'badge-1-text', numBorder: 'badge-1-border', Icon: Info },
  { numBg: 'badge-2-bg', numText: 'badge-2-text', numBorder: 'badge-2-border', Icon: Eye },
  { numBg: 'badge-3-bg', numText: 'badge-3-text', numBorder: 'badge-3-border', Icon: Smile },
  { numBg: 'badge-4-bg', numText: 'badge-4-text', numBorder: 'badge-4-border', Icon: Users },
  { numBg: 'badge-5-bg', numText: 'badge-5-text', numBorder: 'badge-5-border', Icon: Heart },
  { numBg: 'badge-6-bg', numText: 'badge-6-text', numBorder: 'badge-6-border', Icon: Sparkles },
] as const;

// ── Sub-screens ───────────────────────────────────────────────────────────────

function TheRevealScreen({ childName, onNext }: { childName: string; onNext: () => void }) {
  const dots = [
    { top: '8%', left: '10%', color: 'bg-primary', size: 'h-2 w-2', delay: 0.2 },
    { top: '15%', left: '80%', color: 'bg-personality-alt', size: 'h-2.5 w-2.5', delay: 0.4 },
    { top: '40%', left: '5%', color: 'bg-warning', size: 'h-1.5 w-1.5', delay: 0.3 },
    { top: '60%', left: '90%', color: 'bg-primary', size: 'h-2 w-2', delay: 0.5 },
    { top: '75%', left: '15%', color: 'bg-accent-pink', size: 'h-1.5 w-1.5', delay: 0.35 },
    { top: '80%', left: '75%', color: 'bg-personality-alt', size: 'h-2 w-2', delay: 0.25 },
    { top: '25%', left: '92%', color: 'bg-warning', size: 'h-1.5 w-1.5', delay: 0.45 },
    { top: '55%', left: '3%', color: 'bg-primary', size: 'h-1.5 w-1.5', delay: 0.6 },
  ];

  return (
    <div className="relative flex min-h-[60vh] flex-col items-center justify-center gap-8 text-center">
      {dots.map((dot, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: dot.delay, duration: 0.4 }}
          className={`absolute rounded-full ${dot.color} ${dot.size}`}
          style={{ top: dot.top, left: dot.left }}
        />
      ))}

      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 60, damping: 10, delay: 0.2 }}
        className="flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/30 to-personality/30 glow-teal-lg ring-4 ring-primary/20"
      >
        <Sparkles className="h-14 w-14 text-primary" />
      </motion.div>

      <motion.p
        initial={{ opacity: 0, letterSpacing: '0.5em' }}
        animate={{ opacity: 1, letterSpacing: '0.25em' }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary"
      >
        THE REVEAL
      </motion.p>

      <div className="space-y-3">
        <motion.h1
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl"
        >
          Your Personalized Journey
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.5 }}
          className="text-sm text-muted-foreground"
        >
          Here's what we've discovered about{' '}
          <span className="font-semibold text-foreground">{childName}</span> ✨
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0, duration: 0.5 }}
      >
        <Button
          onClick={onNext}
          className="h-12 gap-2 rounded-full bg-primary px-8 font-semibold text-primary-foreground glow-teal-btn transition-all hover:bg-primary/90"
        >
          Show me →
        </Button>
      </motion.div>
    </div>
  );
}

function PersonalityCardScreen({
  childName,
  personalityType,
  traits,
  famousPeople,
  typeColor,
  onNext,
}: {
  childName: string;
  personalityType: string;
  traits: string[];
  famousPeople: Array<{ name: string; image?: string }>;
  typeColor: string;
  onNext: () => void;
}) {
  const typeTitle = personalityType?.split(' - ')[1] ?? personalityType ?? 'Unique';

  function traitIcon(trait: string) {
    const t = trait.toLowerCase();
    if (/calm|steady|quiet|peace/.test(t)) return <Heart className="h-3 w-3" />;
    if (/friend|social|connect|warm|kind/.test(t)) return <Users className="h-3 w-3" />;
    if (/visual|see|look|observ/.test(t)) return <Eye className="h-3 w-3" />;
    if (/talk|voice|speak|express|verbal/.test(t)) return <MessageCircle className="h-3 w-3" />;
    return <Sparkles className="h-3 w-3" />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="space-y-5 rounded-2xl border-edge bg-card p-5"
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${typeColor}`}
        >
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
            {childName}'s Profile · 1 of 3
          </p>
          <h2 className="text-base font-bold text-foreground">Personality Type</h2>
        </div>
      </div>

      {/* Inner personality card */}
      <div className="space-y-4 rounded-xl border-edge-faint bg-deep-navy-gradient p-5 text-center">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50">
            {childName.toUpperCase()} IS A
          </p>
          <h3 className="text-5xl font-extrabold leading-tight text-primary">{typeTitle}</h3>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {traits.map((trait, idx) => (
            <motion.span
              key={trait}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + idx * 0.07 }}
              className="border-edge-md flex items-center gap-1.5 rounded-lg bg-ghost-md px-3 py-1.5 text-xs font-medium text-foreground/80"
            >
              <span className="text-muted-foreground/60">{traitIcon(trait)}</span>
              {trait}
            </motion.span>
          ))}
        </div>
      </div>

      {/* Famous people */}
      {famousPeople.length > 0 && (
        <div className="border-edge-faint rounded-xl bg-ghost p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
            Famous people with similar traits
          </p>
          <div className="flex justify-center gap-8">
            {famousPeople.map((person, i) => (
              <motion.div
                key={person.name}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
                className="flex flex-col items-center gap-2"
              >
                <div className="h-14 w-14 overflow-hidden rounded-full border-2 border-white/15">
                  <img
                    src={`/app-assets/famous_people/${person.name.replace(/ /g, '_')}.png`}
                    alt={person.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = generateAvatarDataUri(person.name);
                    }}
                  />
                </div>
                <span className="max-w-[72px] text-center text-[11px] font-medium leading-tight text-muted-foreground">
                  {person.name}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <Button
        onClick={onNext}
        className="h-12 rounded-full bg-primary px-8 font-semibold text-primary-foreground glow-teal-btn transition-all hover:bg-primary/90"
      >
        See the summary →
      </Button>
    </motion.div>
  );
}

function InANutshellScreen({
  childName,
  description,
  traits,
  onNext,
}: {
  childName: string;
  description: string;
  traits: string[];
  onNext: () => void;
}) {
  const HIGHLIGHT_COLORS = ['text-primary', 'text-personality-alt', 'text-warning'];

  function highlightTraits(text: string) {
    if (!traits.length) return <>{text}</>;
    const sorted = [...traits].sort((a, b) => b.length - a.length);
    const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(pattern);
    let colorIdx = 0;
    return parts.map((part, i) => {
      if (sorted.some((t) => t.toLowerCase() === part.toLowerCase())) {
        const color =
          HIGHLIGHT_COLORS[colorIdx++ % HIGHLIGHT_COLORS.length] ?? HIGHLIGHT_COLORS[0]!;
        return (
          <span key={i} className={`font-semibold ${color}`}>
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="space-y-5 rounded-2xl border-edge bg-card p-5"
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
          <Pencil className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
            {childName}'s Profile · 2 of 3
          </p>
          <h2 className="text-base font-bold text-foreground">In a nutshell</h2>
        </div>
      </div>

      <p className="text-xl font-bold leading-relaxed text-foreground">
        "{highlightTraits(description)}"
      </p>

      <div className="flex items-center gap-2 text-muted-foreground/50">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <p className="text-xs">One sentence — read it slowly. We'll get into the details next.</p>
      </div>

      <Button
        onClick={onNext}
        className="h-12 rounded-full bg-primary px-8 font-semibold text-primary-foreground glow-teal-btn transition-all hover:bg-primary/90"
      >
        Show emerging strengths →
      </Button>
    </motion.div>
  );
}

function StrengthsIntroScreen({
  childName,
  onComplete,
}: {
  childName: string;
  onComplete: () => void;
}) {
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    const t = setTimeout(() => onCompleteRef.current(), 2800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative flex min-h-[55vh] flex-col items-center justify-center gap-6 text-center">
      <p className="absolute right-0 top-0 text-[11px] text-muted-foreground/40">
        Friendly pause...
      </p>

      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 60, damping: 10 }}
        className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/15 glow-teal-lg ring-4 ring-primary/20"
      >
        <Star className="h-10 w-10 text-primary" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="space-y-2"
      >
        <h2 className="text-2xl font-bold text-foreground">
          Here come {childName}'s emerging strengths ⭐
        </h2>
        <p className="text-sm text-muted-foreground">
          We've split them across two screens so each one lands.
        </p>
      </motion.div>

      <motion.p
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary"
      >
        One moment...
      </motion.p>
    </div>
  );
}

function StrengthsScreen({
  childName,
  strengths,
  globalStartIdx,
  totalStrengths,
  isLastSet,
  onNext,
}: {
  childName: string;
  strengths: string[];
  globalStartIdx: number;
  totalStrengths: number;
  isLastSet: boolean;
  onNext: () => void;
}) {
  const remaining = totalStrengths - (globalStartIdx + strengths.length);
  const setNum = globalStartIdx === 0 ? 1 : 2;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-5 rounded-2xl border-edge bg-card p-5"
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-medium/15 ring-1 ring-warning-medium/20">
          <Star className="h-5 w-5 text-warning" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
            {childName}'s Profile · 3 of 3 · Set {setNum} of 2
          </p>
          <h2 className="text-base font-bold text-foreground">Emerging Strengths</h2>
        </div>
      </div>

      {/* Strength items */}
      <div className="space-y-3">
        {strengths.map((strength, idx) => {
          const sep = strength.match(/[:—–-](.+)/);
          const title = sep ? strength.slice(0, strength.indexOf(sep[0])).trim() : strength;
          const detail = sep ? (sep[1]?.trim() ?? '') : '';
          const globalIdx = globalStartIdx + idx;
          const style = STRENGTH_BADGE_STYLES[globalIdx % STRENGTH_BADGE_STYLES.length]!;
          const { Icon } = style;
          const num = String(globalIdx + 1).padStart(2, '0');

          return (
            <motion.div
              key={strength}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + idx * 0.12, duration: 0.4, ease: 'easeOut' }}
              className="flex items-start gap-4 rounded-xl border-edge-faint bg-surface-elevated px-4 py-3.5"
            >
              <div
                className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border ${style.numBorder} ${style.numBg}`}
              >
                <span className={`text-[10px] font-bold leading-none ${style.numText}`}>{num}</span>
                <Icon className={`h-3 w-3 ${style.numText}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {detail && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-muted-foreground/50">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <p className="text-xs">
            {isLastSet
              ? `That's all ${totalStrengths} strengths!`
              : `${remaining} more strength${remaining !== 1 ? 's' : ''} to discover.`}
          </p>
        </div>
        <Button
          onClick={onNext}
          className="h-10 shrink-0 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground glow-teal-sm hover:bg-primary/90"
        >
          {isLastSet ? 'See next steps →' : `Next ${remaining} strengths →`}
        </Button>
      </div>
    </motion.div>
  );
}

function WhatsNextScreen({ childName, onComplete }: { childName: string; onComplete: () => void }) {
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    const t = setTimeout(() => onCompleteRef.current(), 2800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative flex min-h-[55vh] flex-col items-center justify-center gap-6 text-center">
      <p className="absolute right-0 top-0 text-[11px] text-muted-foreground/40">
        Friendly pause...
      </p>

      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 60, damping: 10 }}
        className="flex h-24 w-24 items-center justify-center rounded-full bg-personality/15 glow-personality-lg ring-4 ring-personality-alt/20"
      >
        <Compass className="h-10 w-10 text-personality-alt" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="space-y-2"
      >
        <h2 className="text-2xl font-bold text-foreground">
          Ready to grow further with {childName}?
        </h2>
        <p className="text-2xl">🌟</p>
        <p className="text-sm text-muted-foreground">
          Next, we'll show personalized growth areas and activities.
        </p>
      </motion.div>

      <motion.p
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary"
      >
        One moment...
      </motion.p>
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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 rounded-2xl border-edge bg-card p-6 text-center"
    >
      {/* Icon */}
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-personality/15 glow-personality ring-4 ring-personality-alt/20">
        <Wand2 className="h-8 w-8 text-personality-alt" />
      </div>

      {/* Label */}
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
        One Last Step
      </p>

      {/* Heading */}
      <h2 className="text-2xl font-extrabold leading-snug text-foreground">
        Want to explore the specific growth areas for{' '}
        <span className="text-primary">{childName}</span> to become their best version?
      </h2>

      {/* Subtitle */}
      <p className="text-sm text-muted-foreground">
        Discover personalized activities to help {childName} develop key life skills.
      </p>

      {/* Primary CTAs */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          onClick={() => {
            void navigate(`/GrowthAreas/${childId ?? ''}`);
          }}
          className="h-11 flex-1 rounded-full bg-personality font-semibold text-white glow-personality hover:bg-personality/90"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Continue Now
        </Button>
        <Button
          variant="outline"
          onClick={onHome}
          className="h-11 flex-1 rounded-full border-c-md bg-transparent text-foreground hover:bg-surface-elevated"
        >
          <Clock className="mr-1.5 h-4 w-4" />
          Catch Up Later
        </Button>
      </div>

      {/* Restart */}
      <div className="space-y-3 pt-1">
        <div className="h-px bg-ghost-strong" />
        <p className="text-xs text-muted-foreground/50">Want to see the flow again?</p>
        <Button
          variant="outline"
          onClick={() => {
            void navigate(`/Onboarding/${childId ?? ''}`);
          }}
          className="h-10 w-full rounded-full border-c-md bg-transparent text-sm text-foreground hover:bg-surface-elevated"
        >
          Restart the journey
        </Button>
      </div>
    </motion.div>
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
  const [direction, setDirection] = useState(1);

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

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, []);

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
  const famousPeople = personalityTypes[personalityType]?.famous_people ?? [];
  const typeColor = personalityTypes[personalityType]?.color ?? 'from-primary to-primary/70';

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
        {/* Step counter */}
        <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
          Your Journey · Step {currentStep} / {TOTAL_STEPS}
        </p>

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
            {currentStep === 1 && <TheRevealScreen childName={childName} onNext={goNext} />}
            {currentStep === 2 && (
              <PersonalityCardScreen
                childName={childName}
                personalityType={personalityType}
                traits={traits}
                famousPeople={famousPeople}
                typeColor={typeColor}
                onNext={goNext}
              />
            )}
            {currentStep === 3 && (
              <InANutshellScreen
                childName={childName}
                description={description}
                traits={traits}
                onNext={goNext}
              />
            )}
            {currentStep === 4 && (
              <StrengthsIntroScreen childName={childName} onComplete={goNext} />
            )}
            {currentStep === 5 && (
              <StrengthsScreen
                childName={childName}
                strengths={strengths.slice(0, 3)}
                globalStartIdx={0}
                totalStrengths={strengths.length}
                isLastSet={strengths.length <= 3}
                onNext={goNext}
              />
            )}
            {currentStep === 6 && (
              <StrengthsScreen
                childName={childName}
                strengths={strengths.length > 3 ? strengths.slice(3) : strengths.slice(0, 3)}
                globalStartIdx={3}
                totalStrengths={strengths.length}
                isLastSet
                onNext={goNext}
              />
            )}
            {currentStep === 7 && <WhatsNextScreen childName={childName} onComplete={goNext} />}
            {currentStep === 8 && (
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
      </div>
    </div>
  );
}
