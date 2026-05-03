import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';

const NativeSpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

// Fix #3: also check MediaRecorder exists (absent on iOS < 14.3)
const canMediaRecord =
  typeof window !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== 'undefined';

// Fix #5: prefer audio/mp4 first — Safari/iOS don't support audio/webm
function getBestMimeType() {
  const types = ['audio/mp4', 'audio/webm', 'audio/ogg'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function extFromMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export default function VoiceInputButton({ onTranscript, isRecording, setIsRecording }) {
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const useNative = !!NativeSpeechRecognition;
  const isAvailable = useNative || canMediaRecord;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
    };
  }, []);

  const startNative = () => {
    const instance = new NativeSpeechRecognition();
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = 'en-US';

    instance.onstart = () => setIsRecording(true);
    instance.onresult = (event) => {
      onTranscript(event.results[0][0].transcript);
      setIsRecording(false);
    };
    instance.onerror = () => setIsRecording(false);
    instance.onend = () => setIsRecording(false);

    recognitionRef.current = instance;
    try {
      instance.start();
    } catch {
      setIsRecording(false);
    }
  };

  const startMediaRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getBestMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const resolvedMime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: resolvedMime });
        const ext = extFromMimeType(resolvedMime);
        setIsRecording(false);
        setIsTranscribing(true);
        try {
          const result = await api.audio.transcribe(blob, `recording.${ext}`);
          if (result?.transcript) onTranscript(result.transcript);
        } catch (err) {
          // Fix #2: inform the user when Whisper transcription fails
          console.warn('Transcription failed:', err);
          toast.error('Transcription failed. Please try again.');
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      // Fix #1: inform the user when mic access is denied or unavailable
      const isDenied =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      toast.error(
        isDenied
          ? 'Microphone access was denied. Please allow mic access and try again.'
          : 'Could not start recording. Please check your microphone.'
      );
      setIsRecording(false);
    }
  };

  const stopNative = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  };

  const stopMediaRecorder = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      useNative ? stopNative() : stopMediaRecorder();
    } else {
      useNative ? startNative() : startMediaRecorder();
    }
  };

  if (!isAvailable) return null;

  return (
    <Button
      type="button"
      onClick={toggleRecording}
      disabled={isTranscribing}
      size="icon"
      className={`h-10 w-10 rounded-xl flex-shrink-0 ${
        isRecording
          ? 'bg-red-500 hover:bg-red-600 animate-pulse'
          : isTranscribing
          ? 'bg-amber-400 cursor-wait'
          : 'bg-slate-200 hover:bg-slate-300'
      }`}
    >
      {isTranscribing ? (
        <Loader2 className="w-4 h-4 text-white animate-spin" />
      ) : isRecording ? (
        <MicOff className="w-4 h-4 text-white" />
      ) : (
        <Mic className="w-4 h-4 text-slate-600" />
      )}
    </Button>
  );
}
