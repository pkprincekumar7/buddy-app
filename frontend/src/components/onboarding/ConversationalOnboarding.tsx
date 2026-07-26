import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import InputWithVoice from '@/components/shared/InputWithVoice';
import OnboardingProgressHeader from '@/components/onboarding/OnboardingProgressHeader';
import type { PhaseEntry } from '@/components/onboarding/OnboardingProgressHeader';
import { Button } from '@/components/ui/button';
import {
  Send,
  Sparkles,
  Eye,
  BarChart2,
  HelpCircle,
  MessageSquare,
  Headphones,
  Hand,
  VolumeX,
  Search,
  Zap,
  Activity,
  Heart,
  Shuffle,
  Shield,
  Mic,
  User,
  Cloud,
  Moon,
  Check,
} from 'lucide-react';
import { api } from '@/api/client';
import {
  CHATBOT_CAPTURED_FIELDS,
  questionnaireFieldHasValue,
  pickSavedQuestionnaireForChatbot,
  normalizeOnboardingChildDataBlob,
} from '@/lib/onboardingChildData';
import { pickPreferredVoice } from '@/lib/tts';
import type { LucideIcon } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConversationStep {
  id: string;
  message: string | ((data: Record<string, unknown>) => string);
  field: string;
  type: 'text' | 'multi_text' | 'choice' | 'auto' | 'final';
  options?: string[];
  placeholder?: string;
  hint?: string;
  phase?: number;
}

interface ChatMessage {
  id: string;
  role: 'bot' | 'user';
  content: string;
}

interface AnalyzingState {
  show: boolean;
  progress: number;
  name: string;
  showingDots: boolean;
  dotCount: number;
}

interface PhaseSplash {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
  displayStep: number;
}

interface ConversationalOnboardingProps {
  user?: { full_name?: string; email?: string } | null;
  activeChildId?: string;
  onComplete: (data: Record<string, unknown>) => void | Promise<void>;
  resumeHydrationReady?: boolean;
  onContinueToPersonality?: () => void;
  onQuestionnairePersisted?: (data: Record<string, unknown>) => void;
  onQuestionnaireCleared?: () => void;
}

// ── Option icon map ───────────────────────────────────────────────────────────

const OPTION_ICONS: Record<string, LucideIcon> = {
  Visual: Eye,
  Analytical: BarChart2,
  Imaginative: Sparkles,
  'Not sure': HelpCircle,
  'Not Sure': HelpCircle,
  Talkative: MessageSquare,
  'Deep Listener': Headphones,
  'Communicates through gestures': Hand,
  Silent: VolumeX,
  Observant: Search,
  'High energy - always active': Zap,
  'Moderate - balanced': Activity,
  'Calm and composed': Heart,
  'Variable - depends on interest': Shuffle,
  Confident: Shield,
  Friendly: Heart,
  Reserved: User,
  Expressive: Mic,
  Withdrawn: User,
  Calm: Moon,
  Sensitive: Heart,
  Impulsive: Zap,
  Moody: Cloud,
};

// ── Phase splash definitions (triggered when crossing these flow indices) ─────

// Splashes shown BEFORE advancing to the given flow index
const PHASE_SPLASHES: Record<number, PhaseSplash> = {
  2: {
    icon: '🧠',
    iconColor: 'bg-violet-500/20 text-violet-300 ring-violet-400/20',
    title: "Now let's understand how {name} thinks",
    subtitle: 'Two quick taps — pick the one that feels closest.',
    displayStep: 3,
  },
  4: {
    icon: '⚡',
    iconColor: 'bg-teal-500/20 text-teal-300 ring-teal-400/20',
    title: 'Almost there — a few more about their nature ⚡',
    subtitle: 'Energy, social, emotional. One tap each. Promise.',
    displayStep: 5,
  },
};

// ── Helper functions ──────────────────────────────────────────────────────────

function buildAccThrough(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  beforeStepIdx: number,
): Record<string, unknown> {
  const acc: Record<string, unknown> = {};
  for (let j = 0; j < beforeStepIdx; j++) {
    const st = flow[j];
    if (!st) break;
    if (st.type === 'auto') break;
    acc[st.field] = data[st.field];
  }
  return acc;
}

function findResumeStepIndex(flow: ConversationStep[], data: Record<string, unknown>): number {
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (!step) break;
    if (step.type === 'auto') return i;
    if (!questionnaireFieldHasValue(step.field, data)) return i;
  }
  const autoIx = flow.findIndex((s) => s.type === 'auto');
  return autoIx >= 0 ? autoIx : flow.length - 1;
}

const ANALYZING_INITIAL: AnalyzingState = {
  show: false,
  progress: 0,
  name: '',
  showingDots: false,
  dotCount: 0,
};

const FIELD_LABELS: Record<string, string> = {
  strengths: 'Strengths',
  hobbies: 'Hobbies',
  thinking_pattern: 'Thinking style',
  communication_style: 'Communication',
  energy_level: 'Energy level',
  social_behaviour: 'Social behaviour',
  emotional_behaviour: 'Emotional nature',
};

function buildResumeSummary(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  upToIdx: number,
): Array<{ label: string; answer: string }> {
  const items: Array<{ label: string; answer: string }> = [];
  for (let i = 0; i < upToIdx; i++) {
    const step = flow[i];
    if (!step || step.type === 'auto') break;
    const val = data[step.field];
    const answer = Array.isArray(val)
      ? val.join(', ')
      : typeof val === 'string'
        ? val
        : typeof val === 'number'
          ? String(val)
          : '';
    if (!answer) continue;
    const label = FIELD_LABELS[step.field] ?? step.field;
    items.push({ label, answer });
  }
  return items;
}

const TOTAL_CHAT_STEPS = 8;

// ── Phase splash full-screen interstitial ─────────────────────────────────────

function PhaseSplashScreen({ splash }: { splash: PhaseSplash }) {
  const progressPct = Math.round((splash.displayStep / TOTAL_CHAT_STEPS) * 100);
  const phases: PhaseEntry[] = [
    { num: 1, label: 'Getting to Know', status: 'active', progress: progressPct },
    { num: 2, label: 'Personality Analysis', status: 'upcoming' },
    { num: 3, label: 'Your Journey', status: 'upcoming' },
  ];

  return (
    <motion.div
      key="phase-splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <OnboardingProgressHeader phases={phases} />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8 text-center">
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50"
        >
          Getting to Know — Step {splash.displayStep} / {TOTAL_CHAT_STEPS}
        </motion.p>

        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 70, damping: 12, delay: 0.15 }}
          className={`flex h-24 w-24 items-center justify-center rounded-full text-5xl ring-4 ${splash.iconColor}`}
        >
          {splash.icon}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="max-w-xs space-y-3"
        >
          <h2 className="text-2xl font-bold text-foreground">{splash.title}</h2>
          <p className="text-sm text-muted-foreground">{splash.subtitle}</p>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="animate-pulse text-[11px] font-bold uppercase tracking-[0.2em] text-primary"
        >
          One moment…
        </motion.p>
      </div>
    </motion.div>
  );
}

// ── Ivy intro splash ─────────────────────────────────────────────────────────

function IvyIntroScreen() {
  return (
    <motion.div
      key="ivy-intro"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 bg-black"
    >
      <img
        src="/app-assets/avatars/ivy-intro.jpg"
        alt="Ivy"
        className="h-full w-full object-cover object-top"
      />
      {/* Dark gradient veil */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(3,4,12,0.1) 0%, rgba(3,4,12,0.3) 55%, rgba(3,4,12,0.88) 100%)',
        }}
      />
      {/* Greeting text */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="absolute bottom-16 left-0 right-0 px-8 text-center text-xl font-bold leading-snug text-white"
        style={{ textShadow: '0 2px 18px rgba(0,0,0,0.6)' }}
      >
        Hi, I am Ivy. Let's transform your child to their superpower personality.
      </motion.p>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConversationalOnboarding({
  user,
  activeChildId,
  onComplete,
  resumeHydrationReady = true,
  onContinueToPersonality,
  onQuestionnairePersisted,
  onQuestionnaireCleared: _onQuestionnaireCleared,
}: ConversationalOnboardingProps) {
  const [showIntro, setShowIntro] = useState(true);
  const showIntroRef = useRef(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>({});
  const [isTyping, setIsTyping] = useState(false);
  const voiceEnabledRef = useRef(true);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [analyzingState, setAnalyzingState] = useState<AnalyzingState>(ANALYZING_INITIAL);
  const [allAnswered, setAllAnswered] = useState(false);
  const [phaseSplash, setPhaseSplash] = useState<PhaseSplash | null>(null);
  const [resumeSummary, setResumeSummary] = useState<Array<{
    label: string;
    answer: string;
  }> | null>(null);
  const summaryInitializedRef = useRef(false);

  const {
    show: showAnalyzing,
    progress: analyzeProgress,
    name: analyzingName,
    showingDots: showingLoadingDots,
    dotCount,
  } = analyzingState;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChildIdRef = useRef(activeChildId);
  const botMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);
  const collectedDataRef = useRef<Record<string, unknown>>({});
  const msgIdCounterRef = useRef(0);
  const newMsgId = useCallback(() => `${Date.now()}-${++msgIdCounterRef.current}`, []);
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable refs for the resume effect — avoids re-triggering it when these change
  const conversationFlowRef = useRef<ConversationStep[]>([]);
  const addBotMessageRef = useRef<((text: string) => void) | null>(null);
  const newMsgIdRef = useRef(newMsgId);

  useEffect(() => {
    collectedDataRef.current = collectedData;
  }, [collectedData]);

  // Ivy intro: show image, speak greeting, dismiss when speech ends.
  useEffect(() => {
    const IVY_MSG = "Hi, I am Ivy. Let's transform your child to their superpower personality.";
    // Fallback: dismiss after 10s if speech never fires onend.
    const fallback = setTimeout(() => {
      showIntroRef.current = false;
      setShowIntro(false);
    }, 10000);

    const speakIntro = () => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        clearTimeout(fallback);
        setTimeout(() => {
          showIntroRef.current = false;
          setShowIntro(false);
        }, 2000);
        return;
      }
      const utter = new SpeechSynthesisUtterance(IVY_MSG);
      const voice = pickPreferredVoice();
      if (voice) utter.voice = voice;
      utter.rate = 0.95;
      utter.onend = () => {
        clearTimeout(fallback);
        showIntroRef.current = false;
        setShowIntro(false);
      };
      window.speechSynthesis.speak(utter);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      speakIntro();
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', speakIntro, { once: true });
    }
    return () => {
      clearTimeout(fallback);
      window.speechSynthesis.cancel();
    };
  }, []);

  // Keep the previously-answered summary in sync as the user progresses.
  useEffect(() => {
    if (!summaryInitializedRef.current) return;
    setResumeSummary(buildResumeSummary(conversationFlowRef.current, collectedData, currentStep));
  }, [collectedData, currentStep]);

  useEffect(() => {
    activeChildIdRef.current = activeChildId ?? undefined;
  }, [activeChildId]);

  const persistQuestionnaireDraft = useCallback(
    (mergedCollected: Record<string, unknown>) => {
      onQuestionnairePersisted?.(mergedCollected);
      if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
      // Keep a ref to the latest data so the unmount-flush can use it
      collectedDataRef.current = mergedCollected;
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void (async () => {
          if (!activeChildIdRef.current) return;
          try {
            await api.entities.Child.update(activeChildIdRef.current, mergedCollected);
          } catch (err) {
            console.warn('[ConversationalOnboarding] Auto-persist failed:', err);
          }
        })();
      }, 500);
    },
    [onQuestionnairePersisted],
  );

  // Flush any unsaved answer when the component unmounts (e.g. user navigates
  // away before the 500 ms debounce fires).
  useEffect(
    () => () => {
      if (persistTimerRef.current === null) return; // nothing pending
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      const childId = activeChildIdRef.current;
      const data = collectedDataRef.current;
      if (childId && Object.keys(data).length > 0) {
        void api.entities.Child.update(childId, data).catch(() => {});
      }
    },
    [],
  );

  const parentName = user?.full_name?.split(' ')[0] ?? 'there';

  const conversationFlow = useMemo<ConversationStep[]>(
    () => [
      {
        id: 'ready_check',
        message: (data) => {
          const name =
            typeof data['name'] === 'string' && data['name'] ? data['name'] : 'your child';
          return `Hey ${parentName}! Let's now explore what makes ${name} unique.\nMention the top 3 strengths that ${name} has from your perspective.`;
        },
        field: 'strengths',
        type: 'multi_text',
        placeholder: 'e.g., Intelligent, Energetic, Well-mannered',
        hint: 'Separate each with a comma',
        phase: 1,
      },
      {
        id: 'strengths_response',
        message: (data) =>
          `Happy to know that! You are a lucky parent! 😊\n\nMention the top 3 hobbies where ${typeof data['name'] === 'string' ? data['name'] : ''} spends their time.`,
        field: 'hobbies',
        type: 'multi_text',
        placeholder: 'e.g., Cricket, Drawing, Reading',
        hint: 'Separate each with a comma',
        phase: 1,
      },
      {
        id: 'thinking_pattern',
        message: (data) =>
          `Choose the kind of thinking pattern that ${typeof data['name'] === 'string' ? data['name'] : ''} predominantly has:`,
        field: 'thinking_pattern',
        type: 'choice',
        options: ['Visual', 'Analytical', 'Imaginative', 'Not sure'],
        phase: 1,
      },
      {
        id: 'communication_style',
        message: (data) =>
          `Choose the kind of communication style that ${typeof data['name'] === 'string' ? data['name'] : ''} predominantly has:`,
        field: 'communication_style',
        type: 'choice',
        options: [
          'Talkative',
          'Deep Listener',
          'Communicates through gestures',
          'Silent',
          'Observant',
          'Not Sure',
        ],
        phase: 1,
      },
      {
        id: 'energy_level',
        message: (data) =>
          `How would you describe ${typeof data['name'] === 'string' ? data['name'] : ''}'s energy level?`,
        field: 'energy_level',
        type: 'choice',
        options: [
          'High energy - always active',
          'Moderate - balanced',
          'Calm and composed',
          'Variable - depends on interest',
        ],
        phase: 1,
      },
      {
        id: 'social_behaviour',
        message: (data) =>
          `How does ${typeof data['name'] === 'string' ? data['name'] : ''} behave in social situations?`,
        field: 'social_behaviour',
        type: 'choice',
        options: ['Confident', 'Friendly', 'Reserved', 'Expressive', 'Withdrawn'],
        phase: 1,
      },
      {
        id: 'emotional_behaviour',
        message: (data) =>
          `What kind of a child is ${typeof data['name'] === 'string' ? data['name'] : ''} emotionally?`,
        field: 'emotional_behaviour',
        type: 'choice',
        options: ['Calm', 'Sensitive', 'Reserved', 'Impulsive', 'Moody'],
        phase: 1,
      },
      {
        id: 'complete',
        message: () => '',
        field: 'start_analysis',
        type: 'auto',
        phase: 1,
      },
    ],
    [parentName],
  );

  // TTS
  const speak = useCallback((text: string) => {
    if (!voiceEnabledRef.current || typeof window === 'undefined') return;
    // Don't cancel while the Ivy intro is speaking — let it finish naturally.
    if (!showIntroRef.current) window.speechSynthesis.cancel();
    const cleanText = text.replace(/[👋🎉💪😊🌟🚀]/g, '').replace(/\n/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1;
    const voice = pickPreferredVoice();
    if (voice) utterance.voice = voice;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  }, []);

  const addBotMessage = useCallback(
    (text: string) => {
      setIsTyping(true);
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
      botMsgTimerRef.current = setTimeout(() => {
        setMessages((prev) => [...prev, { id: newMsgId(), role: 'bot', content: text }]);
        setIsTyping(false);
        speak(text);
        setWaitingForResponse(true);
      }, 1400);
    },
    [speak, newMsgId],
  );

  // Keep stable refs in sync so the resume effect can read them without
  // needing them as deps (which would cause the effect to re-fire and race).
  useEffect(() => {
    conversationFlowRef.current = conversationFlow;
  });
  useEffect(() => {
    addBotMessageRef.current = addBotMessage;
  });
  useEffect(() => {
    newMsgIdRef.current = newMsgId;
  });

  useEffect(
    () => () => {
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
    },
    [],
  );
  useEffect(
    () => () => {
      if (splashTimerRef.current !== null) clearTimeout(splashTimerRef.current);
    },
    [],
  );

  // Resume hydration — deps are intentionally minimal to prevent race conditions.
  // conversationFlow, addBotMessage, newMsgId are read via stable refs so that a
  // parentName change (user loading after render) doesn't cancel an in-flight fetch.
  useEffect(() => {
    if (!resumeHydrationReady) return;
    let cancelled = false;
    const childId = activeChildIdRef.current;

    void (async () => {
      try {
        let slim: Record<string, unknown> = {};
        const [child, prefs] = await Promise.all([
          childId ? api.entities.Child.get(childId) : Promise.resolve(null),
          api.preferences.get(),
        ]);
        slim = child
          ? pickSavedQuestionnaireForChatbot(normalizeOnboardingChildDataBlob(child) ?? {})
          : {};
        if (typeof prefs.tts_enabled === 'boolean') {
          voiceEnabledRef.current = prefs.tts_enabled;
        }
        if (cancelled) return;

        const flow = conversationFlowRef.current;
        const addBot = addBotMessageRef.current!;

        const hasSaved = Object.keys(slim).length > 0;

        if (chatSessionStartedRef.current) {
          const canRecover =
            allowEmptySessionRecoveryRef.current && hasSaved && userTurnCountRef.current === 0;
          if (!canRecover) return;
          chatSessionStartedRef.current = false;
          allowEmptySessionRecoveryRef.current = false;
        }

        chatSessionStartedRef.current = true;
        allowEmptySessionRecoveryRef.current = !hasSaved;

        const autoIx = flow.findIndex((s) => s.type === 'auto');
        const answered =
          autoIx >= 0 && CHATBOT_CAPTURED_FIELDS.every((f) => questionnaireFieldHasValue(f, slim));

        if (hasSaved && answered && autoIx >= 0) {
          // All answered — show full summary, no messages needed
          summaryInitializedRef.current = true;
          setResumeSummary(buildResumeSummary(flow, slim, autoIx));
          setCollectedData({ ...slim });
          setMessages([]);
          setCurrentStep(autoIx);
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        if (!hasSaved) {
          const firstStep = flow[0];
          const firstMessage = firstStep
            ? typeof firstStep.message === 'function'
              ? firstStep.message(slim)
              : firstStep.message
            : '';
          setCollectedData({ ...slim });
          addBot(firstMessage);
          return;
        }

        const resumeIdx = findResumeStepIndex(flow, slim);
        // Show a compact summary of already-answered questions instead of
        // replaying individual message bubbles (which get clipped by slice(-6)).
        if (resumeIdx > 0) {
          summaryInitializedRef.current = true;
          setResumeSummary(buildResumeSummary(flow, slim, resumeIdx));
        }
        setCollectedData({ ...slim });
        setMessages([]);
        setCurrentStep(resumeIdx);

        const stepAt = flow[resumeIdx];
        if (!stepAt) return;
        if (stepAt.type === 'auto') {
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        const accR = buildAccThrough(flow, slim, resumeIdx);
        const nextBot =
          typeof stepAt.message === 'function'
            ? stepAt.message({ ...slim, ...accR })
            : stepAt.message;
        addBot(nextBot);
      } catch (err) {
        console.warn('[ConversationalOnboarding] Resume hydration failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeHydrationReady, activeChildId]);

  // Smooth scroll to bottom
  useEffect(() => {
    const t = setTimeout(() => {
      const c = scrollContainerRef.current;
      if (!c) return;
      const start = c.scrollTop;
      const end = c.scrollHeight - c.clientHeight;
      if (end <= start) return;
      const duration = 1800;
      const startTime = performance.now();
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now: number) => {
        const p = Math.min((now - startTime) / duration, 1);
        c.scrollTop = start + (end - start) * ease(p);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 350);
    return () => clearTimeout(t);
  }, [messages, isTyping]);

  useEffect(() => {
    if (waitingForResponse && inputRef.current) inputRef.current.focus();
  }, [waitingForResponse]);

  // Pre-fill text inputs from saved data
  useEffect(() => {
    if (!waitingForResponse || allAnswered) return;
    const stepData = conversationFlow[currentStep];
    if (!stepData?.field || stepData.type === 'choice' || stepData.type === 'auto') {
      setCurrentInput('');
      return;
    }
    const raw = collectedData[stepData.field];
    if (raw === undefined || raw === null) {
      setCurrentInput('');
      return;
    }
    const text = Array.isArray(raw)
      ? raw.join(', ')
      : typeof raw === 'string'
        ? raw
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : '';
    setCurrentInput(text);
  }, [waitingForResponse, currentStep, collectedData, conversationFlow, allAnswered]);

  const processResponse = useCallback(
    (response: string) => {
      const step = conversationFlow[currentStep];

      setMessages((prev) => [...prev, { id: newMsgId(), role: 'user', content: response }]);
      userTurnCountRef.current += 1;
      setWaitingForResponse(false);

      if (step?.field === 'age') {
        const trimmed = response.trim();
        // eslint-disable-next-line security/detect-unsafe-regex
        const ageMatch = trimmed.match(/^(\d+)\s*(years?|months?|y|m)?/i);
        if (!ageMatch) {
          setTimeout(() => {
            addBotMessage('Please enter age as a number in years (e.g., 10 or 10 years).');
            setWaitingForResponse(true);
          }, 400);
          return;
        }
        const unit = ageMatch[2]?.toLowerCase();
        if (unit && !unit.startsWith('year')) {
          setTimeout(() => {
            addBotMessage('Age must be in years only (e.g., 10 or 10 years). Please re-enter.');
            setWaitingForResponse(true);
          }, 400);
          return;
        }
        const ageNum = parseInt(ageMatch[1]!, 10);
        if (ageNum < 8) {
          setTimeout(() => {
            addBotMessage('Age must be at least 8 years. Please enter a valid age.');
            setWaitingForResponse(true);
          }, 400);
          return;
        }
      }

      if (step?.field === 'gender') {
        const lower = response.trim().toLowerCase();
        if (lower !== 'male' && lower !== 'female' && lower !== 'other') {
          setTimeout(() => {
            addBotMessage('Please select Male, Female, or Other.');
            setWaitingForResponse(true);
          }, 400);
          return;
        }
      }

      let nextCollected = collectedData;
      if (step?.field) {
        let value: unknown = response;
        if (step.type === 'multi_text') {
          value = response
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        nextCollected = { ...collectedData, [step.field]: value };
        setCollectedData(nextCollected);
        persistQuestionnaireDraft(nextCollected);
      }

      if (step?.id === 'complete') {
        const finalData = nextCollected;
        setAnalyzingState({
          show: true,
          progress: 0,
          name: typeof finalData['name'] === 'string' ? finalData['name'] : 'your child',
          showingDots: false,
          dotCount: 0,
        });
        let progress = 0;
        const interval = setInterval(() => {
          progress += 1;
          setAnalyzingState((s) => ({ ...s, progress }));
          if (progress >= 100) {
            clearInterval(interval);
            Promise.resolve(onComplete(finalData)).catch(() => {});
          }
        }, 28);
        return;
      }

      const nextStep = currentStep + 1;
      if (nextStep < conversationFlow.length) {
        // Check if we need to show a phase splash before advancing
        const splash = PHASE_SPLASHES[nextStep];
        if (splash) {
          const childName =
            typeof nextCollected['name'] === 'string' ? nextCollected['name'] : 'your child';
          const resolvedTitle = splash.title.replace('{name}', childName);
          setPhaseSplash({ ...splash, title: resolvedTitle });
          splashTimerRef.current = setTimeout(() => {
            setPhaseSplash(null);
            setCurrentStep(nextStep);
            const nextStepData = conversationFlow[nextStep];
            const nextMessage = nextStepData
              ? typeof nextStepData.message === 'function'
                ? nextStepData.message(nextCollected)
                : nextStepData.message
              : '';
            setTimeout(() => addBotMessage(nextMessage), 400);
          }, 2400);
        } else {
          setCurrentStep(nextStep);
          const nextStepData = conversationFlow[nextStep];
          const nextMessage = nextStepData
            ? typeof nextStepData.message === 'function'
              ? nextStepData.message(nextCollected)
              : nextStepData.message
            : '';
          setTimeout(() => addBotMessage(nextMessage), 600);

          if (nextStepData?.type === 'final') {
            setTimeout(() => {
              void onComplete(nextCollected);
            }, 2000);
          }
        }
      }
    },
    [
      conversationFlow,
      currentStep,
      collectedData,
      addBotMessage,
      persistQuestionnaireDraft,
      onComplete,
      newMsgId,
    ],
  );

  const handleSubmit = useCallback(
    (e: FormEvent | null) => {
      e?.preventDefault();
      if (!currentInput.trim() || !waitingForResponse) return;
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      processResponse(currentInput.trim());
      setCurrentInput('');
    },
    [currentInput, waitingForResponse, processResponse],
  );

  const handleChoiceSelect = useCallback(
    (choice: string) => {
      if (!waitingForResponse) return;
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      processResponse(choice);
    },
    [waitingForResponse, processResponse],
  );

  const currentStepData = conversationFlow[currentStep];

  // Derive last bot message for prominent display and history for scrollable area
  const latestBotContent = useMemo(() => {
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return last?.role === 'bot' ? last.content : null;
  }, [messages]);

  // Auto-proceed on 'auto' steps
  useEffect(() => {
    if (!waitingForResponse || currentStepData?.type !== 'auto' || allAnswered) return;
    setAnalyzingState((s) => ({ ...s, showingDots: true, dotCount: 0 }));
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let count = 0;
    const dotInterval = setInterval(() => {
      count += 1;
      setAnalyzingState((s) => ({ ...s, dotCount: count }));
      if (count >= 12) {
        clearInterval(dotInterval);
        const finalData = { ...collectedDataRef.current };
        setAnalyzingState({
          show: true,
          progress: 0,
          name: typeof finalData['name'] === 'string' ? finalData['name'] : 'your child',
          showingDots: false,
          dotCount: 0,
        });
        let progress = 0;
        progressInterval = setInterval(() => {
          progress += 1;
          setAnalyzingState((s) => ({ ...s, progress }));
          if (progress >= 100) {
            if (progressInterval !== null) clearInterval(progressInterval);
            Promise.resolve(onComplete(finalData)).catch(() => {});
          }
        }, 55);
      }
    }, 200);
    return () => {
      clearInterval(dotInterval);
      if (progressInterval !== null) clearInterval(progressInterval);
    };
  }, [waitingForResponse, currentStep, currentStepData?.type, allAnswered, onComplete]);

  // ── Completion splash (step 12) ─────────────────────────────────────────────

  if (showAnalyzing) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex flex-col items-center justify-center space-y-6 py-16 text-center"
      >
        <motion.div
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-500/15 text-4xl ring-4 ring-violet-400/20"
        >
          🎉
        </motion.div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold text-foreground">
            Perfect! Let's do <span className="text-primary">{analyzingName || 'your child'}</span>
            's personality analysis ✨
          </h2>
          <p className="text-sm text-muted-foreground">Getting things ready — almost there.</p>
        </div>
        <div className="w-full max-w-xs space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              animate={{ width: `${analyzeProgress}%` }}
              transition={{ duration: 0.1 }}
              className="h-full rounded-full bg-gradient-to-r from-primary to-violet-400"
            />
          </div>
          <p className="text-right text-xs text-muted-foreground/50">{analyzeProgress}%</p>
        </div>
        <p className="animate-pulse text-xs font-semibold uppercase tracking-wider text-primary">
          One moment…
        </p>
      </motion.div>
    );
  }

  // ── Phase splash interstitial ────────────────────────────────────────────────

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Ivy intro — full-screen image for 2 s */}
      <AnimatePresence>{showIntro && <IvyIntroScreen />}</AnimatePresence>

      {/* Deep blue ambient glow at bottom */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-0 right-0 h-80 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 100%, rgba(59,130,246,0.18), transparent)',
        }}
      />

      {/* Phase splash — full-screen overlay */}
      <AnimatePresence>{phaseSplash && <PhaseSplashScreen splash={phaseSplash} />}</AnimatePresence>

      {!phaseSplash && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── Scrollable top: orb + greeting + summary ───────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* ── Orb + greeting ─────────────────────────────────────────────── */}
            <div className="flex flex-col items-center px-6 pb-5 pt-8">
              <AnimatedOrb />
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="mt-5 text-sm font-medium text-white/60"
              >
                Hello {parentName}!
              </motion.p>
              <AnimatePresence mode="wait">
                {isTyping ? (
                  <motion.div
                    key="typing-dots"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.35 }}
                    className="mt-3 flex items-center gap-1.5"
                  >
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="h-2.5 w-2.5 animate-bounce rounded-full bg-blue-400/50"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </motion.div>
                ) : (
                  <motion.h2
                    key={(latestBotContent ?? 'idle').substring(0, 50)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="mt-2 max-w-lg text-center text-xl font-semibold leading-snug text-white/90"
                  >
                    {latestBotContent ?? 'How can I help you today?'}
                  </motion.h2>
                )}
              </AnimatePresence>
            </div>

            {/* ── Previously answered summary ─────────────────────────────── */}
            {resumeSummary && resumeSummary.length > 0 && (
              <details
                open
                className="group mx-4 mb-3 shrink-0 rounded-2xl border border-white/[0.07] bg-white/[0.04] px-4 py-3"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 text-[10px] font-bold text-emerald-400">
                      ✓
                    </span>
                    <span className="text-xs font-semibold text-white/50">
                      Previously answered · {resumeSummary.length} of 7
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5 shrink-0 text-white/30 transition-transform duration-200 group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="4 6 8 10 12 6" />
                  </svg>
                </summary>
                <div className="mt-2.5 space-y-1.5">
                  {resumeSummary.map((item) => (
                    <div key={item.label} className="flex items-baseline gap-2 text-xs">
                      <span className="w-28 shrink-0 font-medium text-white/40">{item.label}</span>
                      <span className="text-white/70">{item.answer}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          {/* end scrollable top */}

          {/* ── Pinned bottom controls ──────────────────────────────────── */}
          <div className="shrink-0">
            {/* ── Dots loading (completing) ───────────────────────────────── */}
            {showingLoadingDots && !allAnswered && (
              <div className="shrink-0 px-4 pb-3">
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 rounded-2xl border border-blue-400/15 bg-blue-500/[0.07] px-4 py-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/15">
                    <Sparkles className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white/90">
                      Let's do a personality analysis{'.'.repeat(1 + (dotCount % 3))}
                    </p>
                    <p className="mt-0.5 text-xs text-blue-300/60">
                      Getting things ready — almost there
                    </p>
                  </div>
                </motion.div>
              </div>
            )}

            {/* ── MCQ grid for choice steps ───────────────────────────────── */}
            {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
              <div className="shrink-0 space-y-3 px-4 pb-8">
                <MCQGrid
                  options={currentStepData.options ?? []}
                  selected={collectedData[currentStepData.field] as string | undefined}
                  onSelect={handleChoiceSelect}
                  stepKey={currentStep}
                />
                <div className="flex justify-end">
                  <AnimatePresence>
                    {!!collectedData[currentStepData.field] && (
                      <motion.div
                        key={String(collectedData[currentStepData.field])}
                        initial={{ opacity: 0, x: 20, scale: 0.9 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 80 }}
                        className="rounded-xl bg-blue-600/25 px-4 py-2 text-sm font-medium text-white/90"
                      >
                        {String(collectedData[currentStepData.field])}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* ── All answered — continue button ──────────────────────────── */}
            {allAnswered && typeof onContinueToPersonality === 'function' && (
              <div className="shrink-0 px-4 pb-4">
                <Button
                  type="button"
                  className="h-12 rounded-full bg-blue-600 px-8 text-white hover:bg-blue-500 active:bg-blue-700"
                  onClick={() => onContinueToPersonality()}
                >
                  Continue to personality analysis
                </Button>
              </div>
            )}

            {/* ── Pill text input (pinned bottom) ─────────────────────────── */}
            {waitingForResponse &&
              !allAnswered &&
              (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
                <div className="shrink-0 px-4 pb-8 pt-2">
                  {currentStepData.hint && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-white/40">
                      <Sparkles className="h-3 w-3 text-blue-400/60" />
                      {currentStepData.hint}
                    </p>
                  )}
                  <form onSubmit={handleSubmit}>
                    <div
                      className="flex items-center gap-2 rounded-full border border-blue-400/20 px-5 py-2.5"
                      style={{
                        background: 'rgba(12, 20, 48, 0.88)',
                        backdropFilter: 'blur(24px)',
                        boxShadow:
                          '0 0 40px rgba(59,130,246,0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
                      }}
                    >
                      <InputWithVoice
                        ref={inputRef}
                        value={currentInput}
                        onChange={(e) => setCurrentInput(e.target.value)}
                        placeholder={currentStepData.placeholder ?? 'Type your response…'}
                        className="h-9 border-0 bg-transparent py-0 text-sm text-white shadow-none ring-0 placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                      <Button
                        type="submit"
                        disabled={!currentInput.trim()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 p-0 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </form>
                </div>
              )}
          </div>
          {/* end pinned bottom controls */}
        </div>
      )}
    </div>
  );
}

// ── Animated Orb ──────────────────────────────────────────────────────────────

function AnimatedOrb() {
  return (
    <div className="pointer-events-none relative flex h-32 w-32 items-center justify-center">
      {/* Outer ambient pulse */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -inset-4 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.22) 0%, transparent 70%)',
          filter: 'blur(10px)',
        }}
      />
      {/* Spinning conic-gradient sphere */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-4 rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, #1e3a8a, #3b82f6, #60a5fa, #93c5fd, #3b82f6, #1d4ed8, #1e3a8a)',
        }}
      />
      {/* Counter-rotating inner swirl */}
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-8 rounded-full"
        style={{
          background:
            'conic-gradient(from 180deg, rgba(147,197,253,0.85), rgba(59,130,246,0.3), rgba(147,197,253,0.85))',
        }}
      />
      {/* Bright inner core */}
      <div
        className="absolute inset-11 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(186,230,253,0.65) 45%, transparent 80%)',
        }}
      />
    </div>
  );
}

// ── MCQ Grid sub-component ────────────────────────────────────────────────────

function MCQGrid({
  options,
  selected,
  onSelect,
  stepKey,
}: {
  options: string[];
  selected?: string;
  onSelect: (o: string) => void;
  stepKey: number;
}) {
  return (
    <div className={cn('grid gap-2.5', 'grid-cols-1 md:grid-cols-2')}>
      {options.map((option, idx) => {
        const Icon = OPTION_ICONS[option] ?? HelpCircle;
        const isSelected = selected === option;
        return (
          <motion.button
            key={`${stepKey}-${option}`}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.96 }}
            transition={{ delay: idx * 0.06, duration: 0.3, ease: 'easeOut' }}
            onClick={() => onSelect(option)}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all focus:outline-none',
              isSelected
                ? 'border-blue-500/60 bg-blue-600/20 text-white ring-1 ring-blue-400/30'
                : 'border-white/[0.07] bg-white/[0.03] text-white/60 hover:border-blue-400/30 hover:bg-blue-500/[0.07] hover:text-white/85',
            )}
          >
            <Icon
              className={cn('h-4 w-4 shrink-0', isSelected ? 'text-blue-400' : 'text-white/30')}
            />
            <span className="leading-tight">{option}</span>
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500"
              >
                <Check className="h-2.5 w-2.5 text-white" />
              </motion.div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
