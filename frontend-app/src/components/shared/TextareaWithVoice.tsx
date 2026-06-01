/**
 * TextareaWithVoice — React Native version
 *
 * Wraps the NativeWind-styled `Textarea` component with the `VoiceInput` stub
 * positioned at the bottom-right corner (absolute), mirroring the web layout.
 * The prop surface is identical to the web version.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { Textarea } from '@/components/ui/Textarea';
import type { TextareaProps } from '@/components/ui/Textarea';
import VoiceInput from './VoiceInput';

export type TextareaWithVoiceProps = Omit<
  TextareaProps,
  'onChangeText' | 'value' | 'onChange'
> & {
  value?: string;
  /** Mirrors the web onChange signature so form libraries work unchanged. */
  onChange: (e: { target: { value: string } }) => void;
};

export default function TextareaWithVoice({
  value,
  onChange,
  placeholder,
  className,
  ...props
}: TextareaWithVoiceProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleTranscript = useCallback(
    (transcript: string) => {
      onChange({
        target: { value: value ? `${value} ${transcript}` : transcript },
      });
    },
    [onChange, value],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      onChange({ target: { value: text } });
    },
    [onChange],
  );

  const isBusy = isRecording || isTranscribing;

  const activePlaceholder = useMemo(() => {
    if (isRecording) return 'Listening...';
    if (isTranscribing) return 'Transcribing...';
    return placeholder;
  }, [isRecording, isTranscribing, placeholder]);

  return (
    <View className="relative">
      <Textarea
        value={value}
        onChangeText={handleChangeText}
        placeholder={activePlaceholder}
        editable={!isBusy}
        // Extra bottom padding so text doesn't run under the mic button
        className={`pb-12 ${className ?? ''}`}
        {...props}
      />
      <View className="absolute bottom-3 right-3">
        <VoiceInput
          onTranscript={handleTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          isTranscribing={isTranscribing}
          setIsTranscribing={setIsTranscribing}
        />
      </View>
    </View>
  );
}
