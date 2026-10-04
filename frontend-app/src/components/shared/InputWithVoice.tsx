import React, { forwardRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import VoiceInput from './VoiceInput';

type InputWithVoiceProps = Omit<
  InputProps,
  'onChange' | 'value' | 'onChangeText'
> & {
  value?: string;
  /** Same `{ target: { value } }` shape as the web component, so call sites port unchanged. */
  onChange: (e: { target: { value: string } }) => void;
};

const InputWithVoice = forwardRef<TextInput, InputWithVoiceProps>(
  ({ value, onChange, placeholder, className, ...props }, ref) => {
    const [isRecording, setIsRecording] = useState(false);
    return (
      <View className="flex-1 flex-row items-center gap-2">
        <Input
          ref={ref}
          value={value}
          onChangeText={text => onChange({ target: { value: text } })}
          placeholder={isRecording ? 'Listening...' : placeholder}
          editable={!isRecording}
          className={cn('flex-1', className)}
          {...props}
        />
        <VoiceInput
          onTranscript={t => onChange({ target: { value: t } })}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </View>
    );
  },
);
InputWithVoice.displayName = 'InputWithVoice';
export default InputWithVoice;
