import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import InputWithVoice from '@/components/shared/InputWithVoice';
import { Button } from '@/components/ui/button';
import {
  Send,
  Brain,
  Sparkles,
  Star,
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
  6: {
    icon: '🧠',
    iconColor: 'bg-violet-500/20 text-violet-300 ring-violet-400/20',
    title: "Now let's understand how {name} thinks",
    subtitle: 'Two quick taps — pick the one that feels closest.',
    displayStep: 5,
  },
  8: {
    icon: '⚡',
    iconColor: 'bg-teal-500/20 text-teal-300 ring-teal-400/20',
    title: "Almost there — a few more about their nature ⚡",
    subtitle: 'Energy, social, emotional. One tap each. Promise.',
    displayStep: 8,
  },
};

// Display step mapping: flow index → display step shown in header
const FLOW_TO_DISPLAY: Record<number, number> = {
  4: 3, 5: 4, 6: 6, 7: 7, 8: 9, 9: 10, 10: 11, 11: 12,
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

function buildReplayMessages(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  resumeIdx: number,
  newMsgId: () => string,
): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < resumeIdx; i++) {
    const step = flow[i];
    if (!step) break;
    if (step.type === 'auto') break;
    const acc = buildAccThrough(flow, data, i);
    const botText = typeof step.message === 'function' ? step.message(acc) : step.message;
    if (!botText) continue;
    msgs.push({ id: newMsgId(), role: 'bot', content: botText });
    const val = data[step.field];
    const userDisplay = Array.isArray(val)
      ? val.join(', ')
      : typeof val === 'string'
        ? val
        : typeof val === 'number' || typeof val === 'boolean'
          ? String(val)
          : '';
    if (userDisplay) msgs.push({ id: newMsgId(), role: 'user', content: userDisplay });
  }
  return msgs;
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
  show: false, progress: 0, name: '', showingDots: false, dotCount: 0,
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ConversationalOnboarding({
  user,
  activeChildId,
  onComplete,
  resumeHydrationReady = true,
  onContinueToPersonality,
  onQuestionnairePersisted,
  onQuestionnaireCleared,
}: ConversationalOnboardingProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>({});
  const [isTyping, setIsTyping] = useState(false);
  const [voiceEnabledState] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [analyzingState, setAnalyzingState] = useState<AnalyzingState>(ANALYZING_INITIAL);
  const [allAnswered, setAllAnswered] = useState(false);
  const [phaseSplash, setPhaseSplash] = useState<PhaseSplash | null>(null);

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
  const botMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);
  const collectedDataRef = useRef<Record<string, unknown>>({});
  const msgIdCounterRef = useRef(0);
  const newMsgId = useCallback(() => `${Date.now()}-${++msgIdCounterRef.current}`, []);
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { collectedDataRef.current = collectedData; }, [collectedData]);

  const persistQuestionnaireDraft = useCallback(
    (mergedCollected: Record<string, unknown>) => {
      onQuestionnairePersisted?.(mergedCollected);
      if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        void (async () => {
          if (!activeChildId) return;
          try {
            await api.entities.Child.update(activeChildId, mergedCollected);
          } catch (err) {
            console.warn('[ConversationalOnboarding] Auto-persist failed:', err);
          }
        })();
      }, 500);
    },
    [onQuestionnairePersisted, activeChildId],
  );

  const parentName = user?.full_name?.split(' ')[0] ?? 'there';

  const conversationFlow = useMemo<ConversationStep[]>(
    () => [
      {
        id: 'greeting',
        message: `Hey ${parentName}! Hope your day is going well.\nLet's start.\nWhat is your child's name?`,
        field: 'name',
        type: 'text',
        phase: 1,
      },
      {
        id: 'age',
        message: (data) =>
          `Wonderful! And how old is ${typeof data['name'] === 'string' ? data['name'] : ''}?`,
        field: 'age',
        type: 'text',
        placeholder: 'e.g., 10 years',
        phase: 1,
      },
      {
        id: 'gender',
        message: (data) =>
          `Got it! What is ${typeof data['name'] === 'string' ? data['name'] : ''}'s gender?`,
        field: 'gender',
        type: 'choice',
        options: ['Male', 'Female', 'Other'],
        phase: 1,
      },
      {
        id: 'school',
        message: (data) =>
          `Great! Which school does ${typeof data['name'] === 'string' ? data['name'] : ''} go to?`,
        field: 'school',
        type: 'text',
        phase: 1,
      },
      {
        id: 'ready_check',
        message: (data) =>
          `Fantastic. Let's start exploring ${typeof data['name'] === 'string' ? data['name'] : ''}'s best version for life right away.\nMention the top 3 strengths that ${typeof data['name'] === 'string' ? data['name'] : ''} has from your perspective.`,
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
        options: ['Talkative', 'Deep Listener', 'Communicates through gestures', 'Silent', 'Observant', 'Not Sure'],
        phase: 1,
      },
      {
        id: 'energy_level',
        message: (data) =>
          `How would you describe ${typeof data['name'] === 'string' ? data['name'] : ''}'s energy level?`,
        field: 'energy_level',
        type: 'choice',
        options: ['High energy - always active', 'Moderate - balanced', 'Calm and composed', 'Variable - depends on interest'],
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
    window.speechSynthesis.cancel();
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

  useEffect(() => () => { if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current); }, []);
  useEffect(() => () => { if (splashTimerRef.current !== null) clearTimeout(splashTimerRef.current); }, []);

  // Resume hydration
  useEffect(() => {
    if (!resumeHydrationReady) return;
    let cancelled = false;

    void (async () => {
      try {
        let slim: Record<string, unknown> = {};
        const [child, prefs] = await Promise.all([
          activeChildId ? api.entities.Child.get(activeChildId) : Promise.resolve(null),
          api.preferences.get(),
        ]);
        slim = child
          ? pickSavedQuestionnaireForChatbot(normalizeOnboardingChildDataBlob(child) ?? {})
          : {};
        if (typeof prefs.tts_enabled === 'boolean') {
          voiceEnabledRef.current = prefs.tts_enabled;
        }
        if (cancelled) return;

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

        const autoIx = conversationFlow.findIndex((s) => s.type === 'auto');
        const answered =
          autoIx >= 0 && CHATBOT_CAPTURED_FIELDS.every((f) => questionnaireFieldHasValue(f, slim));

        if (hasSaved && answered && autoIx >= 0) {
          const replay = buildReplayMessages(conversationFlow, slim, autoIx, newMsgId);
          setCollectedData({ ...slim });
          setMessages(replay);
          setCurrentStep(autoIx);
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        if (!hasSaved) {
          const firstStep = conversationFlow[0];
          const firstMessage = firstStep
            ? typeof firstStep.message === 'function'
              ? firstStep.message({})
              : firstStep.message
            : '';
          addBotMessage(firstMessage);
          return;
        }

        const resumeIdx = findResumeStepIndex(conversationFlow, slim);
        const replay = buildReplayMessages(conversationFlow, slim, resumeIdx, newMsgId);
        setCollectedData({ ...slim });
        setMessages(replay);
        setCurrentStep(resumeIdx);

        const stepAt = conversationFlow[resumeIdx];
        if (!stepAt) return;
        if (stepAt.type === 'auto') {
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        const accR = buildAccThrough(conversationFlow, slim, resumeIdx);
        const nextBot = typeof stepAt.message === 'function' ? stepAt.message(accR) : stepAt.message;
        addBotMessage(nextBot);
      } catch (err) {
        console.warn('[ConversationalOnboarding] Resume hydration failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [resumeHydrationReady, conversationFlow, addBotMessage, newMsgId, activeChildId]);

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
    if (raw === undefined || raw === null) { setCurrentInput(''); return; }
    const text = Array.isArray(raw)
      ? raw.join(', ')
      : typeof raw === 'string'
        ? raw
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : '';
    setCurrentInput(text);
  }, [waitingForResponse, currentStep, collectedData, conversationFlow, allAnswered]);

  // Idle reminder
  useEffect(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    if (!waitingForResponse || showAnalyzing || showingLoadingDots || allAnswered) return;
    idleTimerRef.current = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { id: newMsgId(), role: 'bot', content: "Just checking in 😊 — whenever you're ready!" },
      ]);
    }, 30000);
    return () => { if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current); };
  }, [waitingForResponse, currentStep, showAnalyzing, showingLoadingDots, allAnswered, newMsgId]);

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
          setTimeout(() => { addBotMessage('Please enter age as a number in years (e.g., 10 or 10 years).'); setWaitingForResponse(true); }, 400);
          return;
        }
        const unit = ageMatch[2]?.toLowerCase();
        if (unit && !unit.startsWith('year')) {
          setTimeout(() => { addBotMessage('Age must be in years only (e.g., 10 or 10 years). Please re-enter.'); setWaitingForResponse(true); }, 400);
          return;
        }
        const ageNum = parseInt(ageMatch[1]!, 10);
        if (ageNum < 8) {
          setTimeout(() => { addBotMessage('Age must be at least 8 years. Please enter a valid age.'); setWaitingForResponse(true); }, 400);
          return;
        }
      }

      if (step?.field === 'gender') {
        const lower = response.trim().toLowerCase();
        if (lower !== 'male' && lower !== 'female' && lower !== 'other') {
          setTimeout(() => { addBotMessage('Please select Male, Female, or Other.'); setWaitingForResponse(true); }, 400);
          return;
        }
      }

      let nextCollected = collectedData;
      if (step?.field) {
        let value: unknown = response;
        if (step.type === 'multi_text') {
          value = response.split(',').map((s) => s.trim()).filter(Boolean);
        }
        nextCollected = { ...collectedData, [step.field]: value };
        setCollectedData(nextCollected);
        persistQuestionnaireDraft(nextCollected);
      }

      if (step?.id === 'complete') {
        const finalData = nextCollected;
        setAnalyzingState({ show: true, progress: 0, name: typeof finalData['name'] === 'string' ? finalData['name'] : 'your child', showingDots: false, dotCount: 0 });
        let progress = 0;
        const interval = setInterval(() => {
          progress += 1;
          setAnalyzingState((s) => ({ ...s, progress }));
          if (progress >= 100) { clearInterval(interval); Promise.resolve(onComplete(finalData)).catch(() => {}); }
        }, 28);
        return;
      }

      const nextStep = currentStep + 1;
      if (nextStep < conversationFlow.length) {
        // Check if we need to show a phase splash before advancing
        const splash = PHASE_SPLASHES[nextStep];
        if (splash) {
          const childName = typeof nextCollected['name'] === 'string' ? nextCollected['name'] : 'your child';
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
            setTimeout(() => { void onComplete(nextCollected); }, 2000);
          }
        }
      }
    },
    [conversationFlow, currentStep, collectedData, addBotMessage, persistQuestionnaireDraft, onComplete, newMsgId],
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

  const handleReset = useCallback(() => {
    window.speechSynthesis.cancel();
    if (splashTimerRef.current !== null) clearTimeout(splashTimerRef.current);
    chatSessionStartedRef.current = false;
    allowEmptySessionRecoveryRef.current = false;
    userTurnCountRef.current = 0;
    setMessages([]);
    setCurrentStep(0);
    setCollectedData({});
    setCurrentInput('');
    setIsTyping(false);
    setWaitingForResponse(false);
    setAnalyzingState(ANALYZING_INITIAL);
    setAllAnswered(false);
    setPhaseSplash(null);
    void (async () => {
      try {
        if (activeChildId) {
          const cleared: Record<string, null> = {};
          for (const k of CHATBOT_CAPTURED_FIELDS) cleared[k] = null;
          await api.entities.Child.update(activeChildId, cleared);
        }
        onQuestionnaireCleared?.();
      } catch (err) {
        console.warn('[ConversationalOnboarding] Questionnaire clear failed:', err);
      }
    })();
    setTimeout(() => {
      const firstStep = conversationFlow[0];
      const firstMessage = firstStep
        ? typeof firstStep.message === 'function' ? firstStep.message({}) : firstStep.message
        : '';
      addBotMessage(firstMessage);
    }, 100);
  }, [conversationFlow, addBotMessage, onQuestionnaireCleared, activeChildId]);

  const currentStepData = conversationFlow[currentStep];

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
        setAnalyzingState({ show: true, progress: 0, name: typeof finalData['name'] === 'string' ? finalData['name'] : 'your child', showingDots: false, dotCount: 0 });
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
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-500/15 ring-4 ring-violet-400/20 text-4xl"
        >
          🎉
        </motion.div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold text-foreground">
            Perfect! Let's do{' '}
            <span className="text-primary">{analyzingName || 'your child'}</span>'s personality
            analysis ✨
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
          <p className="text-xs text-muted-foreground/50 text-right">{analyzeProgress}%</p>
        </div>
        <p className="text-xs font-semibold tracking-wider uppercase text-primary animate-pulse">
          One moment…
        </p>
      </motion.div>
    );
  }

  // ── Phase splash interstitial ────────────────────────────────────────────────

  const displayStep = FLOW_TO_DISPLAY[currentStep] ?? 3;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-card overflow-hidden">
      {/* Chat header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-surface-elevated px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary">
            <svg viewBox="0 0 20 22" className="h-5 w-5">
              <line x1="10" y1="21" x2="10" y2="14" stroke="#0d3d2e" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z" fill="#0d3d2e" />
              <path d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z" fill="#0d3d2e" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Buddy360 Guide</h3>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success-bright inline-block" />
              Your growth companion
            </p>
          </div>
        </div>
      </div>

      {/* Phase splash overlay */}
      <AnimatePresence>
        {phaseSplash && (
          <motion.div
            key="phase-splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="flex flex-col items-center justify-center gap-5 py-16 text-center px-8"
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 80, damping: 12 }}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-4xl ring-4 ${phaseSplash.iconColor}`}
            >
              {phaseSplash.icon}
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.45 }}
              className="space-y-2"
            >
              <h2 className="text-xl font-bold text-foreground">{phaseSplash.title}</h2>
              <p className="text-sm text-muted-foreground">{phaseSplash.subtitle}</p>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-xs font-semibold tracking-wider uppercase text-primary animate-pulse"
            >
              One moment…
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main chat area (hidden during splash) */}
      {!phaseSplash && (
        <>
          {/* Messages */}
          <div ref={scrollContainerRef} className="flex-1 h-64 min-h-[200px] max-h-[320px] overflow-y-auto space-y-3 p-5">
            <AnimatePresence initial={false}>
              {messages.slice(-6).map((msg) =>
                msg.role === 'bot' ? (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ opacity: { duration: 1.4, ease: [0, 0, 0.6, 1] }, y: { duration: 1.0, ease: 'easeOut' } }}
                    className="flex items-start gap-2.5"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                      <svg viewBox="0 0 20 22" className="h-3.5 w-3.5">
                        <line x1="10" y1="21" x2="10" y2="14" stroke="#0d3d2e" strokeWidth="2.2" strokeLinecap="round" />
                        <path d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z" fill="#0d3d2e" />
                        <path d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z" fill="#0d3d2e" />
                      </svg>
                    </div>
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-white/[0.07] bg-surface-input px-4 py-2.5 text-sm text-foreground">
                      <p className="whitespace-pre-line leading-relaxed">{msg.content}</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, x: 32 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ opacity: { duration: 1.2, ease: [0, 0, 0.6, 1] }, x: { duration: 1.0, ease: [0.22, 1, 0.36, 1] } }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary-action px-4 py-2.5 text-sm text-white">
                      <p className="whitespace-pre-line">{msg.content}</p>
                    </div>
                  </motion.div>
                ),
              )}
            </AnimatePresence>

            {/* Typing indicator */}
            <AnimatePresence>
              {isTyping && (
                <motion.div
                  key="typing"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4, transition: { duration: 0.25 } }}
                  className="flex items-start gap-2.5"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                    <svg viewBox="0 0 20 22" className="h-3.5 w-3.5">
                      <line x1="10" y1="21" x2="10" y2="14" stroke="#0d3d2e" strokeWidth="2.2" strokeLinecap="round" />
                      <path d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z" fill="#0d3d2e" />
                      <path d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z" fill="#0d3d2e" />
                    </svg>
                  </div>
                  <div className="rounded-2xl rounded-tl-sm border border-white/[0.07] bg-surface-input px-4 py-3">
                    <div className="flex gap-1">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/25"
                          style={{ animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Dots loading (completing) */}
          {showingLoadingDots && !allAnswered && (
            <div className="border-t border-white/[0.06] px-5 pb-5 pt-3">
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/[0.05] px-4 py-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Let's do a personality analysis{'.'.repeat(1 + (dotCount % 3))}
                  </p>
                  <p className="text-xs text-primary mt-0.5">Getting things ready — almost there</p>
                </div>
              </motion.div>
            </div>
          )}

          {/* MCQ grid for choice steps */}
          {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
            <div className="border-t border-white/[0.06] px-5 pb-5 pt-4 space-y-3">
              <MCQGrid
                options={currentStepData.options ?? []}
                selected={collectedData[currentStepData.field] as string | undefined}
                onSelect={handleChoiceSelect}
                stepKey={currentStep}
              />
              {/* Echo of last user answer */}
              <div className="flex justify-end">
                <AnimatePresence>
                  {collectedData[currentStepData.field] && (
                    <motion.div
                      key={String(collectedData[currentStepData.field])}
                      initial={{ opacity: 0, x: 20, scale: 0.9 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 80 }}
                      className="rounded-xl bg-primary-action px-4 py-2 text-sm text-white font-medium"
                    >
                      {String(collectedData[currentStepData.field])}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Text input */}
          {waitingForResponse && !allAnswered &&
            (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
              <form onSubmit={handleSubmit} className="border-t border-white/[0.06] p-4">
                {currentStepData.hint && (
                  <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-primary/60" />
                    {currentStepData.hint}
                  </p>
                )}
                <div className="flex gap-2">
                  <InputWithVoice
                    ref={inputRef}
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder={currentStepData.placeholder ?? 'Type your response…'}
                    className="border-white/[0.1] flex-1 rounded-xl bg-surface-input text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 h-10"
                  />
                  <Button
                    type="submit"
                    className="h-10 w-10 rounded-xl bg-primary-action text-white hover:bg-primary-action/90 shrink-0 p-0 flex items-center justify-center"
                    disabled={!currentInput.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            )}

          {/* All answered — continue button */}
          {allAnswered && typeof onContinueToPersonality === 'function' && (
            <div className="border-t border-white/[0.06] p-4">
              <Button
                type="button"
                className="btn-primary h-11 w-full rounded-2xl"
                onClick={() => onContinueToPersonality()}
              >
                Continue to personality analysis
              </Button>
            </div>
          )}
        </>
      )}
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
  // Use full-width single column when any option is long
  const useSingleCol = options.some((o) => o.length > 28);

  return (
    <div className={cn('grid gap-2.5', useSingleCol ? 'grid-cols-1' : 'grid-cols-2')}>
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
              'flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium text-left transition-all focus:outline-none',
              isSelected
                ? 'border-primary bg-primary/12 text-foreground ring-1 ring-primary/30'
                : 'border-white/[0.08] bg-surface-elevated text-muted-foreground hover:border-primary/30 hover:text-foreground hover:bg-primary/[0.05]',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground/60')} />
            <span className="leading-tight">{option}</span>
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-primary shrink-0"
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
