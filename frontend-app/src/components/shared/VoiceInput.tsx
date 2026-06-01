import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import Sound from 'react-native-nitro-sound';
import type { RecordBackType } from 'react-native-nitro-sound';
import RNFS from 'react-native-fs';
import { Mic, MicOff } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';

export interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  isRecording: boolean;
  setIsRecording: (value: boolean) => void;
  isTranscribing: boolean;
  setIsTranscribing: (value: boolean) => void;
  'aria-label'?: string;
}

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'BuddyApp needs microphone access to record your voice input.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function deleteFile(uri: string) {
  // RNFS.unlink expects a plain file path, not a file:// URI.
  const path = uri.replace(/^file:\/\//, '');
  RNFS.unlink(path).catch(() => {});
}

// Amplitude below this (in dB) is considered silence.
const SILENCE_THRESHOLD_DB = -35;
// Stop recording after this many ms of continuous silence.
const SILENCE_DURATION_MS = 1500;
// Hard cap — stop after 30 s regardless of silence detection.
const MAX_RECORDING_MS = 30_000;

export default function VoiceInput({
  onTranscript,
  isRecording,
  setIsRecording,
  isTranscribing,
  setIsTranscribing,
  'aria-label': ariaLabel,
}: VoiceInputProps) {
  const [isPendingPermission, setIsPendingPermission] = useState(false);
  const isActiveRef = useRef(false); // guards against re-entrant stop calls
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceDetectedRef = useRef(false); // true if amplitude exceeded threshold at least once

  // Keep latest callbacks in refs so timers/listeners always call the current version.
  // This avoids adding them to doStop's dependency array (which would cascade into
  // startRecording / handlePress re-creations on every parent render).
  const onTranscriptRef = useRef(onTranscript);
  const setIsRecordingRef = useRef(setIsRecording);
  const setIsTranscribingRef = useRef(setIsTranscribing);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    setIsRecordingRef.current = setIsRecording;
  }, [setIsRecording]);
  useEffect(() => {
    setIsTranscribingRef.current = setIsTranscribing;
  }, [setIsTranscribing]);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  // Core stop logic — safe to call from silence timer, max-timer, or manual press.
  const doStop = useCallback(async () => {
    if (!isActiveRef.current) return; // already stopped or never started
    isActiveRef.current = false;
    clearTimers();
    Sound.removeRecordBackListener();
    setIsRecordingRef.current(false);

    let uri: string;
    try {
      uri = await Sound.stopRecorder();
    } catch {
      toast.error('Recording stopped unexpectedly. Please try again.');
      return;
    }

    if (!uri || uri === 'already stopped') return;

    // If the amplitude never exceeded the threshold, the mic captured only silence.
    // Skip the Whisper call — it would hallucinate a word on silent audio.
    if (!voiceDetectedRef.current) {
      toast.error('No speech detected. Please speak clearly and try again.');
      deleteFile(uri);
      return;
    }

    setIsTranscribingRef.current(true);
    try {
      const result = (await api.audio.transcribe(uri)) as {
        transcript?: string;
      };
      if (result?.transcript) {
        onTranscriptRef.current(result.transcript);
      } else {
        toast.error('No speech detected. Please try again.');
      }
    } catch {
      toast.error('Transcription failed. Please try again.');
    } finally {
      setIsTranscribingRef.current(false);
      deleteFile(uri); // always clean up the temp audio file
    }
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      if (isActiveRef.current) {
        isActiveRef.current = false;
        clearTimers();
        Sound.removeRecordBackListener();
        Sound.stopRecorder().catch(() => {});
      }
    };
  }, [clearTimers]);

  const startRecording = useCallback(async () => {
    if (isActiveRef.current) return;
    // Set the guard immediately (before any await) to prevent double-start from rapid taps.
    isActiveRef.current = true;
    voiceDetectedRef.current = false; // reset for each new recording session

    setIsPendingPermission(true);
    const hasPermission = await requestMicPermission();
    setIsPendingPermission(false);

    if (!isActiveRef.current) return; // unmounted during permission dialog
    if (!hasPermission) {
      isActiveRef.current = false;
      toast.error(
        'Microphone access was denied. Please allow mic access and try again.',
      );
      return;
    }

    // Silence detection: auto-stop after SILENCE_DURATION_MS of continuous quiet audio.
    // Two phases:
    //   1. Warm-up (800 ms)  — ignore all callbacks so the user has time to speak.
    //   2. Minimum (2 000 ms) — record for at least 2 s before silence can stop it.
    //      Whisper reliably hallucinates ("you", "thanks", etc.) on clips < ~2 s,
    //      so this floor prevents false transcriptions on quiet/short recordings.
    //
    // Android fix: on Android the native recording timer starts firing callbacks
    // *before* startRecorder()'s Promise resolves back to JS. Those early callbacks
    // would be measured against the pre-await warmupRef value (i.e. elapsed >> 800)
    // and slip past the warm-up gate, causing voiceDetectedRef to be set/unset with
    // stale amplitude readings (getMaxAmplitude returns 0 until the recorder warms
    // up). The `recordingStartedRef` flag acts as an additional gate: the listener
    // ignores all callbacks until startRecorder() has fully resolved and warmupRef
    // has been reset to the true recording-start timestamp.
    const warmupRef = { current: Date.now() };
    const recordingStartedRef = { current: false };
    Sound.addRecordBackListener((data: RecordBackType) => {
      if (!recordingStartedRef.current) return; // discard pre-start callbacks (Android)
      const elapsed = Date.now() - warmupRef.current;
      if (elapsed < 800) return; // warm-up: ignore early callbacks
      const amplitude = data.currentMetering ?? -160;
      if (amplitude >= SILENCE_THRESHOLD_DB) {
        // Voice detected — mark it and cancel any pending silence timer.
        voiceDetectedRef.current = true;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (!silenceTimerRef.current && elapsed >= 2000) {
        // Silence detected AND minimum recording time met — schedule auto-stop.
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          void doStop();
        }, SILENCE_DURATION_MS);
      }
    });

    try {
      await Sound.startRecorder(undefined, undefined, true);
      // Reset warmupRef *before* opening the gate so the first unblocked callback
      // measures elapsed time from the true recording-start moment.
      warmupRef.current = Date.now();
      recordingStartedRef.current = true; // open gate: callbacks are now valid
      setIsRecording(true);

      // Safety cap in case silence detection never triggers.
      maxTimerRef.current = setTimeout(() => {
        maxTimerRef.current = null;
        void doStop();
      }, MAX_RECORDING_MS);
    } catch {
      isActiveRef.current = false;
      Sound.removeRecordBackListener();
      toast.error('Could not start recording. Please check your microphone.');
    }
  }, [doStop, setIsRecording]);

  const handlePress = useCallback(() => {
    if (isTranscribing || isPendingPermission) return;
    if (isActiveRef.current) {
      void doStop();
    } else {
      void startRecording();
    }
  }, [isTranscribing, isPendingPermission, doStop, startRecording]);

  const isBusy = isTranscribing || isPendingPermission;
  const defaultLabel = isPendingPermission
    ? 'Requesting mic…'
    : isTranscribing
    ? 'Transcribing…'
    : isRecording
    ? 'Stop recording'
    : 'Start voice input';

  return (
    <Pressable
      onPress={handlePress}
      disabled={isBusy}
      accessibilityLabel={ariaLabel ?? defaultLabel}
      accessibilityRole="button"
      className={cn(
        'h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
        isRecording
          ? 'bg-red-500'
          : isTranscribing
          ? 'bg-amber-400'
          : isPendingPermission
          ? 'bg-slate-400'
          : 'bg-transparent',
        isBusy && 'opacity-50',
      )}
    >
      {isBusy ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : isRecording ? (
        <MicOff size={16} color="#ffffff" />
      ) : (
        <Mic size={16} color="#94a3b8" />
      )}
    </Pressable>
  );
}
