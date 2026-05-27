/**
 * VoiceInput — React Native stub (Phase 5)
 *
 * @react-native-voice/voice is NOT yet installed.
 * The component keeps an identical public interface to the web version so that
 * Phase 6 can drop in the real implementation without touching any consumers.
 *
 * Behaviour: tapping the mic button shows an Alert instead of recording.
 */
import React, { useState } from 'react';
import { Alert, ActivityIndicator, Pressable } from 'react-native';
import { Mic, MicOff } from 'lucide-react-native';
import { cn } from '@/lib/utils';

export interface VoiceInputProps {
  /** Called with the recognised transcript string (stub never calls this). */
  onTranscript: (transcript: string) => void;
  /** Whether recording is currently active. */
  isRecording: boolean;
  /** Parent state setter so VoiceInput can drive the recording flag. */
  setIsRecording: (value: boolean) => void;
  /** Accessible label forwarded to the Pressable. */
  'aria-label'?: string;
}

export default function VoiceInput({
  isRecording,
  setIsRecording,
  'aria-label': ariaLabel,
}: VoiceInputProps) {
  // isTranscribing is always false in the stub, but kept so the shape matches
  // the real implementation and consumers can pattern-match against it later.
  const [isTranscribing] = useState(false);

  const handlePress = () => {
    if (isRecording) {
      // If somehow recording was set to true externally, let the button cancel it.
      setIsRecording(false);
      return;
    }
    Alert.alert(
      'Voice input',
      'Voice input will be available in a future update.',
      [{ text: 'OK', style: 'default' }],
    );
  };

  const defaultLabel = isTranscribing
    ? 'Transcribing…'
    : isRecording
      ? 'Stop recording'
      : 'Start voice input';

  return (
    <Pressable
      onPress={handlePress}
      disabled={isTranscribing}
      accessibilityLabel={ariaLabel ?? defaultLabel}
      accessibilityRole="button"
      className={cn(
        'h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
        isRecording
          ? 'bg-red-500'
          : isTranscribing
            ? 'bg-amber-400'
            : 'bg-transparent',
        isTranscribing && 'opacity-50',
      )}
    >
      {isTranscribing ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : isRecording ? (
        <MicOff size={16} color="#ffffff" />
      ) : (
        <Mic size={16} color="#94a3b8" />
      )}
    </Pressable>
  );
}
