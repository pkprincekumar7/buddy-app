import { useState, useEffect, useRef, useMemo } from 'react';
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

function buildReplayMessages(flow, data, resumeIdx) {
  const msgs = [];
  for (let i = 0; i < resumeIdx; i++) {
    const step = flow[i];
    if (step.type === 'auto') break;
    const acc = buildAccThrough(flow, data, i);
    const botText = typeof step.message === 'function' ? step.message(acc) : step.message;
    msgs.push({ role: 'bot', content: botText });
    const val = data[step.field];
    const userDisplay = Array.isArray(val) ? val.join(', ') : String(val ?? '');
    msgs.push({ role: 'user', content: userDisplay });
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
  const [showAnalyzing, setShowAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzingName, setAnalyzingName] = useState('');
  const [showingLoadingDots, setShowingLoadingDots] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const [allAnswered, setAllAnswered] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const idleTimerRef = useRef(null);
  const persistTimerRef = useRef(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);

  const persistQuestionnaireDraft = (mergedCollected) => {
    // Update parent state immediately so the wizard reflects the latest answers
    onQuestionnairePersisted?.(mergedCollected);

    // Debounce the API round-trip: GET + PATCH fires once after the user stops answering
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        const s = await api.onboarding.get();
        const prev = s.child_data && typeof s.child_data === 'object' ? { ...s.child_data } : {};
        await api.onboarding.patch({ child_data: { ...prev, ...mergedCollected } });
      } catch {
        /* ignore */
      }
    }, 500);
  };

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


  const speak = (text) => {
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
  };

  const addBotMessage = (text) => {
    setIsTyping(true);
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'bot', content: text }]);
      setIsTyping(false);
      speak(text);
      setWaitingForResponse(true);
    }, 800);
  };

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
          const replay = buildReplayMessages(conversationFlow, slim, autoIx);
          setCollectedData({ ...slim });
          setMessages(replay);
          setCurrentStep(autoIx);
          setWaitingForResponse(false);
          setShowingLoadingDots(false);
          setShowAnalyzing(false);
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
        const replay = buildReplayMessages(conversationFlow, slim, resumeIdx);
        setCollectedData({ ...slim });
        setMessages(replay);
        setCurrentStep(resumeIdx);

        const stepAt = conversationFlow[resumeIdx];
        if (stepAt.type === 'auto') {
          setWaitingForResponse(false);
          setShowingLoadingDots(false);
          setShowAnalyzing(false);
          setAllAnswered(true);
          return;
        }

        const accR = buildAccThrough(conversationFlow, slim, resumeIdx);
        const nextBot =
          typeof stepAt.message === 'function' ? stepAt.message(accR) : stepAt.message;
        addBotMessage(nextBot);
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
  }, [resumeHydrationReady, conversationFlow]);

  const persistVoiceToggle = async () => {
    const next = !voiceEnabled;
    voiceEnabledRef.current = next;
    setVoiceEnabled(next);
    if (!next && typeof window !== 'undefined') window.speechSynthesis?.cancel?.();
    try {
      await api.preferences.patch({ tts_enabled: next });
    } catch {
      /* keep optimistic toggle */
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
        { role: 'bot', content: "Just checking in 😊 — whenever you're ready, go ahead and share your answer!" }
      ]);
    }, 30000);

    return () => clearTimeout(idleTimerRef.current);
  }, [waitingForResponse, currentStep, showAnalyzing, showingLoadingDots, allAnswered]);

  const processResponse = (response) => {
    const step = conversationFlow[currentStep];

    setMessages(prev => [...prev, { role: 'user', content: response }]);
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
      setAnalyzingName(finalData.name || 'your child');
      setShowingLoadingDots(false);
      setShowAnalyzing(true);
      setAnalyzeProgress(0);

      // Animate progress over 5+ seconds then call onComplete
      let progress = 0;
      const interval = setInterval(() => {
        progress += 1;
        setAnalyzeProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          Promise.resolve(onComplete(finalData)).catch(() => {});
        }
      }, 55); // 55ms * 100 = 5.5 seconds
      return;
    }

    const nextStep = currentStep + 1;
    if (nextStep < conversationFlow.length) {
      setCurrentStep(nextStep);
      const nextMessage = typeof conversationFlow[nextStep].message === 'function'
        ? conversationFlow[nextStep].message(nextCollected)
        : conversationFlow[nextStep].message;

      setTimeout(() => addBotMessage(nextMessage), 500);

      if (conversationFlow[nextStep].type === 'final') {
        setTimeout(() => {
          onComplete(nextCollected);
        }, 2000);
      }
    }
  };

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!currentInput.trim() || !waitingForResponse) return;
    resetIdleTimer();
    processResponse(currentInput.trim());
    setCurrentInput('');
  };

  const handleChoiceSelect = (choice) => {
    if (!waitingForResponse) return;
    resetIdleTimer();
    processResponse(choice);
  };

  const handleReset = () => {
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
    setShowAnalyzing(false);
    setAnalyzeProgress(0);
    setShowingLoadingDots(false);
    setDotCount(0);
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
      } catch {
        /* ignore */
      }
    })();
    // Re-trigger the first message
    setTimeout(() => {
      const firstMessage = typeof conversationFlow[0].message === 'function'
        ? conversationFlow[0].message({})
        : conversationFlow[0].message;
      addBotMessage(firstMessage);
    }, 100);
  };

  const currentStepData = conversationFlow[currentStep];

  // Auto-proceed on 'auto' type steps after showing animated dots (live flow only — not when resuming with full questionnaire)
  useEffect(() => {
    if (!waitingForResponse || currentStepData?.type !== 'auto' || allAnswered) return;
      setShowingLoadingDots(true);
      setDotCount(0);

      let count = 0;
      const dotInterval = setInterval(() => {
        count += 1;
        setDotCount(count);
        if (count >= 12) {
          clearInterval(dotInterval);
          setShowingLoadingDots(false);
          setWaitingForResponse(false);
          // Directly trigger analyzing phase
          setCollectedData(prev => {
            const finalData = { ...prev };
            setAnalyzingName(finalData.name || 'your child');
            setShowAnalyzing(true);
            setAnalyzeProgress(0);
            let progress = 0;
            const interval = setInterval(() => {
              progress += 1;
              setAnalyzeProgress(progress);
              if (progress >= 100) {
                clearInterval(interval);
                Promise.resolve(onComplete(finalData)).catch(() => {});
              }
            }, 55);
            return prev;
          });
        }
      }, 200);

    return () => clearInterval(dotInterval);
  }, [waitingForResponse, currentStep, currentStepData?.type, allAnswered]);

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
      <div className="flex flex-col items-center justify-center h-[600px] max-h-[80vh] rounded-3xl border-2 border-teal-100 bg-gradient-to-br from-teal-50/40 via-white to-emerald-50/50 overflow-hidden px-6 sm:px-10 py-10 sm:py-12 space-y-8 shadow-xl shadow-teal-500/10">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-xl shadow-teal-500/25"
        >
          <Brain className="w-10 h-10 text-white" />
        </motion.div>

        <div className="text-center space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Analyzing {analyzingName}'s personality</h2>
          <p className="text-sm text-teal-800/80 font-medium">{currentLabel}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-md space-y-2">
          <div className="w-full bg-slate-200/80 rounded-full h-3 overflow-hidden border border-slate-100">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all duration-100 shadow-sm"
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
              <div key={i} className={`flex items-center gap-3 transition-opacity ${done || active ? 'opacity-100' : 'opacity-35'}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${done ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white' : active ? 'bg-teal-100 text-teal-700 ring-2 ring-teal-200' : 'bg-slate-100 text-slate-400'}`}>
                  <Icon className={`w-4 h-4 ${done ? 'text-white' : ''}`} />
                </div>
                <span className={`text-sm ${done ? 'text-emerald-800 font-medium line-through decoration-emerald-300' : active ? 'text-slate-800 font-semibold' : 'text-slate-400'}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px] max-h-[80vh] bg-white rounded-3xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-teal-500 to-emerald-500">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <span className="text-xl">🌱</span>
          </div>
          <div>
            <h3 className="font-semibold text-white">Buddy360 Guide</h3>
            <p className="text-xs text-white/80">Your growth companion</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={persistVoiceToggle}
          className="text-white hover:bg-white/20"
        >
          {voiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence>
          {messages.map((msg, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === 'user' 
                  ? 'bg-teal-500 text-white rounded-tr-md' 
                  : 'bg-slate-100 text-slate-800 rounded-tl-md'
              }`}>
                <p className="whitespace-pre-line">{msg.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-slate-100 rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {showingLoadingDots && !allAnswered && (
        <div className="px-4 pb-4 pt-2 border-t border-teal-100/60 bg-gradient-to-b from-white via-teal-50/30 to-emerald-50/20">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex justify-start"
          >
            <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl rounded-tl-md border-2 border-teal-100 bg-gradient-to-br from-teal-50/90 via-white to-emerald-50/60 px-4 py-4 shadow-lg shadow-teal-500/10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shrink-0 shadow-md shadow-teal-500/25">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="text-slate-800 font-semibold text-[15px] leading-snug">
                    Let's do a personality analysis{'.'.repeat(1 + (dotCount % 3))}
                  </p>
                  <p className="text-xs text-teal-700/85 mt-1.5 font-medium">
                    Getting things ready — almost there
                  </p>
                  <div className="flex gap-1.5 mt-3">
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {currentStepData.options.map((option, index) => {
              const chosen = collectedData[currentStepData.field];
              const isSelected = chosen === option;
              return (
              <motion.button
                key={option}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                type="button"
                onClick={() => handleChoiceSelect(option)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                  isSelected
                    ? 'border-teal-500 bg-teal-50 text-teal-900 ring-2 ring-teal-200 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-teal-500 hover:bg-teal-50'
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
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      )}

      {waitingForResponse && !allAnswered && (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-100">
          {currentStepData.hint && (
            <p className="text-xs text-slate-400 mb-2">{currentStepData.hint}</p>
          )}
          <div className="flex gap-2">
            <InputWithVoice
              ref={inputRef}
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              placeholder={currentStepData.placeholder || 'Type your response...'}
              className="flex-1 h-12 rounded-xl border-slate-200"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              className="h-12 px-3 rounded-xl border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-300"
              title="Reset conversation"
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button type="submit" className="h-12 px-4 rounded-xl bg-teal-500 hover:bg-teal-600">
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </form>
      )}

      {allAnswered && typeof onContinueToPersonality === 'function' && (
        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
          <Button
            type="button"
            className="w-full h-12 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-medium"
            onClick={() => onContinueToPersonality()}
          >
            Continue to personality analysis
          </Button>
        </div>
      )}
    </div>
  );
}