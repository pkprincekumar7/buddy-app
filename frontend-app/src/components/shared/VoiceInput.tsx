import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, Pressable } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Mic, MicOff } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useTheme } from '@/lib/ThemeContext';

export interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  onPartialTranscript?: (transcript: string) => void;
  isRecording: boolean;
  setIsRecording: (value: boolean) => void;
  'aria-label'?: string;
}

export default function VoiceInput({
  onTranscript,
  onPartialTranscript,
  isRecording,
  setIsRecording,
  'aria-label': ariaLabel,
}: VoiceInputProps) {
  const { colors } = useTheme();
  const [isPendingPermission, setIsPendingPermission] = useState(false);

  // Keep latest callbacks in refs so event handlers always call the current version.
  const onTranscriptRef = useRef(onTranscript);
  const onPartialTranscriptRef = useRef(onPartialTranscript);
  const setIsRecordingRef = useRef(setIsRecording);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onPartialTranscriptRef.current = onPartialTranscript;
  }, [onPartialTranscript]);
  useEffect(() => {
    setIsRecordingRef.current = setIsRecording;
  }, [setIsRecording]);

  useSpeechRecognitionEvent('start', () => {
    setIsRecordingRef.current(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsRecordingRef.current(false);
  });

  useSpeechRecognitionEvent('result', event => {
    const transcript = event.results[0]?.transcript;
    if (event.isFinal) {
      if (transcript) {
        onTranscriptRef.current(transcript);
      } else {
        toast.error('No speech detected. Please try again.');
      }
    } else if (transcript) {
      onPartialTranscriptRef.current?.(transcript);
    }
  });

  useSpeechRecognitionEvent('error', event => {
    setIsRecordingRef.current(false);
    // 'no-speech'  = user didn't say anything recognisable.
    // 'aborted'    = recognition stopped intentionally — not a user-facing error.
    if (event.error === 'no-speech') {
      toast.error('No speech detected. Please try again.');
    } else if (event.error !== 'aborted') {
      toast.error('Speech recognition failed. Please try again.');
    }
  });

  const startRecording = useCallback(async () => {
    setIsPendingPermission(true);
    const { granted } =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    setIsPendingPermission(false);

    if (!granted) {
      Alert.alert(
        'Permission denied',
        'Microphone permission is required. Please allow it in your device settings.',
      );
      return;
    }

    ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true });
  }, []);

  const stopRecording = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const handlePress = useCallback(() => {
    if (isPendingPermission) return;
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [isPendingPermission, isRecording, stopRecording, startRecording]);

  const defaultLabel = isPendingPermission
    ? 'Requesting mic…'
    : isRecording
    ? 'Stop recording'
    : 'Start voice input';

  return (
    <Pressable
      onPress={handlePress}
      disabled={isPendingPermission}
      accessibilityLabel={ariaLabel ?? defaultLabel}
      accessibilityRole="button"
      className={cn(
        'h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
        isRecording ? '' : 'bg-transparent',
        isPendingPermission && 'opacity-50',
      )}
      style={
        isRecording
          ? { backgroundColor: colors.error }
          : isPendingPermission
          ? { backgroundColor: colors.iconColor }
          : undefined
      }
    >
      {isPendingPermission ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} />
      ) : isRecording ? (
        <MicOff size={16} color={colors.primaryForeground} />
      ) : (
        <Mic size={16} color={colors.iconColor} />
      )}
    </Pressable>
  );
}
