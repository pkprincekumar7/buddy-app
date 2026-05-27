/**
 * InputWithVoice — React Native version
 *
 * Wraps the NativeWind-styled `Input` component with the `VoiceInput` stub
 * sitting to its right. The prop surface is intentionally identical to the
 * web version so that screen-level code can import this unchanged.
 */
import React, { useState, forwardRef } from 'react';
import { View } from 'react-native';
import type { TextInput } from 'react-native';
import { Input } from '@/components/ui/Input';
import type { InputProps } from '@/components/ui/Input';
import VoiceInput from './VoiceInput';

export type InputWithVoiceProps = Omit<InputProps, 'onChangeText' | 'value' | 'onChange'> & {
  value?: string;
  /** Mirrors the web onChange signature so form libraries work unchanged. */
  onChange: (e: { target: { value: string } }) => void;
};

const InputWithVoice = forwardRef<React.ElementRef<typeof TextInput>, InputWithVoiceProps>(
  ({ value, onChange, placeholder, className, ...props }, ref) => {
    const [isRecording, setIsRecording] = useState(false);

    const handleTranscript = (transcript: string) => {
      onChange({ target: { value: transcript } });
    };

    const handleChangeText = (text: string) => {
      onChange({ target: { value: text } });
    };

    return (
      <View className="flex-row items-center gap-2">
        <Input
          ref={ref}
          value={value}
          onChangeText={handleChangeText}
          placeholder={isRecording ? 'Listening...' : placeholder}
          editable={!isRecording}
          className={`flex-1 ${className ?? ''}`}
          {...props}
        />
        <VoiceInput
          onTranscript={handleTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </View>
    );
  },
);

InputWithVoice.displayName = 'InputWithVoice';
export default InputWithVoice;
