import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import InputWithVoice from '../shared/InputWithVoice';
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Send, Brain, Sparkles, Star, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import {
  CHATBOT_CAPTURED_FIELDS,
  questionnaireFieldHasValue,
  pickSavedQuestionnaireForChatbot,
  normalizeOnboardingChildDataBlob,
} from '@/lib/onboardingChildData';
import { pickPreferredVoice } from '@/lib/tts';

function buildAccThrough(flow, data, beforeStepIdx) {
  const acc = {};
  for (let j = 0; j < beforeStepIdx; j++) {
    const st = flow[j];
    if (st.type === 'auto') break;
    acc[st.field] = data[st.field];
  }
  return acc;
}

function buildReplayMessages(flow, data, resumeIdx, newMsgId) {
  const msgs = [];
  for (let i = 0; i < resumeIdx; i++) {
    const step = flow[i];
    if (step.type === 'auto') break;
    const acc = buildAccThrough(flow, data, i);
    const botText = typeof step.message === 'function' ? step.message(acc) : step.message;
    msgs.push({ id: newMsgId(), role: 'bot', content: botText });
    const val = data[step.field];
    const userDisplay = Array.isArray(val) ? val.join(', ') : String(val ?? '');
    msgs.push({ id: newMsgId(), role: 'user', content: userDisplay });
  }
  return msgs;
}

function findResumeStepIndex(flow, data) {
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (step.type === 'auto') return i;
    if (!questionnaireFieldHasValue(step.field, data)) return i;
  }
  const autoIx = flow.findIndex((s) => s.type === 'auto');
  return autoIx >= 0 ? autoIx : flow.length - 1;
}

const ANALYZING_INITIAL = { show: false, progress: 0, name: '', showingDots: false, dotCount: 0 };

export default function ConversationalOnboarding({
  user,
  onComplete,
  resumeHydrationReady = true,
  onContinueToPersonality,
  onQuestionnairePersisted,
  onQuestionnaireCleared,
}) {
  const [messages, setMessages] = useState([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [collectedData, setCollectedData] = useState({});
  const [isTyping, setIsTyping] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  // Five tightly-coupled analyzing-phase states kept in one object to avoid split-state bugs.
  const [analyzingState, setAnalyzingState] = useState(ANALYZING_INITIAL);
  const { show: showAnalyzing, progress: analyzeProgress, name: analyzingName, showingDots: showingLoadingDots, dotCount } = analyzingState;
  const [allAnswered, setAllAnswered] = useState(false);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const idleTimerRef = useRef(null);
  const persistTimerRef = useRef(null);
  const botMsgTimerRef = useRef(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);
  // Stable ref to current collectedData — lets effects read the latest value without listing
  // collectedData as a dependency, avoiding unnecessary effect re-runs.
  const collectedDataRef = useRef({});
  // Counter in a ref so the ID generator is stable and never shared across instances.
  const msgIdCounterRef = useRef(0);
  const newMsgId = useCallback(() => `${Date.now()}-${++msgIdCounterRef.current}`, []);

  useEffect(() => { collectedDataRef.current = collectedData; }, [collectedData]);

  const persistQuestionnaireDraft = useCallback((mergedCollected) => {
    onQuestionnairePersisted?.(mergedCollected);
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        const s = await api.onboarding.get();
        const prev = s.child_data && typeof s.child_data === 'object' ? { ...s.child_data } : {};
        await api.onboarding.patch({ child_data: { ...prev, ...mergedCollected } });
      } catch (err) {
        console.warn('[ConversationalOnboarding] Auto-persist child data failed:', err);
      }
    }, 500);
  }, [onQuestionnairePersisted]);

  const parentName = user?.full_name?.split(' ')[0] || 'there';

  const conversationFlow = useMemo(
    () => [
    {
      id: 'greeting',
      message: `Hey ${parentName}! Hope your day is going well.\nLet's start.\nWhat is your child's name?`,
      field: 'name',
      type: 'text',
      phase: 1
    },
    {
      id: 'age',
      message: (data) => `Wonderful! And how old is ${data.name}?`,
      field: 'age',
      type: 'text',
      placeholder: 'e.g., 10 years',
      phase: 1
    },
    {
      id: 'school',
      message: (data) => `Great! Which school does ${data.name} go to?`,
      field: 'school',
      type: 'text',
      phase: 1
    },
    {
      id: 'ready_check',
      message: (data) => `Fantastic, Let's start exploring ${data.name}'s best version for life right away.\nMention the top 3 strengths that ${data.name} has from your perspective.`,
      field: 'strengths',
      type: 'multi_text',
      placeholder: 'e.g., Intelligent, Energetic, Well-mannered',
      hint: 'Separate with commas',
      phase: 1
    },
    {
      id: 'strengths_response',
      message: (data) => `Happy to know that! You are a lucky parent 😊.\n\nMention the top 3 hobbies where ${data.name} spends their time.`,
      field: 'hobbies',
      type: 'multi_text',
      placeholder: 'e.g., Cricket, Drawing, Reading',
      phase: 1
    },
    {
      id: 'thinking_pattern',
      message: (data) => `Choose the kind of thinking pattern that ${data.name} predominantly has:`,
      field: 'thinking_pattern',
      type: 'choice',
      options: ['Visual', 'Analytical', 'Imaginative', 'Not sure'],
      phase: 1
    },
    {
      id: 'communication_style',
      message: (data) => `Choose the kind of communication style that ${data.name} predominantly has:`,
      field: 'communication_style',
      type: 'choice',
      options: ['Talkative', 'Deep Listener', 'Communicates through gestures', 'Silent', 'Observant', 'Not Sure'],
      phase: 1
    },
    {
      id: 'energy_level',
      message: (data) => `How would you describe ${data.name}'s energy level?`,
      field: 'energy_level',
      type: 'choice',
      options: ['High energy - always active', 'Moderate - balanced', 'Calm and composed', 'Variable - depends on interest'],
      phase: 1
    },
    {
      id: 'social_behaviour',
      message: (data) => `How does ${data.name} behave in social situations?`,
      field: 'social_behaviour',
      type: 'choice',
      options: ['Confident','Friendly','Reserved','Expressive','Withdrawn'],
      phase: 1
    },
    {
      id: 'emotional_behaviour',
      message: (data) => `What kind of a child ${data.name} emotionally is?`,
      field: 'emotional_behaviour',
      type: 'choice',
      options: ['Calm','Sensitive','Reserved','Impulsive','Moody'],
      phase: 1
    },
    {
      id: 'complete',
      message: () => '',
      field: 'start_analysis',
      type: 'auto',
      phase: 1
    },
    ],
    [parentName],
  );


  // All deps are refs or module-level globals — stable across renders.
  const speak = useCallback((text) => {
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

  const addBotMessage = useCallback((text) => {
    setIsTyping(true);
    clearTimeout(botMsgTimerRef.current);
    botMsgTimerRef.current = setTimeout(() => {
      setMessages(prev => [...prev, { id: newMsgId(), role: 'bot', content: text }]);
      setIsTyping(false);
      speak(text);
      setWaitingForResponse(true);
    }, 1600);
  }, [speak, newMsgId]);

  useEffect(() => {
    return () => clearTimeout(botMsgTimerRef.current);
  }, []);

  useEffect(() => {
    if (!resumeHydrationReady) return;

    let cancelled = false;

    (async () => {
      try {
        let slim = {};
        const [onboarding, prefs] = await Promise.all([api.onboarding.get(), api.preferences.get()]);
        slim = pickSavedQuestionnaireForChatbot(
          normalizeOnboardingChildDataBlob(onboarding.child_data) || {}
        );
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
          autoIx >= 0 &&
          CHATBOT_CAPTURED_FIELDS.every((f) => questionnaireFieldHasValue(f, slim));

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
          const firstMessage =
            typeof conversationFlow[0].message === 'function'
              ? conversationFlow[0].message({})
              : conversationFlow[0].message;
          addBotMessage(firstMessage);
          return;
        }

        const resumeIdx = findResumeStepIndex(conversationFlow, slim);
        const replay = buildReplayMessages(conversationFlow, slim, resumeIdx, newMsgId);
        setCollectedData({ ...slim });
        setMessages(replay);
        setCurrentStep(resumeIdx);

        const stepAt = conversationFlow[resumeIdx];
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

    return () => { cancelled = true; };
  }, [resumeHydrationReady, conversationFlow, addBotMessage, newMsgId]);

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
      const duration = 1400;
      const startTime = performance.now();
      const easeInOutCubic = (t) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const step = (now) => {
        const progress = Math.min((now - startTime) / duration, 1);
        container.scrollTop = start + (end - start) * easeInOutCubic(progress);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 200);
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
    const text = Array.isArray(raw) ? raw.join(', ') : String(raw);
    setCurrentInput(text);
  }, [waitingForResponse, currentStep, collectedData, conversationFlow, allAnswered]);

  // Idle reminder — fires after 30s of no input when waiting for a response
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!waitingForResponse || showAnalyzing || showingLoadingDots || allAnswered) return;

    idleTimerRef.current = setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { id: newMsgId(), role: 'bot', content: "Just checking in 😊 — whenever you're ready, go ahead and share your answer!" }
      ]);
    }, 30000);

    return () => clearTimeout(idleTimerRef.current);
  }, [waitingForResponse, currentStep, showAnalyzing, showingLoadingDots, allAnswered, newMsgId]);

  const processResponse = useCallback((response) => {
    const step = conversationFlow[currentStep];

    setMessages(prev => [...prev, { id: newMsgId(), role: 'user', content: response }]);
    userTurnCountRef.current += 1;
    setWaitingForResponse(false);

    if (response === 'Maybe later' || response === 'Catch up later') {
      addBotMessage(`No problem! Take your time. Your progress is saved and you can continue whenever you're ready. See you soon! 👋`);
      return;
    }

    let nextCollected = collectedData;
    if (step.field) {
      let value = response;
      if (step.type === 'multi_text') {
        value = response.split(',').map(s => s.trim()).filter(Boolean);
      }
      nextCollected = { ...collectedData, [step.field]: value };
      setCollectedData(nextCollected);
      persistQuestionnaireDraft(nextCollected);
    }

    // Auto-trigger on the final step
    if (step.id === 'complete') {
      const finalData = nextCollected;
      setAnalyzingState({ show: true, progress: 0, name: finalData.name || 'your child', showingDots: false, dotCount: 0 });

      let progress = 0;
      const interval = setInterval(() => {
        progress += 1;
        setAnalyzingState(s => ({ ...s, progress }));
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
      const nextMessage = typeof conversationFlow[nextStep].message === 'function'
        ? conversationFlow[nextStep].message(nextCollected)
        : conversationFlow[nextStep].message;

      setTimeout(() => addBotMessage(nextMessage), 700);

      if (conversationFlow[nextStep].type === 'final') {
        setTimeout(() => {
          onComplete(nextCollected);
        }, 2000);
      }
    }
  }, [conversationFlow, currentStep, collectedData, addBotMessage, persistQuestionnaireDraft, onComplete, newMsgId]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  }, []);

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    if (!currentInput.trim() || !waitingForResponse) return;
    resetIdleTimer();
    processResponse(currentInput.trim());
    setCurrentInput('');
  }, [currentInput, waitingForResponse, resetIdleTimer, processResponse]);

  const handleChoiceSelect = useCallback((choice) => {
    if (!waitingForResponse) return;
    resetIdleTimer();
    processResponse(choice);
  }, [waitingForResponse, resetIdleTimer, processResponse]);

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
        const s = await api.onboarding.get();
        const prev = s.child_data && typeof s.child_data === 'object' ? { ...s.child_data } : {};
        for (const k of CHATBOT_CAPTURED_FIELDS) delete prev[k];
        await api.onboarding.patch({
          child_data: Object.keys(prev).length ? prev : {},
        });
        onQuestionnaireCleared?.();
      } catch (err) {
        console.warn('[ConversationalOnboarding] Questionnaire clear failed:', err);
      }
    })();
    // Re-trigger the first message
    setTimeout(() => {
      const firstMessage = typeof conversationFlow[0].message === 'function'
        ? conversationFlow[0].message({})
        : conversationFlow[0].message;
      addBotMessage(firstMessage);
    }, 100);
  }, [conversationFlow, addBotMessage, onQuestionnaireCleared]);

  const currentStepData = conversationFlow[currentStep];

  // Auto-proceed on 'auto' type steps after showing animated dots (live flow only — not when resuming with full questionnaire).
  // Uses collectedDataRef to read the latest collected data without adding it as a dependency.
  useEffect(() => {
    if (!waitingForResponse || currentStepData?.type !== 'auto' || allAnswered) return;
    setAnalyzingState(s => ({ ...s, showingDots: true, dotCount: 0 }));

    let progressInterval = null;
    let count = 0;
    const dotInterval = setInterval(() => {
      count += 1;
      setAnalyzingState(s => ({ ...s, dotCount: count }));
      if (count >= 12) {
        clearInterval(dotInterval);
        const finalData = { ...collectedDataRef.current };
        setAnalyzingState({ show: true, progress: 0, name: finalData.name || 'your child', showingDots: false, dotCount: 0 });
        let progress = 0;
        progressInterval = setInterval(() => {
          progress += 1;
          setAnalyzingState(s => ({ ...s, progress }));
          if (progress >= 100) {
            clearInterval(progressInterval);
            Promise.resolve(onComplete(finalData)).catch(() => {});
          }
        }, 55);
      }
    }, 200);

    return () => {
      clearInterval(dotInterval);
      if (progressInterval) clearInterval(progressInterval);
    };
  }, [waitingForResponse, currentStep, currentStepData?.type, allAnswered, onComplete]);

  if (showAnalyzing) {
    const steps = [
      { label: 'Reading personality traits...', icon: Brain, threshold: 25 },
      { label: 'Mapping strengths & interests...', icon: Star, threshold: 55 },
      { label: 'Building growth profile...', icon: Sparkles, threshold: 80 },
      { label: 'Finalizing personalized journey...', icon: Sparkles, threshold: 100 },
    ];
    const activeStep = steps.findIndex(s => analyzeProgress < s.threshold);
    const currentLabel = steps[activeStep >= 0 ? activeStep : steps.length - 1].label;

    return (
      <div className="flex flex-col items-center justify-center h-[600px] max-h-[80vh] rounded-2xl border-edge bg-card overflow-hidden px-6 sm:px-10 py-10 sm:py-12 space-y-8">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal"
        >
          <Brain className="w-8 h-8 text-white" />
        </motion.div>

        <div className="text-center space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white">Analyzing {analyzingName}'s personality</h2>
          <p className="text-sm text-teal-400 font-medium">{currentLabel}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-md space-y-2">
          <div className="w-full bg-ghost-light rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-teal-300 transition-all duration-100"
              style={{ width: `${analyzeProgress}%` }}
            />
          </div>
          <p className="text-right text-xs text-slate-500 font-medium">{analyzeProgress}%</p>
        </div>

        {/* Step indicators */}
        <div className="w-full max-w-md space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const done = analyzeProgress >= s.threshold;
            const active = !done && (i === 0 || analyzeProgress >= steps[i - 1]?.threshold);
            return (
              <div key={s.label} className={`flex items-center gap-3 transition-opacity duration-500 ${done || active ? 'opacity-100' : 'opacity-30'}`}>
                <div className={cn(
                  'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500',
                  done  && 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
                  active && 'bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/30',
                  !done && !active && 'bg-subtle text-slate-500',
                )}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="relative">
                  <span className={`text-sm transition-colors duration-500 ${done ? 'text-emerald-400 font-medium' : active ? 'text-white font-semibold' : 'text-slate-500'}`}>
                    {s.label}
                  </span>
                  <AnimatePresence>
                    {done && (
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 1.4, ease: 'easeInOut' }}
                        style={{ originX: 0 }}
                        className="absolute left-0 right-0 top-[50%] h-px bg-emerald-500"
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
    <div className="flex flex-col h-[600px] max-h-[80vh] bg-card rounded-2xl border-edge overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b-edge-faint bg-surface-elevated">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-500/20 flex items-center justify-center">
            <span className="text-lg">🌱</span>
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">Buddy360 Guide</h3>
            <p className="text-xs text-slate-500">Your growth companion</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={persistVoiceToggle}
          className="text-slate-400 hover:text-white hover:bg-ghost-light"
        >
          {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) =>
            msg.role === 'bot' ? (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  opacity: { duration: 2.0, ease: [0.0, 0.0, 0.6, 1] },
                  y:       { duration: 1.6, ease: 'easeOut' },
                }}
                className="flex justify-start"
              >
                <div className={cn(
                  'max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm',
                  'bg-surface-input text-slate-300 border-edge-faint',
                )}>
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
                  x:       { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
                }}
                className="flex justify-end"
              >
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-teal-500 text-white rounded-tr-sm">
                  <p className="whitespace-pre-line">{msg.content}</p>
                </div>
              </motion.div>
            )
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
              <div className="bg-surface-input rounded-2xl rounded-tl-sm px-4 py-3 border-edge-faint">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {showingLoadingDots && !allAnswered && (
        <div className="px-4 pb-4 pt-2 border-t-edge-faint">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.375 }}
            className="flex justify-start"
          >
            <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl rounded-tl-sm border border-teal-500/20 bg-teal-500/[0.05] px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shrink-0 glow-teal-sm">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="text-white font-semibold text-sm leading-snug">
                    Let's do a personality analysis{'.'.repeat(1 + (dotCount % 3))}
                  </p>
                  <p className="text-xs text-teal-400 mt-1.5">
                    Getting things ready — almost there
                  </p>
                  <div className="flex gap-1.5 mt-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
        <div className="px-4 pb-4 border-t-edge-faint pt-3">
          <div className="flex flex-wrap gap-2">
            {currentStepData.options.map((option, index) => {
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
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  isSelected
                    ? 'border-teal-500 bg-teal-500/15 text-teal-300'
                    : 'bg-ghost-md border-c-md text-slate-400 hover:border-teal-500/50 hover:bg-teal-500/10 hover:text-teal-300'
                }`}
              >
                {option}
              </motion.button>
              );
            })}
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={handleReset}
              title="Reset conversation"
              className="flex items-center gap-1 text-xs text-slate-600 hover:text-red-400 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>
      )}

      {waitingForResponse && !allAnswered && (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
        <form onSubmit={handleSubmit} className="p-4 border-t-edge-faint">
          {currentStepData.hint && (
            <p className="text-xs text-slate-500 mb-2">{currentStepData.hint}</p>
          )}
          <div className="flex gap-2">
            <InputWithVoice
              ref={inputRef}
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              placeholder={currentStepData.placeholder || 'Type your response...'}
              className="flex-1 h-btn-md rounded-xl bg-surface-input border-edge-md text-white placeholder:text-slate-600 focus:border-teal-500/50"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              className="h-btn-md px-3 rounded-xl border-edge-md bg-transparent text-slate-500 hover:text-red-400 hover:border-red-500/30"
              title="Reset conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button type="submit" className="h-btn-md px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-primary-foreground">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      )}

      {allAnswered && typeof onContinueToPersonality === 'function' && (
        <div className="p-4 border-t-edge-faint shrink-0">
          <Button
            type="button"
            className="w-full h-btn-md rounded-2xl btn-primary"
            onClick={() => onContinueToPersonality()}
          >
            Continue to personality analysis
          </Button>
        </div>
      )}
    </div>
  );
}

ConversationalOnboarding.propTypes = {
  user: PropTypes.shape({
    full_name: PropTypes.string,
  }),
  onComplete: PropTypes.func.isRequired,
  resumeHydrationReady: PropTypes.bool,
  onContinueToPersonality: PropTypes.func,
  onQuestionnairePersisted: PropTypes.func,
  onQuestionnaireCleared: PropTypes.func,
};
