/**
 * TextareaWithVoice — React Native version
 *
 * Wraps the NativeWind-styled `Textarea` component with the `VoiceInput` stub
 * positioned at the bottom-right corner (absolute), mirroring the web layout.
 * The prop surface is identical to the web version.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Textarea } from '@/components/ui/Textarea';
import type { TextareaProps } from '@/components/ui/Textarea';
import VoiceInput from './VoiceInput';

export type TextareaWithVoiceProps = Omit<TextareaProps, 'onChangeText' | 'value' | 'onChange'> & {
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

  const handleTranscript = (transcript: string) => {
    const newValue = value ? `${value} ${transcript}` : transcript;
    onChange({ target: { value: newValue } });
  };

  const handleChangeText = (text: string) => {
    onChange({ target: { value: text } });
  };

  return (
    <View className="relative">
      <Textarea
        value={value}
        onChangeText={handleChangeText}
        placeholder={isRecording ? 'Listening...' : placeholder}
        editable={!isRecording}
        // Extra bottom padding so text doesn't run under the mic button
        className={`pb-12 ${className ?? ''}`}
        {...props}
      />
      <View className="absolute bottom-3 right-3">
        <VoiceInput
          onTranscript={handleTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </View>
    </View>
  );
}
