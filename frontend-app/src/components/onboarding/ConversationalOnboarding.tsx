import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  type TextInput,
} from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import ChatInputBar from '@/components/shared/ChatInputBar';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import { useTts } from '@/lib/TtsContext';
import {
  CHATBOT_CAPTURED_FIELDS,
  questionnaireFieldHasValue,
  pickSavedQuestionnaireForChatbot,
  normalizeOnboardingChildDataBlob,
} from '@/lib/onboardingChildData';
import { speakText, stopSpeech } from '@/lib/tts';
import { gradient, hsl } from '@/theme';
import AnimatedOrb from './conversational/AnimatedOrb';
import MCQGrid from './conversational/MCQGrid';
import ResumeSummary from './conversational/ResumeSummary';
import {
  IvyIntroOverlay,
  PhaseSplashOverlay,
} from './conversational/IntroOverlays';
import {
  ANALYZING_INITIAL,
  PHASE_SPLASHES,
  buildAccThrough,
  buildConversationFlow,
  buildResumeSummary,
  findResumeStepIndex,
  stepMessage,
  type AnalyzingState,
  type ChatMessage,
  type ConversationStep,
  type PhaseSplash,
  type SummaryItem,
} from './conversational/flow';

interface ConversationalOnboardingProps {
  user?: { full_name?: string; email?: string } | null;
  activeChildId?: string;
  onComplete: (data: Record<string, unknown>) => void | Promise<void>;
  resumeHydrationReady?: boolean;
  onContinueToPersonality?: () => void;
}

const IVY_MSG =
  "Hi, I am Ivy. Let's transform your child to their superpower personality.";

// ── Animations (web framer variants) ─────────────────────────────────────────

const easeOut = Easing.out(Easing.ease);
const flipEase = Easing.bezier(0.4, 0, 0.2, 1);
const FLIP_MS = 2000;

// <AnimatePresence mode="wait">: the incoming view waits for the outgoing exit.
function flipEntering(delayMs: number) {
  return new Keyframe({
    0: {
      opacity: 0,
      transform: [{ perspective: 1200 }, { rotateY: '90deg' }, { scale: 0.96 }],
    },
    100: {
      opacity: 1,
      transform: [{ perspective: 1200 }, { rotateY: '0deg' }, { scale: 1 }],
      easing: flipEase,
    },
  })
    .duration(FLIP_MS)
    .delay(delayMs);
}

const FLIP_EXITING = new Keyframe({
  0: {
    opacity: 1,
    transform: [{ perspective: 1200 }, { rotateY: '0deg' }, { scale: 1 }],
  },
  100: {
    opacity: 0,
    transform: [{ perspective: 1200 }, { rotateY: '-90deg' }, { scale: 0.96 }],
    easing: flipEase,
  },
}).duration(FLIP_MS);

function thankYouEntering(delayMs: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 10 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
  })
    .duration(500)
    .delay(delayMs);
}

const THANK_YOU_EXITING = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -10 }], easing: easeOut },
}).duration(500);

const GREETING_ENTERING = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1 },
})
  .duration(600)
  .delay(300);

// web: initial={{ opacity: 0, x: 20, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} (spring).
const SELECTED_PILL_ENTERING = new Keyframe({
  0: { opacity: 0, transform: [{ translateX: 20 }, { scale: 0.9 }] },
  100: {
    opacity: 1,
    transform: [{ translateX: 0 }, { scale: 1 }],
    easing: easeOut,
  },
}).duration(500);

// Bouncing dots: animate={{ y: [0, -10, 0] }}, 0.7s easeInOut, infinite, staggered.
const DOT_BOUNCE = {
  '0%': { transform: [{ translateY: 0 }] },
  '50%': { transform: [{ translateY: -10 }] },
  '100%': { transform: [{ translateY: 0 }] },
};

/** Keeps its children above the keyboard; the offset is this view's own window y (header + back row). */
function KeyboardAvoider({ children }: { children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  return (
    <View
      ref={ref}
      className="min-h-0 flex-1"
      onLayout={() => ref.current?.measureInWindow((_x, y) => setOffset(y))}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={offset}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
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
  const insets = useSafeAreaInsets();
  const [showIntro, setShowIntro] = useState(true);
  const showIntroRef = useRef(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>(
    {},
  );
  const [isTyping, setIsTyping] = useState(false);
  const { ttsEnabled } = useTts();
  const voiceEnabledRef = useRef(ttsEnabled);
  useEffect(() => {
    voiceEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [analyzingState, setAnalyzingState] =
    useState<AnalyzingState>(ANALYZING_INITIAL);
  const [allAnswered, setAllAnswered] = useState(false);
  const [phaseSplash, setPhaseSplash] = useState<PhaseSplash | null>(null);
  const [resumeSummary, setResumeSummary] = useState<SummaryItem[] | null>(
    null,
  );
  const summaryInitializedRef = useRef(false);

  const { show: showAnalyzing, showingDots: showingLoadingDots } =
    analyzingState;

  const scrollContainerRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChildIdRef = useRef(activeChildId);
  const botMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);
  const collectedDataRef = useRef<Record<string, unknown>>({});
  const msgIdCounterRef = useRef(0);
  const newMsgId = useCallback(
    () => `${Date.now()}-${++msgIdCounterRef.current}`,
    [],
  );
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable refs for the resume effect — avoids re-triggering it when these change
  const conversationFlowRef = useRef<ConversationStep[]>([]);
  const addBotMessageRef = useRef<((text: string) => void) | null>(null);
  const newMsgIdRef = useRef(newMsgId);
  // Web speechSynthesis queues utterances spoken while the Ivy intro is still
  // talking (it only cancels once the intro is gone); speakText() always
  // cancels, so those are held here and played after the intro finishes.
  const speechQueueRef = useRef<string[]>([]);
  const speechDisposedRef = useRef(false);
  // The first step view flips in immediately; later ones wait for the previous exit.
  const flipDelayRef = useRef(0);

  useEffect(() => {
    collectedDataRef.current = collectedData;
  }, [collectedData]);

  const flushSpeechQueue = useCallback(() => {
    if (speechDisposedRef.current) return;
    const next = speechQueueRef.current.shift();
    if (next === undefined) return;
    speakText(next, { rate: 0.9, pitch: 1.0, onDone: flushSpeechQueue });
  }, []);

  // Ivy intro: show image, speak greeting, dismiss when speech ends.
  useEffect(() => {
    speechDisposedRef.current = false;
    const dismiss = () => {
      showIntroRef.current = false;
      setShowIntro(false);
    };
    // Fallback: dismiss after 10s if speech never fires onend.
    const fallback = setTimeout(dismiss, 10000);
    let silentTimer: ReturnType<typeof setTimeout> | null = null;

    if (!voiceEnabledRef.current) {
      clearTimeout(fallback);
      silentTimer = setTimeout(dismiss, 2000);
    } else {
      speakText(IVY_MSG, {
        rate: 0.95,
        pitch: 1.0,
        onDone: () => {
          if (speechDisposedRef.current) return;
          clearTimeout(fallback);
          dismiss();
          flushSpeechQueue();
        },
      });
    }

    return () => {
      speechDisposedRef.current = true;
      speechQueueRef.current = [];
      clearTimeout(fallback);
      if (silentTimer !== null) clearTimeout(silentTimer);
      stopSpeech();
    };
  }, [flushSpeechQueue]);

  // Keep the previously-answered summary in sync as the user progresses.
  useEffect(() => {
    if (!summaryInitializedRef.current) return;
    setResumeSummary(
      buildResumeSummary(
        conversationFlowRef.current,
        collectedData,
        currentStep,
      ),
    );
  }, [collectedData, currentStep]);

  useEffect(() => {
    activeChildIdRef.current = activeChildId ?? undefined;
  }, [activeChildId]);

  const parentName = user?.full_name?.split(' ')[0] ?? 'there';

  const conversationFlow = useMemo<ConversationStep[]>(
    () => buildConversationFlow(parentName),
    [parentName],
  );

  // TTS
  const speak = useCallback((text: string) => {
    if (!voiceEnabledRef.current) return;
    const cleanText = text.replace(/[👋🎉💪😊🌟🚀]/g, '').replace(/\n/g, ' ');
    // Don't cancel while the Ivy intro is speaking — let it finish naturally.
    if (showIntroRef.current) {
      speechQueueRef.current.push(cleanText);
      return;
    }
    speechQueueRef.current = [];
    speakText(cleanText, { rate: 0.9, pitch: 1.0 });
  }, []);

  const addBotMessage = useCallback(
    (text: string) => {
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
      setMessages(prev => [
        ...prev,
        { id: newMsgId(), role: 'bot', content: text },
      ]);
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
        const child = childId ? await api.entities.Child.get(childId) : null;
        const slim = child
          ? pickSavedQuestionnaireForChatbot(
              normalizeOnboardingChildDataBlob(child) ?? {},
            )
          : {};
        if (cancelled) return;

        const flow = conversationFlowRef.current;
        const addBot = addBotMessageRef.current;
        if (!addBot) return;

        const hasSaved = Object.keys(slim).length > 0;

        if (chatSessionStartedRef.current) {
          const canRecover =
            allowEmptySessionRecoveryRef.current &&
            hasSaved &&
            userTurnCountRef.current === 0;
          if (!canRecover) return;
          chatSessionStartedRef.current = false;
          allowEmptySessionRecoveryRef.current = false;
        }

        chatSessionStartedRef.current = true;
        allowEmptySessionRecoveryRef.current = !hasSaved;

        const autoIx = flow.findIndex(s => s.type === 'auto');
        const answered =
          autoIx >= 0 &&
          CHATBOT_CAPTURED_FIELDS.every(f =>
            questionnaireFieldHasValue(f, slim),
          );

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
          const firstMessage = stepMessage(flow[0], slim);
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
        addBot(stepMessage(stepAt, { ...slim, ...accR }));
      } catch (err) {
        console.warn(
          '[ConversationalOnboarding] Resume hydration failed:',
          err,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeHydrationReady, activeChildId]);

  // Scroll to bottom (web: 1800ms eased scroll, 350ms after messages change).
  useEffect(() => {
    const t = setTimeout(() => {
      scrollContainerRef.current?.scrollToEnd({ animated: true });
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
    if (
      !stepData?.field ||
      stepData.type === 'choice' ||
      stepData.type === 'auto'
    ) {
      setCurrentInput('');
      return;
    }
    const rawVal = collectedData[stepData.field];
    if (rawVal === undefined || rawVal === null) {
      setCurrentInput('');
      return;
    }
    const text = Array.isArray(rawVal)
      ? rawVal.join(', ')
      : typeof rawVal === 'string'
      ? rawVal
      : typeof rawVal === 'number' || typeof rawVal === 'boolean'
      ? String(rawVal)
      : '';
    setCurrentInput(text);
  }, [
    waitingForResponse,
    currentStep,
    collectedData,
    conversationFlow,
    allAnswered,
  ]);

  const processResponse = useCallback(
    (response: string) => {
      const step = conversationFlow[currentStep];

      setMessages(prev => [
        ...prev,
        { id: newMsgId(), role: 'user', content: response },
      ]);
      userTurnCountRef.current += 1;
      setWaitingForResponse(false);

      if (step?.field === 'age') {
        const trimmed = response.trim();
        const ageMatch = trimmed.match(/^(\d+)\s*(years?|months?|y|m)?/i);
        if (!ageMatch) {
          setTimeout(() => {
            addBotMessage(
              'Please enter age as a number in years (e.g., 10 or 10 years).',
            );
            setWaitingForResponse(true);
          }, 400);
          return;
        }
        const unit = ageMatch[2]?.toLowerCase();
        if (unit && !unit.startsWith('year')) {
          setTimeout(() => {
            addBotMessage(
              'Age must be in years only (e.g., 10 or 10 years). Please re-enter.',
            );
            setWaitingForResponse(true);
          }, 400);
          return;
        }
        const ageNum = parseInt(ageMatch[1] ?? '', 10);
        if (ageNum < 8) {
          setTimeout(() => {
            addBotMessage(
              'Age must be at least 8 years. Please enter a valid age.',
            );
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
            .map(s => s.trim())
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
          name:
            typeof finalData.name === 'string' ? finalData.name : 'your child',
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
            typeof nextCollected.name === 'string'
              ? nextCollected.name
              : 'your child';
          const resolvedTitle = splash.title.replace('{name}', childName);
          setPhaseSplash({ ...splash, title: resolvedTitle });
          splashTimerRef.current = setTimeout(() => {
            setPhaseSplash(null);
            setCurrentStep(nextStep);
            const nextMessage = stepMessage(
              conversationFlow[nextStep],
              nextCollected,
            );
            setTimeout(() => addBotMessage(nextMessage), 400);
          }, 2400);
        } else {
          setCurrentStep(nextStep);
          const nextStepData = conversationFlow[nextStep];
          const nextMessage = stepMessage(nextStepData, nextCollected);
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
      onComplete,
      newMsgId,
    ],
  );

  const handleSubmit = useCallback(
    (_e: null) => {
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

  // Derive last bot message for prominent display
  const latestBotContent = useMemo(() => {
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return last?.role === 'bot' ? last.content : null;
  }, [messages]);

  // Auto-proceed on 'auto' steps
  useEffect(() => {
    if (!waitingForResponse || currentStepData?.type !== 'auto' || allAnswered)
      return;
    setAnalyzingState(s => ({ ...s, showingDots: true, dotCount: 0 }));
    let count = 0;
    const dotInterval = setInterval(() => {
      count += 1;
      setAnalyzingState(s => ({ ...s, dotCount: count }));
      if (count >= 10) {
        clearInterval(dotInterval);
        const finalData = { ...collectedDataRef.current };
        Promise.resolve(onComplete(finalData)).catch(() => {});
      }
    }, 200);
    return () => {
      clearInterval(dotInterval);
    };
  }, [
    waitingForResponse,
    currentStep,
    currentStepData?.type,
    allAnswered,
    onComplete,
  ]);

  const showThankYou = showingLoadingDots || showAnalyzing;
  // mode="wait": whatever mounts after the first step view waits out the previous exit.
  const enterDelay = flipDelayRef.current;
  useEffect(() => {
    flipDelayRef.current = FLIP_MS;
  }, []);

  const selectedChoice =
    currentStepData?.type === 'choice'
      ? collectedData[currentStepData.field]
      : undefined;

  return (
    <View className="relative min-h-0 flex-1">
      {/* Ivy intro — full-screen image while the greeting is spoken */}
      <IvyIntroOverlay visible={showIntro} />

      {/* Deep blue ambient glow at bottom */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="absolute bottom-0 left-0 right-0 h-80 opacity-70"
        style={{ experimental_backgroundImage: gradient.onboardingBgGlow }}
      />

      {/* Phase splash — full-screen overlay */}
      <PhaseSplashOverlay splash={phaseSplash} />

      {!phaseSplash && (
        <View className="flex-1 overflow-hidden">
          {/* ── Static: orb + greeting (never flips) ───────────────────────── */}
          <View className="shrink-0 items-center px-6 pb-3 pt-8">
            <AnimatedOrb />
            <Animated.Text
              entering={GREETING_ENTERING}
              className="mt-5 text-[22px] font-medium text-white/60"
            >
              Hello {parentName}!
            </Animated.Text>
          </View>

          {/* ── Single flip unit: question (scrollable) + input (pinned bottom) */}
          <KeyboardAvoider>
            {showThankYou ? (
              <Animated.View
                key="thank-you"
                entering={thankYouEntering(enterDelay)}
                exiting={THANK_YOU_EXITING}
                className="flex-1 items-center justify-center gap-6 px-6 pb-40"
              >
                <Text
                  className="w-full max-w-2xl text-center text-xl font-normal text-white/90"
                  style={{ lineHeight: 20 * 1.08 }}
                >
                  Thank you for your responses, continuing ahead
                </Text>
                <View className="flex-row items-center gap-2.5">
                  {[0, 150, 300].map((delay, i) => (
                    <Animated.View
                      key={i}
                      className="h-3 w-3 rounded-full bg-info/60"
                      style={{
                        animationName: DOT_BOUNCE,
                        animationDuration: '0.7s',
                        animationDelay: `${delay}ms`,
                        animationIterationCount: 'infinite',
                        animationTimingFunction: 'ease-in-out',
                      }}
                    />
                  ))}
                </View>
              </Animated.View>
            ) : (
              <Animated.View
                key={`step-${currentStep}`}
                entering={flipEntering(enterDelay)}
                exiting={FLIP_EXITING}
                className="flex-1 overflow-hidden"
                style={{ backfaceVisibility: 'hidden' }}
              >
                {/* Scrollable: question text + summary + continue button */}
                <ScrollView
                  ref={scrollContainerRef}
                  className="min-h-0 flex-1"
                  keyboardShouldPersistTaps="handled"
                >
                  <View className="items-center px-6 pb-5 pt-4">
                    <Text
                      accessibilityRole="header"
                      className="mx-auto w-full max-w-2xl text-center text-xl font-normal text-white/90"
                      style={{ lineHeight: 20 * 1.08 }}
                    >
                      {latestBotContent}
                    </Text>
                  </View>

                  {/* ── Previously answered summary ────────────────────────── */}
                  {resumeSummary && resumeSummary.length > 0 && (
                    <ResumeSummary items={resumeSummary} />
                  )}

                  {/* ── All answered — continue button ─────────────────────── */}
                  {allAnswered &&
                    typeof onContinueToPersonality === 'function' && (
                      <View
                        className="items-center px-4 pt-6"
                        style={{ paddingBottom: Math.max(32, insets.bottom) }}
                      >
                        <Button
                          className="h-12 rounded-full bg-info-strong px-8 text-white"
                          onPress={() => onContinueToPersonality()}
                          accessibilityLabel="Continue to personality analysis"
                        >
                          Continue to personality analysis
                        </Button>
                      </View>
                    )}
                </ScrollView>

                {/* Pinned bottom: MCQ or chat input — part of same flip unit */}
                <View className="shrink-0">
                  {/* MCQ grid for choice steps */}
                  {waitingForResponse &&
                    !allAnswered &&
                    currentStepData?.type === 'choice' && (
                      <View
                        className="gap-3 px-4"
                        style={{ paddingBottom: Math.max(32, insets.bottom) }}
                      >
                        <MCQGrid
                          options={currentStepData.options ?? []}
                          selected={
                            typeof selectedChoice === 'string'
                              ? selectedChoice
                              : undefined
                          }
                          onSelect={handleChoiceSelect}
                          stepKey={currentStep}
                        />
                        <View className="flex-row justify-end">
                          {!!selectedChoice && (
                            <Animated.View
                              key={String(selectedChoice)}
                              entering={SELECTED_PILL_ENTERING}
                              className="rounded-xl bg-info-strong/25 px-4 py-2"
                            >
                              <Text className="text-sm font-medium text-foreground">
                                {String(selectedChoice)}
                              </Text>
                            </Animated.View>
                          )}
                        </View>
                      </View>
                    )}

                  {/* Chat input bar for text steps */}
                  {waitingForResponse &&
                    !allAnswered &&
                    (currentStepData?.type === 'text' ||
                      currentStepData?.type === 'multi_text') && (
                      <>
                        {currentStepData.hint && (
                          <View className="mb-1 flex-row items-center gap-1.5 px-5">
                            <Sparkles size={12} color={hsl('info', 0.6)} />
                            <Text className="text-xs text-white/40">
                              {currentStepData.hint}
                            </Text>
                          </View>
                        )}
                        <ChatInputBar
                          inputRef={inputRef}
                          value={currentInput}
                          onChange={e => setCurrentInput(e.target.value)}
                          onSubmit={handleSubmit}
                          onVoiceTranscript={text =>
                            setCurrentInput(prev =>
                              prev ? `${prev} ${text}` : text,
                            )
                          }
                          disabled={!waitingForResponse}
                          placeholder={
                            currentStepData.placeholder ?? 'Type your response…'
                          }
                        />
                      </>
                    )}
                </View>
              </Animated.View>
            )}
          </KeyboardAvoider>
        </View>
      )}
    </View>
  );
}
