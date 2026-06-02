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
  const [partialText, setPartialText] = useState('');

  const handleTranscript = useCallback(
    (transcript: string) => {
      setPartialText('');
      onChange({
        target: { value: value ? `${value} ${transcript}` : transcript },
      });
    },
    [onChange, value],
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

  const activePlaceholder = useMemo(() => {
    if (isRecording) return 'Listening...';
    return placeholder;
  }, [isRecording, placeholder]);

  return (
    <View className="relative">
      <Textarea
        value={partialText || value}
        onChangeText={handleChangeText}
        placeholder={activePlaceholder}
        editable={!isRecording}
        className={`pb-12 ${className ?? ''}`}
        {...props}
      />
      <View className="absolute bottom-3 right-3">
        <VoiceInput
          onTranscript={handleTranscript}
          onPartialTranscript={handlePartialTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </View>
    </View>
  );
}
