import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import InputWithVoice from '@/components/shared/InputWithVoice';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Send, Brain, Sparkles, Star, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import {
  CHATBOT_CAPTURED_FIELDS,
  questionnaireFieldHasValue,
  pickSavedQuestionnaireForChatbot,
  normalizeOnboardingChildDataBlob,
} from '@/lib/onboardingChildData';
import { pickPreferredVoice } from '@/lib/tts';

// ── types ─────────────────────────────────────────────────────────────────────

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

interface ConversationalOnboardingProps {
  user?: { full_name?: string; email?: string } | null;
  activeChildId?: string;
  onComplete: (data: Record<string, unknown>) => void | Promise<void>;
  resumeHydrationReady?: boolean;
  onContinueToPersonality?: () => void;
  onQuestionnairePersisted?: (data: Record<string, unknown>) => void;
  onQuestionnaireCleared?: () => void;
}

// ── helper functions ──────────────────────────────────────────────────────────

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
    msgs.push({ id: newMsgId(), role: 'bot', content: botText });
    const val = data[step.field];
    const userDisplay = Array.isArray(val)
      ? val.join(', ')
      : typeof val === 'string'
        ? val
        : typeof val === 'number' || typeof val === 'boolean'
          ? String(val)
          : '';
    msgs.push({ id: newMsgId(), role: 'user', content: userDisplay });
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
  show: false,
  progress: 0,
  name: '',
  showingDots: false,
  dotCount: 0,
};

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
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  // Five tightly-coupled analyzing-phase states kept in one object to avoid split-state bugs.
  const [analyzingState, setAnalyzingState] = useState<AnalyzingState>(ANALYZING_INITIAL);
  const {
    show: showAnalyzing,
    progress: analyzeProgress,
    name: analyzingName,
    showingDots: showingLoadingDots,
    dotCount,
  } = analyzingState;
  const [allAnswered, setAllAnswered] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);
  // Stable ref to current collectedData — lets effects read the latest value without listing
  // collectedData as a dependency, avoiding unnecessary effect re-runs.
  const collectedDataRef = useRef<Record<string, unknown>>({});
  // Counter in a ref so the ID generator is stable and never shared across instances.
  const msgIdCounterRef = useRef(0);
  const newMsgId = useCallback(() => `${Date.now()}-${++msgIdCounterRef.current}`, []);

  useEffect(() => {
    collectedDataRef.current = collectedData;
  }, [collectedData]);

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
            console.warn('[ConversationalOnboarding] Auto-persist child data failed:', err);
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
          `Fantastic, Let's start exploring ${typeof data['name'] === 'string' ? data['name'] : ''}'s best version for life right away.\nMention the top 3 strengths that ${typeof data['name'] === 'string' ? data['name'] : ''} has from your perspective.`,
        field: 'strengths',
        type: 'multi_text',
        placeholder: 'e.g., Intelligent, Energetic, Well-mannered',
        hint: 'Separate with commas',
        phase: 1,
      },
      {
        id: 'strengths_response',
        message: (data) =>
          `Happy to know that! You are a lucky parent 😊.\n\nMention the top 3 hobbies where ${typeof data['name'] === 'string' ? data['name'] : ''} spends their time.`,
        field: 'hobbies',
        type: 'multi_text',
        placeholder: 'e.g., Cricket, Drawing, Reading',
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
          `What kind of a child ${typeof data['name'] === 'string' ? data['name'] : ''} emotionally is?`,
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

  // All deps are refs or module-level globals — stable across renders.
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
    // iOS Safari sometimes pauses synthesis; resume before speaking
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
      }, 1600);
    },
    [speak, newMsgId],
  );

  useEffect(() => {
    return () => {
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
    };
  }, []);

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
          setVoiceEnabled(prefs.tts_enabled);
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
        const nextBot =
          typeof stepAt.message === 'function' ? stepAt.message(accR) : stepAt.message;
        addBotMessage(nextBot);
      } catch (err) {
        console.warn('[ConversationalOnboarding] Resume hydration failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeHydrationReady, conversationFlow, addBotMessage, newMsgId, activeChildId]);

  const persistVoiceToggle = useCallback(async () => {
    const next = !voiceEnabledRef.current;
    voiceEnabledRef.current = next;
    setVoiceEnabled(next);
    if (!next && typeof window !== 'undefined') window.speechSynthesis?.cancel?.();
    try {
      await api.preferences.patch({ tts_enabled: next });
    } catch (err) {
      console.warn('[ConversationalOnboarding] Could not persist TTS preference:', err);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const start = container.scrollTop;
      const end = container.scrollHeight - container.clientHeight;
      if (end <= start) return;
      const duration = 2500;
      const startTime = performance.now();
      const easeInOutCubic = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const step = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        container.scrollTop = start + (end - start) * easeInOutCubic(progress);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 400);
    return () => clearTimeout(t);
  }, [messages, isTyping]);

  useEffect(() => {
    if (waitingForResponse && inputRef.current) {
      inputRef.current.focus();
    }
  }, [waitingForResponse]);

  /** Pre-fill text/multi answers from persisted collectedData when landing on that question */
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

  // Idle reminder — fires after 30s of no input when waiting for a response
  useEffect(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    if (!waitingForResponse || showAnalyzing || showingLoadingDots || allAnswered) return;

    idleTimerRef.current = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: newMsgId(),
          role: 'bot',
          content: "Just checking in 😊 — whenever you're ready, go ahead and share your answer!",
        },
      ]);
    }, 30000);

    return () => {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    };
  }, [waitingForResponse, currentStep, showAnalyzing, showingLoadingDots, allAnswered, newMsgId]);

  const processResponse = useCallback(
    (response: string) => {
      const step = conversationFlow[currentStep];

      setMessages((prev) => [...prev, { id: newMsgId(), role: 'user', content: response }]);
      userTurnCountRef.current += 1;
      setWaitingForResponse(false);

      if (response === 'Maybe later' || response === 'Catch up later') {
        addBotMessage(
          `No problem! Take your time. Your progress is saved and you can continue whenever you're ready. See you soon! 👋`,
        );
        return;
      }

      // ── field-level validation ──────────────────────────────────────────────
      if (step?.field === 'age') {
        const trimmed = response.trim();
        const ageMatch = trimmed.match(/^(\d+)\s*(years?|months?|y|m)?/i);
        if (!ageMatch) {
          setTimeout(() => {
            addBotMessage(`Please enter age as a number in years (e.g., 10 or 10 years).`);
            setWaitingForResponse(true);
          }, 400);
          return;
        }
        const unit = ageMatch[2]?.toLowerCase();
        if (unit && !unit.startsWith('year')) {
          setTimeout(() => {
            addBotMessage(`Age must be in years only (e.g., 10 or 10 years). Please re-enter.`);
            setWaitingForResponse(true);
          }, 400);
          return;
        }
        const ageNum = parseInt(ageMatch[1]!, 10);
        if (ageNum < 8) {
          setTimeout(() => {
            addBotMessage(`Age must be at least 8 years. Please enter a valid age.`);
            setWaitingForResponse(true);
          }, 400);
          return;
        }
      }

      if (step?.field === 'gender') {
        const lower = response.trim().toLowerCase();
        if (lower !== 'male' && lower !== 'female' && lower !== 'other') {
          setTimeout(() => {
            addBotMessage(`Please select Male, Female, or Other.`);
            setWaitingForResponse(true);
          }, 400);
          return;
        }
      }
      // ───────────────────────────────────────────────────────────────────────

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

      // Auto-trigger on the final step
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
        }, 28); // 28ms * 100 = 2.8 seconds
        return;
      }

      const nextStep = currentStep + 1;
      if (nextStep < conversationFlow.length) {
        setCurrentStep(nextStep);
        const nextStepData = conversationFlow[nextStep];
        const nextMessage = nextStepData
          ? typeof nextStepData.message === 'function'
            ? nextStepData.message(nextCollected)
            : nextStepData.message
          : '';

        setTimeout(() => addBotMessage(nextMessage), 700);

        if (nextStepData?.type === 'final') {
          setTimeout(() => {
            void onComplete(nextCollected);
          }, 2000);
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

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent | null) => {
      e?.preventDefault();
      if (!currentInput.trim() || !waitingForResponse) return;
      resetIdleTimer();
      processResponse(currentInput.trim());
      setCurrentInput('');
    },
    [currentInput, waitingForResponse, resetIdleTimer, processResponse],
  );

  const handleChoiceSelect = useCallback(
    (choice: string) => {
      if (!waitingForResponse) return;
      resetIdleTimer();
      processResponse(choice);
    },
    [waitingForResponse, resetIdleTimer, processResponse],
  );

  const handleReset = useCallback(() => {
    window.speechSynthesis.cancel();
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
    // Re-trigger the first message
    setTimeout(() => {
      const firstStep = conversationFlow[0];
      const firstMessage = firstStep
        ? typeof firstStep.message === 'function'
          ? firstStep.message({})
          : firstStep.message
        : '';
      addBotMessage(firstMessage);
    }, 100);
  }, [conversationFlow, addBotMessage, onQuestionnaireCleared, activeChildId]);

  const currentStepData = conversationFlow[currentStep];

  // Auto-proceed on 'auto' type steps after showing animated dots (live flow only — not when resuming with full questionnaire).
  // Uses collectedDataRef to read the latest collected data without adding it as a dependency.
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

  if (showAnalyzing) {
    const steps = [
      { label: 'Reading personality traits...', icon: Brain, threshold: 25 },
      { label: 'Mapping strengths & interests...', icon: Star, threshold: 55 },
      { label: 'Building growth profile...', icon: Sparkles, threshold: 80 },
      { label: 'Finalizing personalized journey...', icon: Sparkles, threshold: 100 },
    ];
    const activeStep = steps.findIndex((s) => analyzeProgress < s.threshold);
    const stepEntry = steps[activeStep >= 0 ? activeStep : steps.length - 1];
    const currentLabel = stepEntry?.label ?? '';

    return (
      <div className="border-edge flex h-[600px] max-h-[80vh] flex-col items-center justify-center space-y-8 overflow-hidden rounded-2xl bg-card px-6 py-10 sm:px-10 sm:py-12">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="glow-teal flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-dark"
        >
          <Brain className="h-8 w-8 text-white" />
        </motion.div>

        <div className="space-y-2 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            Analyzing {analyzingName}'s personality
          </h2>
          <p className="text-sm font-medium text-primary">{currentLabel}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-md space-y-2">
          <div className="bg-ghost-light h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-primary-medium to-primary-light transition-all duration-100"
              style={{ width: `${analyzeProgress}%` }}
            />
          </div>
          <p className="text-right text-xs font-medium text-muted-foreground">{analyzeProgress}%</p>
        </div>

        {/* Step indicators */}
        <div className="w-full max-w-md space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const done = analyzeProgress >= s.threshold;
            const prevStep = steps[i - 1];
            const active = !done && (i === 0 || analyzeProgress >= (prevStep?.threshold ?? 0));
            return (
              <div
                key={s.label}
                className={`flex items-center gap-3 transition-opacity duration-500 ${done || active ? 'opacity-100' : 'opacity-30'}`}
              >
                <div
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-all duration-500',
                    done && 'bg-gradient-to-br from-success to-primary-dark text-white',
                    active && 'bg-primary/20 text-primary ring-1 ring-primary/30',
                    !done && !active && 'bg-subtle text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="relative">
                  <span
                    className={`text-sm transition-colors duration-500 ${done ? 'font-medium text-success-bright' : active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  >
                    {s.label}
                  </span>
                  <AnimatePresence>
                    {done && (
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 1.4, ease: 'easeInOut' }}
                        style={{ originX: 0 }}
                        className="absolute left-0 right-0 top-[50%] h-px bg-success"
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="border-edge flex h-[600px] max-h-[80vh] flex-col overflow-hidden rounded-2xl bg-card">
      {/* Header */}
      <div className="border-b-edge-faint flex items-center justify-between bg-surface-elevated px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20">
            <span className="text-lg">🌱</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Buddy360 Guide</h3>
            <p className="text-xs text-muted-foreground">Your growth companion</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            void persistVoiceToggle();
          }}
          className="hover:bg-ghost-light text-muted-foreground hover:text-foreground"
        >
          {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((msg) =>
          msg.role === 'bot' ? (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                opacity: { duration: 2.0, ease: [0.0, 0.0, 0.6, 1] },
                y: { duration: 1.6, ease: 'easeOut' },
              }}
              className="flex justify-start"
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm',
                  'border-edge-faint bg-surface-input text-foreground',
                )}
              >
                <p className="whitespace-pre-line">{msg.content}</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                opacity: { duration: 1.6, ease: [0.0, 0.0, 0.6, 1] },
                x: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
              }}
              className="flex justify-end"
            >
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary-action px-4 py-2.5 text-sm text-white">
                <p className="whitespace-pre-line">{msg.content}</p>
              </div>
            </motion.div>
          ),
        )}

        <AnimatePresence>
          {isTyping && (
            <motion.div
              key="typing-indicator"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.3, ease: 'easeIn' } }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="flex justify-start"
            >
              <div className="border-edge-faint rounded-2xl rounded-tl-sm bg-surface-input px-4 py-3">
                <div className="flex gap-1">
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/30"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/30"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/30"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {showingLoadingDots && !allAnswered && (
        <div className="border-t-edge-faint px-4 pb-4 pt-2">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.375 }}
            className="flex justify-start"
          >
            <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-primary/20 bg-primary/[0.05] px-4 py-4 sm:max-w-[85%]">
              <div className="flex items-start gap-3">
                <div className="glow-teal-sm flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-dark">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-semibold leading-snug text-foreground">
                    Let's do a personality analysis{'.'.repeat(1 + (dotCount % 3))}
                  </p>
                  <p className="mt-1.5 text-xs text-primary">Getting things ready — almost there</p>
                  <div className="mt-3 flex gap-1.5">
                    <span
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-action/80"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-action"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
        <div className="border-t-edge-faint px-4 pb-4 pt-3">
          <div className="flex flex-wrap gap-2">
            {(currentStepData.options ?? []).map((option, index) => {
              const chosen = collectedData[currentStepData.field];
              const isSelected = chosen === option;
              return (
                <motion.button
                  key={`${currentStep}-${option}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.95, transition: { duration: 0.1, delay: 0 } }}
                  transition={{ delay: index * 0.12, duration: 0.4, ease: 'easeOut' }}
                  type="button"
                  onClick={() => handleChoiceSelect(option)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                    isSelected
                      ? 'border-primary-medium bg-primary-medium/15 text-primary-light'
                      : 'bg-ghost-md border-c-md hover:bg-primary/10 text-muted-foreground hover:border-primary/50 hover:text-primary'
                  }`}
                >
                  {option}
                </motion.button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleReset}
              title="Reset conversation"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-error"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        </div>
      )}

      {waitingForResponse &&
        !allAnswered &&
        (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
          <form onSubmit={handleSubmit} className="border-t-edge-faint p-4">
            {currentStepData.hint && (
              <p className="mb-2 text-xs text-muted-foreground">{currentStepData.hint}</p>
            )}
            <div className="flex gap-2">
              <InputWithVoice
                ref={inputRef}
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                placeholder={currentStepData.placeholder ?? 'Type your response...'}
                className="border-edge-md h-btn-md flex-1 rounded-xl bg-surface-input text-foreground placeholder:text-muted-foreground focus:border-primary/50"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                className="border-edge-md h-btn-md rounded-xl bg-transparent px-3 text-muted-foreground hover:border-error-medium/30 hover:text-error"
                title="Reset conversation"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                type="submit"
                className="h-btn-md rounded-xl bg-primary-action px-4 text-primary-foreground hover:bg-primary-action/90"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        )}

      {allAnswered && typeof onContinueToPersonality === 'function' && (
        <div className="border-t-edge-faint shrink-0 p-4">
          <Button
            type="button"
            className="btn-primary h-btn-md w-full rounded-2xl"
            onClick={() => onContinueToPersonality()}
          >
            Continue to personality analysis
          </Button>
        </div>
      )}
    </div>
  );
}
