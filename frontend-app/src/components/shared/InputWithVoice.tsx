import React, { useState, useCallback, forwardRef } from 'react';
import { View } from 'react-native';
import type { TextInput } from 'react-native';
import { Input } from '@/components/ui/Input';
import type { InputProps } from '@/components/ui/Input';
import VoiceInput from './VoiceInput';

export type InputWithVoiceProps = Omit<
  InputProps,
  'onChangeText' | 'value' | 'onChange'
> & {
  value?: string;
  onChange: (e: { target: { value: string } }) => void;
};

const InputWithVoice = forwardRef<
  React.ElementRef<typeof TextInput>,
  InputWithVoiceProps
>(({ value, onChange, placeholder, className, ...props }, ref) => {
  const [isRecording, setIsRecording] = useState(false);
  const [partialText, setPartialText] = useState('');

  const handleTranscript = useCallback(
    (transcript: string) => {
      setPartialText('');
      onChange({ target: { value: transcript } });
    },
    [onChange],
  );

  const handlePartialTranscript = useCallback((partial: string) => {
    setPartialText(partial);
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      onChange({ target: { value: text } });
    },
    [onChange],
  );

  return (
    <View className="flex-1 flex-row items-center gap-2">
      <Input
        ref={ref}
        value={partialText || value}
        onChangeText={handleChangeText}
        placeholder={isRecording ? 'Listening...' : placeholder}
        editable={!isRecording}
        className={`flex-1 ${className ?? ''}`}
        {...props}
      />
      <VoiceInput
        onTranscript={handleTranscript}
        onPartialTranscript={handlePartialTranscript}
        isRecording={isRecording}
        setIsRecording={setIsRecording}
      />
    </View>
  );
});

InputWithVoice.displayName = 'InputWithVoice';
export default InputWithVoice;
