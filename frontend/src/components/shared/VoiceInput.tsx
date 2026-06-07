import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';

const NativeSpeechRecognition: typeof window.webkitSpeechRecognition | null =
  typeof window !== 'undefined' ? (window.webkitSpeechRecognition ?? null) : null;

// Check only that MediaRecorder exists (iOS 14.5+).
// Do NOT check navigator.mediaDevices here — on iOS it is undefined over HTTP
// (evaluated at module load) even though it works fine over HTTPS at runtime.
// The actual mediaDevices availability is checked inside startMediaRecorder.
const canMediaRecord = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined';

// Fix #5: prefer audio/mp4 first — Safari/iOS don't support audio/webm
function getBestMimeType(): string {
  const types = ['audio/mp4', 'audio/webm', 'audio/ogg'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function extFromMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  // iOS default codec is mp4/aac — safe fallback
  return 'mp4';
}

interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  isRecording: boolean;
  setIsRecording: (value: boolean) => void;
  'aria-label'?: string;
}

export default function VoiceInput({
  onTranscript,
  isRecording,
  setIsRecording,
  'aria-label': ariaLabel,
}: VoiceInputProps) {
  const recognitionRef = useRef<InstanceType<typeof window.webkitSpeechRecognition> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
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
    if (!NativeSpeechRecognition) return;
    const instance = new NativeSpeechRecognition();
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = 'en-US';

    instance.onstart = () => setIsRecording(true);
    instance.onresult = (event: Event) => {
      const e = event as SpeechRecognitionEvent;
      onTranscript(e.results[0]?.[0]?.transcript ?? '');
      setIsRecording(false);
    };
    // iOS 16+ Safari has webkitSpeechRecognition but can throw permission/network errors
    instance.onerror = (e: Event) => {
      const err = e as SpeechRecognitionErrorEvent;
      setIsRecording(false);
      if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
        toast.error('Microphone access was denied. Please allow mic access and try again.');
      } else if (err.error === 'network') {
        toast.error('Speech recognition needs a network connection. Please try again.');
      } else {
        toast.error('Speech recognition failed. Please try again.');
      }
    };
    instance.onend = () => setIsRecording(false);

    recognitionRef.current = instance;
    try {
      instance.start();
    } catch {
      setIsRecording(false);
      toast.error('Could not start voice input. Please try again.');
    }
  };

  const startMediaRecorder = async () => {
    // On iOS, navigator.mediaDevices is only exposed over HTTPS.
    // Catch this at runtime with a clear message instead of hiding the button.
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone is not available. Please make sure the page is loaded over HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getBestMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        // iOS Safari often reports recorder.mimeType as '' even when recording mp4.
        // Fall back to the mimeType we requested, then 'audio/mp4' as the iOS default.
        const resolvedMime = recorder.mimeType || mimeType || 'audio/mp4';
        const blob = new Blob(chunksRef.current, { type: resolvedMime });
        const ext = extFromMimeType(resolvedMime);
        setIsRecording(false);
        setIsTranscribing(true);
        try {
          const result = (await api.audio.transcribe(blob, `recording.${ext}`)) as {
            transcript?: string;
          };
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
      // Use a 100ms timeslice — required on iOS Safari to reliably fire ondataavailable
      recorder.start(100);
      setIsRecording(true);
    } catch (err) {
      // Fix #1: inform the user when mic access is denied or unavailable
      const isDenied =
        err instanceof Error &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      toast.error(
        isDenied
          ? 'Microphone access was denied. Please allow mic access and try again.'
          : 'Could not start recording. Please check your microphone.',
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
      mediaRecorderRef.current?.stop();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      void (useNative ? stopNative() : stopMediaRecorder());
    } else {
      void (useNative ? startNative() : startMediaRecorder());
    }
  };

  if (!isAvailable) return null;

  const defaultLabel = isTranscribing
    ? 'Transcribing…'
    : isRecording
      ? 'Stop recording'
      : 'Start voice input';

  return (
    <Button
      type="button"
      onClick={toggleRecording}
      disabled={isTranscribing}
      size="icon"
      aria-label={ariaLabel ?? defaultLabel}
      className={`h-10 w-10 flex-shrink-0 rounded-xl ${
        isRecording
          ? 'bg-error-medium hover:bg-error-strong'
          : isTranscribing
            ? 'cursor-wait bg-warning'
            : 'bg-ghost-strong hover:bg-ghost-hover'
      }`}
    >
      {isTranscribing ? (
        <Loader2 className="h-4 w-4 animate-spin text-white" />
      ) : isRecording ? (
        <MicOff className="h-4 w-4 text-white" />
      ) : (
        <Mic className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}
