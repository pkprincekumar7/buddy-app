import React from 'react';
import { ActivityIndicator } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { cn } from '@/lib/utils';
import { color, hsl } from '@/theme';
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition';
import VoiceWaveIcon from './VoiceWaveIcon';

interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  onPartialTranscript?: (transcript: string) => void;
  isRecording: boolean;
  setIsRecording: (value: boolean) => void;
  'aria-label'?: string;
  /** When provided, fully replaces the default button className (background, size, etc.) */
  buttonClassName?: string;
}

/** RN port of the web VoiceInput — same 40×40 rounded-xl button and waveform glyph. */
export default function VoiceInput({
  onTranscript,
  onPartialTranscript,
  isRecording,
  setIsRecording,
  'aria-label': ariaLabel,
  buttonClassName,
}: VoiceInputProps) {
  const { isPending, toggle } = useVoiceRecognition({
    onTranscript,
    onPartialTranscript,
    isRecording,
    setIsRecording,
  });

  const label = isPending
    ? 'Requesting microphone…'
    : isRecording
    ? 'Stop recording'
    : 'Start voice input';
  const glyph = buttonClassName
    ? isRecording
      ? color['error-medium']
      : hsl('muted-foreground', 0.7)
    : isRecording
    ? color.foreground
    : color['muted-foreground'];

  return (
    <Pressable
      onPress={toggle}
      disabled={isPending}
      accessibilityRole="button"
      accessibilityLabel={ariaLabel ?? label}
      accessibilityState={{ busy: isPending }}
      hitSlop={4}
      className={
        buttonClassName ??
        cn(
          'h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          isRecording
            ? 'bg-error-medium'
            : isPending
            ? 'bg-warning'
            : 'bg-ghost-strong',
        )
      }
      style={({ pressed }) => pressed && { transform: [{ scale: 0.97 }] }}
    >
      {isPending ? (
        <ActivityIndicator size="small" color={color.foreground} />
      ) : (
        <VoiceWaveIcon color={glyph} />
      )}
    </Pressable>
  );
}
