import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import ChatInputBar from '@/components/shared/ChatInputBar';
import { Button } from '@/components/ui/button';
import {
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
}

// ── Summary card icon map ─────────────────────────────────────────────────────

const SUMMARY_ICONS: Record<string, LucideIcon> = {
  Strengths: Sparkles,
  Hobbies: Heart,
  'Thinking style': Eye,
  Communication: MessageSquare,
  'Energy level': Activity,
  'Social behaviour': Shield,
  'Emotional nature': Moon,
};

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

const PHASE_SPLASHES: Record<number, PhaseSplash> = {};

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

// ── Phase splash full-screen interstitial ─────────────────────────────────────

function PhaseSplashScreen({ splash }: { splash: PhaseSplash }) {
  return (
    <motion.div
      key="phase-splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8 text-center">
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
      className="fixed inset-0 z-50 bg-[var(--bg-deep-3)]"
    >
      <img
        src="/app-assets/avatars/ivy-intro.jpg"
        alt="Ivy"
        className="h-full w-full object-cover object-top"
      />
      {/* Dark gradient veil */}
      <div className="onboarding-intro-veil absolute inset-0" />
      {/* Greeting text */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="onboarding-intro-text-shadow absolute bottom-16 left-0 right-0 px-8 text-center text-xl font-bold leading-snug text-white"
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
    progress: _analyzeProgress,
    name: _analyzingName,
    showingDots: showingLoadingDots,
    dotCount: _dotCount,
  } = analyzingState;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
      setMessages((prev) => [...prev, { id: newMsgId(), role: 'bot', content: text }]);
      setIsTyping(false);
      speak(text);
      setWaitingForResponse(true);
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
    if (waitingForResponse && inputRef.current) inputRef.current.focus({ preventScroll: true });
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
      }

      if (step?.id === 'complete') {
        const finalData = nextCollected;
        setAnalyzingState({
          show: true,
          progress: 100,
          name: typeof finalData['name'] === 'string' ? finalData['name'] : 'your child',
          showingDots: true,
          dotCount: 0,
        });
        setTimeout(() => {
          Promise.resolve(onComplete(finalData)).catch(() => {});
        }, 2000);
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
    [conversationFlow, currentStep, collectedData, addBotMessage, onComplete, newMsgId],
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
    let count = 0;
    const dotInterval = setInterval(() => {
      count += 1;
      setAnalyzingState((s) => ({ ...s, dotCount: count }));
      if (count >= 10) {
        clearInterval(dotInterval);
        const finalData = { ...collectedDataRef.current };
        Promise.resolve(onComplete(finalData)).catch(() => {});
      }
    }, 200);
    return () => {
      clearInterval(dotInterval);
    };
  }, [waitingForResponse, currentStep, currentStepData?.type, allAnswered, onComplete]);

  // ── Phase splash interstitial ────────────────────────────────────────────────

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Ivy intro — full-screen image for 2 s */}
      <AnimatePresence>{showIntro && <IvyIntroScreen />}</AnimatePresence>

      {/* Deep blue ambient glow at bottom */}
      <div
        aria-hidden="true"
        className="onboarding-bg-glow pointer-events-none fixed bottom-0 left-0 right-0 h-80 opacity-70"
      />

      {/* Phase splash — full-screen overlay */}
      <AnimatePresence>{phaseSplash && <PhaseSplashScreen splash={phaseSplash} />}</AnimatePresence>

      {!phaseSplash && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── Static: orb + greeting (never flips) ───────────────────────── */}
          <div className="flex shrink-0 flex-col items-center px-6 pb-3 pt-8 md:pb-4 md:pt-10">
            <AnimatedOrb />
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="mt-5 text-[22px] font-medium text-white/60 md:mt-6 md:text-[26px]"
            >
              Hello {parentName}!
            </motion.p>
          </div>

          {/* ── Single flip unit: question (scrollable) + input (pinned bottom) */}
          {/* One AnimatePresence = perfect sync, no separate wrappers needed   */}
          <div className="flex min-h-0 flex-1 flex-col" style={{ perspective: '1200px' }}>
            <AnimatePresence mode="wait">
              {showingLoadingDots || showAnalyzing ? (
                <motion.div
                  key="thank-you"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-40"
                >
                  <p className="w-full max-w-2xl text-center text-3xl font-bold leading-[1.08] text-white/90 sm:text-4xl">
                    Thank you for your responses, continuing ahead
                  </p>
                  <div className="flex items-center gap-2.5">
                    {[0, 0.15, 0.3].map((delay, i) => (
                      <motion.span
                        key={i}
                        animate={{ y: [0, -10, 0] }}
                        transition={{ duration: 0.7, repeat: Infinity, delay, ease: 'easeInOut' }}
                        className="h-3 w-3 rounded-full bg-info/60"
                      />
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={currentStep}
                  variants={{
                    initial: { rotateY: 90, opacity: 0, scale: 0.96 },
                    enter: {
                      rotateY: 0,
                      opacity: 1,
                      scale: 1,
                      transition: { duration: 2, ease: [0.4, 0, 0.2, 1] },
                    },
                    exit: {
                      rotateY: -90,
                      opacity: 0,
                      scale: 0.96,
                      transition: { duration: 2, ease: [0.4, 0, 0.2, 1] },
                    },
                  }}
                  initial="initial"
                  animate="enter"
                  exit="exit"
                  style={{ backfaceVisibility: 'hidden', transformStyle: 'preserve-3d' }}
                  className="flex flex-1 flex-col overflow-hidden"
                >
                  {/* Scrollable: question text + summary + continue button */}
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="flex flex-col items-center px-6 pb-5 pt-4 md:pb-6 md:pt-6">
                      {/* The measure widens with the type: a readable line is a
                          character count, so a max-w frozen while the text grew
                          would only add wrap lines. */}
                      <h2 className="mx-auto w-full max-w-2xl text-center text-3xl font-bold leading-[1.08] text-white/90 sm:text-4xl md:max-w-3xl md:text-[42px] lg:max-w-4xl lg:text-5xl">
                        {latestBotContent}
                      </h2>
                    </div>

                    {/* ── Previously answered summary ────────────────────────── */}
                    {resumeSummary && resumeSummary.length > 0 && (
                      <div className="mx-4 mb-4 space-y-3 md:mx-6 md:mb-6 md:space-y-4">
                        <div className="flex items-center gap-2 px-1 md:gap-2.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success-bright/15 text-[10px] font-bold text-success-bright md:h-6 md:w-6 md:text-xs">
                            ✓
                          </span>
                          <span className="text-xs font-semibold uppercase tracking-wider text-white/30 md:text-sm">
                            Your answers · {resumeSummary.length} of 7
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:gap-3 lg:grid-cols-3">
                          {resumeSummary.map((item, i) => {
                            const Icon = SUMMARY_ICONS[item.label] ?? Sparkles;
                            const values = item.answer.includes(',')
                              ? item.answer.split(',').map((v) => v.trim())
                              : null;
                            return (
                              <motion.div
                                key={item.label}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.06, duration: 0.35, ease: 'easeOut' }}
                                className="border-edge-faint bg-ghost-md rounded-2xl border px-3.5 py-3 md:px-5 md:py-4"
                              >
                                <div className="mb-1.5 flex items-center gap-1.5 md:mb-2 md:gap-2">
                                  <Icon className="h-3 w-3 text-info/60 md:h-4 md:w-4" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30 md:text-xs">
                                    {item.label}
                                  </span>
                                </div>
                                {values ? (
                                  <div className="flex flex-wrap gap-1 md:gap-1.5">
                                    {values.map((v) => (
                                      <span
                                        key={v}
                                        className="rounded-full bg-info-strong/15 px-2 py-0.5 text-[11px] font-medium text-white/70 md:px-2.5 md:py-1 md:text-[13px]"
                                      >
                                        {v}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm font-medium leading-snug text-white/80 md:text-base">
                                    {item.answer}
                                  </p>
                                )}
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── All answered — continue button ─────────────────────── */}
                    {allAnswered && typeof onContinueToPersonality === 'function' && (
                      <div className="flex justify-center px-4 pb-8 pt-6 md:pb-10 md:pt-8">
                        <Button
                          type="button"
                          className="h-12 rounded-full bg-info-strong px-8 text-white hover:bg-info-medium active:bg-info-strong/80 md:h-14 md:px-10 md:text-base"
                          onClick={() => onContinueToPersonality()}
                        >
                          Continue to personality analysis
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Pinned bottom: MCQ or chat input — part of same flip unit */}
                  <div className="shrink-0">
                    {/* MCQ grid for choice steps */}
                    {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
                      <div className="space-y-3 px-4 pb-8">
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
                                className="rounded-xl bg-info-strong/25 px-4 py-2 text-sm font-medium text-foreground"
                              >
                                {String(collectedData[currentStepData.field])}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    )}

                    {/* Chat input bar for text steps */}
                    {waitingForResponse &&
                      !allAnswered &&
                      (currentStepData?.type === 'text' ||
                        currentStepData?.type === 'multi_text') && (
                        <>
                          {currentStepData.hint && (
                            <p className="mb-1 flex items-center gap-1.5 px-5 text-xs text-white/40">
                              <Sparkles className="h-3 w-3 text-info/60" />
                              {currentStepData.hint}
                            </p>
                          )}
                          <ChatInputBar
                            inputRef={inputRef}
                            value={currentInput}
                            onChange={(e) => setCurrentInput(e.target.value)}
                            onSubmit={handleSubmit}
                            onVoiceTranscript={(text) =>
                              setCurrentInput((prev) => (prev ? `${prev} ${text}` : text))
                            }
                            disabled={!waitingForResponse}
                            placeholder={currentStepData.placeholder ?? 'Type your response…'}
                          />
                        </>
                      )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Animated Orb ──────────────────────────────────────────────────────────────

function AnimatedOrb() {
  return (
    // --orb-size is the single knob: the ring inset and the crescent geometry in
    // index.css are both fractions of it, so one value per breakpoint scales the
    // whole orb without knocking its layers out of register.
    <div className="pointer-events-none relative [--orb-size:120px] md:[--orb-size:150px]">
      {/* Pulsing ambient glow */}
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.35, 0.65, 0.35] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="orb-ambient absolute -inset-4 rounded-full md:-inset-5"
      />
      {/* Main orb — multi-radial gradient matching reference design */}
      <div className="orb-main relative h-[var(--orb-size)] w-[var(--orb-size)] rounded-full">
        {/* Inner ring */}
        <div className="orb-ring absolute inset-[calc(var(--orb-size)/24)]" />
        {/* Crescent arc */}
        <div className="orb-crescent" />
      </div>
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
              'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all focus:outline-none sm:px-5 sm:py-4 sm:text-base',
              isSelected
                ? 'border-info-medium/60 bg-info-strong/20 text-foreground ring-1 ring-info/30'
                : 'border-edge-faint bg-ghost-md text-muted-foreground hover:border-info/30 hover:bg-info-medium/[0.07] hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                isSelected ? 'text-info' : 'text-muted-foreground/50',
              )}
            />
            <span className="leading-tight">{option}</span>
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-info-medium"
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
