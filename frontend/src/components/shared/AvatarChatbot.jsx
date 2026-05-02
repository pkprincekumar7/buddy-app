import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Send, Volume2, VolumeX, Minimize2, Maximize2, Mic, MicOff } from 'lucide-react';
import { api } from '@/api/client';

export default function AvatarChatbot({ childName, childData, isParentMode = true, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [avatarState, setAvatarState] = useState('idle'); // idle, talking, thinking, listening
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const greeting = isParentMode
      ? `Hello! I'm here to help you understand ${childName}'s growth journey better. What would you like to know?`
      : `Hi ${childName}! 🌟 I'm your growth buddy! Want to chat about your day or try a fun activity?`;

    (async () => {
      try {
        if (await api.auth.isAuthenticated()) {
          const s = await api.userAppState.get();
          if (cancelled) return;
          if (typeof s.tts_enabled === 'boolean') {
            voiceEnabledRef.current = s.tts_enabled;
            setVoiceEnabled(s.tts_enabled);
          }
        }
      } catch { /* keep default */ }
      if (!cancelled) addBotMessage(greeting);
    })();

    // Initialize speech recognition
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = false;
        recognitionInstance.interimResults = false;
        recognitionInstance.lang = 'en-US';

        recognitionInstance.onstart = () => {
          setIsRecording(true);
          setAvatarState('listening');
        };

        recognitionInstance.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          setIsRecording(false);
          setAvatarState('idle');
        };

        recognitionInstance.onerror = () => {
          setIsRecording(false);
          setAvatarState('idle');
        };

        recognitionInstance.onend = () => {
          setIsRecording(false);
          setAvatarState('idle');
        };

        setRecognition(recognitionInstance);
      }
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speak = (text) => {
    if (!voiceEnabledRef.current || typeof window === 'undefined') return;
    
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[🌟💪😊🎉👋✨]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.name.includes('Samantha') || 
      v.name.includes('Google UK English Female') ||
      v.lang.includes('en')
    );
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.onstart = () => setAvatarState('talking');
    utterance.onend = () => setAvatarState('idle');
    
    window.speechSynthesis.speak(utterance);
  };

  const addBotMessage = (text) => {
    setMessages(prev => [...prev, { role: 'bot', content: text }]);
    speak(text);
  };

  const toggleRecording = () => {
    if (!recognition) {
      alert('Speech recognition is not supported in your browser');
      return;
    }

    if (isRecording) {
      recognition.stop();
    } else {
      recognition.start();
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsTyping(true);
    setAvatarState('thinking');

    // Use AI to generate contextual response
    const prompt = `You are a friendly, warm AI assistant for a family growth platform called Buddy360. 
You're chatting with ${isParentMode ? `a parent about their child ${childName}` : childName + ' directly'}.

Child's profile:
- Name: ${childName}
- Interests: ${childData?.interests?.join(', ') || 'various activities'}
- Strengths: ${childData?.strengths?.join(', ') || 'many great qualities'}
- Personality traits: ${childData?.personality_traits?.join(', ') || 'wonderful personality'}

User message: "${userMessage}"

Respond in a warm, encouraging way. Keep response under 3 sentences. ${isParentMode ? 'Give parenting insights when relevant.' : 'Be fun and engaging for a child.'}`;

    const response = await api.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          reply: { type: "string" }
        }
      }
    });

    setIsTyping(false);
    addBotMessage(response.reply);
  };

  if (isMinimized) {
    return (
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 shadow-lg flex items-center justify-center z-50"
      >
        <div className="relative">
          {/* Animated avatar face */}
          <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="text-2xl"
            >
              😊
            </motion.div>
          </div>
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center">
            1
          </span>
        </div>
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-50"
    >
      {/* Header with Avatar */}
      <div className="bg-gradient-to-r from-teal-500 to-emerald-500 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Animated Avatar */}
            <div className="relative">
              <motion.div 
                className="w-14 h-14 rounded-full bg-white overflow-hidden border-2 border-white/50"
                animate={avatarState === 'talking' ? { scale: [1, 1.05, 1] } : {}}
                transition={{ repeat: avatarState === 'talking' ? Infinity : 0, duration: 0.3 }}
              >
                {/* Realistic avatar placeholder - could be replaced with actual image */}
                <div className="w-full h-full bg-gradient-to-br from-amber-200 to-amber-300 flex items-center justify-center">
                  <div className="relative">
                    {/* Face */}
                    <div className="text-3xl">
                      {avatarState === 'thinking' ? '🤔' : avatarState === 'talking' ? '😊' : avatarState === 'listening' ? '👂' : '🙂'}
                    </div>
                  </div>
                </div>
              </motion.div>
              
              {/* Speaking/Listening indicator */}
              {avatarState === 'talking' && (
                <motion.div
                  className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full flex items-center justify-center"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 0.5 }}
                >
                  <Volume2 className="w-3 h-3 text-white" />
                </motion.div>
              )}
              {avatarState === 'listening' && (
                <motion.div
                  className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 0.5 }}
                >
                  <Mic className="w-3 h-3 text-white" />
                </motion.div>
              )}
            </div>
            
            <div>
              <h3 className="font-semibold text-white">Buddy360 Guide</h3>
              <p className="text-xs text-white/80">
                {avatarState === 'thinking' ? 'Thinking...' : avatarState === 'talking' ? 'Speaking...' : avatarState === 'listening' ? 'Listening...' : 'Online'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { voiceEnabledRef.current = !voiceEnabled; setVoiceEnabled(!voiceEnabled); }}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMinimized(true)}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="h-72 overflow-y-auto p-4 space-y-3 bg-slate-50">
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-teal-500 text-white rounded-br-md'
                  : 'bg-white text-slate-800 rounded-bl-md shadow-sm'
              }`}>
                <p className="text-sm">{msg.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="bg-white rounded-2xl rounded-bl-md px-4 py-2 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-200 bg-white">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <Button
            type="button"
            onClick={toggleRecording}
            size="icon"
            className={`h-10 w-10 rounded-xl ${isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-slate-200 hover:bg-slate-300'}`}
          >
            {isRecording ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-slate-600" />}
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRecording ? "Listening..." : "Type or speak..."}
            className="flex-1 h-10 rounded-xl border-slate-200"
            disabled={isRecording}
          />
          <Button type="submit" size="icon" className="h-10 w-10 rounded-xl bg-teal-500 hover:bg-teal-600">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </motion.div>
  );
}