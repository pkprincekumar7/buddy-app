import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { toast } from '@/lib/toast';

// expo-speech-recognition's events are global: every mounted listener hears
// every session. Only the instance that started the current session reacts,
// so two voice inputs on one screen never both receive a transcript.
let activeOwner: string | null = null;

interface Options {
  onTranscript: (transcript: string) => void;
  onPartialTranscript?: (transcript: string) => void;
  /** Controlled recording state (web VoiceInput's isRecording/setIsRecording pair). */
  isRecording?: boolean;
  setIsRecording?: (value: boolean) => void;
}

/**
 * On-device speech-to-text — the native equivalent of the web VoiceInput's
 * webkitSpeechRecognition path (the web's MediaRecorder + /speech/transcriptions
 * fallback isn't needed: iOS and Android both ship a recognizer).
 */
export function useVoiceRecognition({
  onTranscript,
  onPartialTranscript,
  isRecording: controlled,
  setIsRecording: setControlled,
}: Options) {
  const id = useId();
  const [localRecording, setLocalRecording] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const isRecording = controlled ?? localRecording;
  const mountedRef = useRef(true);
  // From start() until the native 'start' (or 'error'/'end') event: a session is
  // being opened, so toggle() treats it as recording and a fast double tap stops
  // it instead of calling start() twice.
  const startingRef = useRef(false);

  const cb = useRef({ onTranscript, onPartialTranscript, setControlled });
  useEffect(() => {
    cb.current = { onTranscript, onPartialTranscript, setControlled };
  }, [onTranscript, onPartialTranscript, setControlled]);

  const setRecording = useCallback((v: boolean) => {
    setLocalRecording(v);
    cb.current.setControlled?.(v);
  }, []);

  const mine = () => activeOwner === id;

  useSpeechRecognitionEvent('start', () => {
    if (!mine()) return;
    startingRef.current = false;
    setRecording(true);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!mine()) return;
    startingRef.current = false;
    activeOwner = null;
    setRecording(false);
  });
  useSpeechRecognitionEvent('result', event => {
    if (!mine()) return;
    const transcript = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      if (transcript) cb.current.onTranscript(transcript);
      else toast.error('No speech detected. Please try again.');
    } else if (transcript) {
      cb.current.onPartialTranscript?.(transcript);
    }
  });
  useSpeechRecognitionEvent('error', event => {
    if (!mine()) return;
    startingRef.current = false;
    activeOwner = null;
    setRecording(false);
    if (event.error === 'not-allowed') {
      toast.error(
        'Microphone access was denied. Please allow mic access and try again.',
      );
    } else if (event.error === 'network') {
      toast.error(
        'Speech recognition needs a network connection. Please try again.',
      );
    } else if (event.error === 'no-speech') {
      toast.error('No speech detected. Please try again.');
    } else if (event.error !== 'aborted') {
      toast.error('Speech recognition failed. Please try again.');
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startingRef.current = false;
      if (activeOwner === id) {
        ExpoSpeechRecognitionModule.abort();
        activeOwner = null;
      }
    };
  }, [id]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsPending(true);
    try {
      const { granted } =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      // Unmounted, or stopped, while the permission prompt was up: don't open a session.
      if (!mountedRef.current || !startingRef.current) {
        startingRef.current = false;
        return;
      }
      if (!granted) {
        startingRef.current = false;
        Alert.alert(
          'Microphone access',
          'Microphone access was denied. Please allow mic access in Settings and try again.',
        );
        return;
      }
      if (activeOwner && activeOwner !== id)
        ExpoSpeechRecognitionModule.abort();
      activeOwner = id;
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: !!cb.current.onPartialTranscript,
      });
    } catch (err) {
      startingRef.current = false;
      if (activeOwner === id) activeOwner = null;
      console.warn('[useVoiceRecognition] start failed:', err);
      toast.error('Could not start voice input. Please try again.');
    } finally {
      if (mountedRef.current) setIsPending(false);
    }
  }, [id]);

  const stop = useCallback(() => {
    const starting = startingRef.current;
    startingRef.current = false;
    if (activeOwner === id) {
      // Not started yet: abort the half-open session rather than stop it.
      if (starting) {
        ExpoSpeechRecognitionModule.abort();
        activeOwner = null;
      } else {
        ExpoSpeechRecognitionModule.stop();
      }
    }
    setRecording(false);
  }, [id, setRecording]);

  const toggle = useCallback(() => {
    // A session still opening counts as recording, so a fast second tap stops it.
    if (startingRef.current || isRecording) stop();
    else if (!isPending) void start();
  }, [isPending, isRecording, start, stop]);

  return { isRecording, isPending, start, stop, toggle };
}
