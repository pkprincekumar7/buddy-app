import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import InputWithVoice from '../shared/InputWithVoice';
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Send, Brain, Sparkles, Star, RotateCcw } from 'lucide-react';

const VOICE_ENABLED = true;

export default function ConversationalOnboarding({ user, onComplete }) {
  const [messages, setMessages] = useState([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [collectedData, setCollectedData] = useState({});
  const [isTyping, setIsTyping] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(VOICE_ENABLED);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [showAnalyzing, setShowAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzingName, setAnalyzingName] = useState('');
  const [showingLoadingDots, setShowingLoadingDots] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const idleTimerRef = useRef(null);

  const parentName = user?.full_name?.split(' ')[0] || 'there';

  const conversationFlow = [
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
    }
  ];

  const speak = (text) => {
    if (!voiceEnabled || typeof window === 'undefined') return;
    
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[👋🎉💪😊🌟🚀]/g, '').replace(/\n/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1;
    
    const voices = window.speechSynthesis.getVoices();
    // Prioritize premium female voices
    const preferredVoice = voices.find(v => 
      v.name.includes('Google US English Female') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Samantha') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira') ||
      v.name.includes('Fiona') ||
      v.name.includes('Serena') ||
      (v.name.includes('Microsoft') && v.name.includes('Zira')) ||
      (v.name.includes('Microsoft') && v.name.includes('Eva'))
    ) || voices.find(v => 
      v.lang.startsWith('en') && !v.localService
    ) || voices.find(v => 
      v.lang.startsWith('en')
    );
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      console.log('Using voice:', preferredVoice.name);
    }
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
    if (currentStep === 0 && messages.length === 0) {
      const firstMessage = typeof conversationFlow[0].message === 'function' 
        ? conversationFlow[0].message(collectedData)
        : conversationFlow[0].message;
      addBotMessage(firstMessage);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (waitingForResponse && inputRef.current) {
      inputRef.current.focus();
    }
  }, [waitingForResponse]);

  // Idle reminder — fires after 30s of no input when waiting for a response
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!waitingForResponse || showAnalyzing || showingLoadingDots) return;

    idleTimerRef.current = setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { role: 'bot', content: "Just checking in 😊 — whenever you're ready, go ahead and share your answer!" }
      ]);
    }, 30000);

    return () => clearTimeout(idleTimerRef.current);
  }, [waitingForResponse, currentStep, showAnalyzing, showingLoadingDots]);

  const processResponse = (response) => {
    const step = conversationFlow[currentStep];
    
    if (step.field) {
      let value = response;
      if (step.type === 'multi_text') {
        value = response.split(',').map(s => s.trim()).filter(Boolean);
      }
      setCollectedData(prev => ({ ...prev, [step.field]: value }));
    }

    setMessages(prev => [...prev, { role: 'user', content: response }]);
    setWaitingForResponse(false);

    // Handle exit points
    if (response === 'Maybe later' || response === 'Catch up later') {
      addBotMessage(`No problem! Take your time. Your progress is saved and you can continue whenever you're ready. See you soon! 👋`);
      return;
    }

    // Auto-trigger on the final step
    if (step.id === 'complete') {
      const finalData = { ...collectedData, [step.field]: response };
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
          onComplete(finalData);
        }
      }, 55); // 55ms * 100 = 5.5 seconds
      return;
    }

    const nextStep = currentStep + 1;
    if (nextStep < conversationFlow.length) {
      setCurrentStep(nextStep);
      const nextMessage = typeof conversationFlow[nextStep].message === 'function'
        ? conversationFlow[nextStep].message({ ...collectedData, [step.field]: response })
        : conversationFlow[nextStep].message;
      
      setTimeout(() => addBotMessage(nextMessage), 500);

      if (conversationFlow[nextStep].type === 'final') {
        setTimeout(() => {
          onComplete({ ...collectedData, [step.field]: response });
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
    // Re-trigger the first message
    setTimeout(() => {
      const firstMessage = typeof conversationFlow[0].message === 'function'
        ? conversationFlow[0].message({})
        : conversationFlow[0].message;
      addBotMessage(firstMessage);
    }, 100);
  };

  const currentStepData = conversationFlow[currentStep];

  // Auto-proceed on 'auto' type steps after showing animated dots
  useEffect(() => {
    if (waitingForResponse && currentStepData?.type === 'auto') {
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
                onComplete(finalData);
              }
            }, 55);
            return prev;
          });
        }
      }, 200);

      return () => clearInterval(dotInterval);
    }
  }, [waitingForResponse, currentStep]);

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
      <div className="flex flex-col items-center justify-center h-[600px] max-h-[80vh] bg-white rounded-3xl border border-slate-200 overflow-hidden px-8 py-12 space-y-8">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg"
        >
          <Brain className="w-10 h-10 text-white" />
        </motion.div>

        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-slate-800">Analyzing {analyzingName}'s Personality</h2>
          <p className="text-sm text-slate-500">{currentLabel}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full space-y-2">
          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
            <div
              className="h-4 rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all duration-100"
              style={{ width: `${analyzeProgress}%` }}
            />
          </div>
          <p className="text-right text-xs text-slate-500 font-medium">{analyzeProgress}%</p>
        </div>

        {/* Step indicators */}
        <div className="w-full space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const done = analyzeProgress >= s.threshold;
            const active = !done && (i === 0 || analyzeProgress >= steps[i - 1]?.threshold);
            return (
              <div key={i} className={`flex items-center gap-3 transition-opacity ${done || active ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-emerald-500' : active ? 'bg-teal-100' : 'bg-slate-100'}`}>
                  <Icon className={`w-4 h-4 ${done ? 'text-white' : active ? 'text-teal-600' : 'text-slate-400'}`} />
                </div>
                <span className={`text-sm ${done ? 'text-emerald-700 font-medium line-through' : active ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
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
          onClick={() => setVoiceEnabled(!voiceEnabled)}
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
      {showingLoadingDots && (
        <div className="px-4 pb-2">
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl rounded-tl-md px-4 py-3">
              <p className="text-slate-600 font-medium">
                Let's do a personality analysis{'.'.repeat(dotCount)}
              </p>
            </div>
          </div>
        </div>
      )}

      {waitingForResponse && currentStepData?.type === 'choice' && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {currentStepData.options.map((option, index) => (
              <motion.button
                key={option}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => handleChoiceSelect(option)}
                className="px-4 py-2 bg-white border-2 border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:border-teal-500 hover:bg-teal-50 transition-all"
              >
                {option}
              </motion.button>
            ))}
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

      {waitingForResponse && (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
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
    </div>
  );
}