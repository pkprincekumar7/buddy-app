import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from 'lucide-react';

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export default function VoiceInputButton({ onTranscript, isRecording, setIsRecording }) {
  const recognitionRef = useRef(null);
  const isSupported = !!SpeechRecognition;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const startRecognition = () => {
    // Always create a fresh instance — required on mobile browsers
    const instance = new SpeechRecognition();
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = 'en-US';

    instance.onstart = () => setIsRecording(true);

    instance.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      onTranscript(transcript);
      setIsRecording(false);
    };

    instance.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      setIsRecording(false);
    };

    instance.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = instance;

    try {
      instance.start();
    } catch (err) {
      console.warn('Could not start recognition:', err);
      setIsRecording(false);
    }
  };

  const stopRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (!isSupported) {
      alert('Voice input is not supported in your browser. Please type your response.');
      return;
    }

    if (isRecording) {
      stopRecognition();
    } else {
      startRecognition();
    }
  };

  if (!isSupported) return null;

  return (
    <Button
      type="button"
      onClick={toggleRecording}
      size="icon"
      className={`h-10 w-10 rounded-xl flex-shrink-0 ${
        isRecording
          ? 'bg-red-500 hover:bg-red-600 animate-pulse'
          : 'bg-slate-200 hover:bg-slate-300'
      }`}
    >
      {isRecording ? (
        <MicOff className="w-4 h-4 text-white" />
      ) : (
        <Mic className="w-4 h-4 text-slate-600" />
      )}
    </Button>
  );
}