import React, { forwardRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Textarea, type TextareaProps } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import VoiceInput from './VoiceInput';

type TextareaWithVoiceProps = Omit<
  TextareaProps,
  'onChange' | 'value' | 'onChangeText'
> & {
  value?: string;
  /** Same `{ target: { value } }` shape as the web component, so call sites port unchanged. */
  onChange: (e: { target: { value: string } }) => void;
};

const TextareaWithVoice = forwardRef<TextInput, TextareaWithVoiceProps>(
  ({ value, onChange, placeholder, className, ...props }, ref) => {
    const [isRecording, setIsRecording] = useState(false);
    return (
      <View className="relative">
        <Textarea
          ref={ref}
          value={value}
          onChangeText={text => onChange({ target: { value: text } })}
          placeholder={isRecording ? 'Listening...' : placeholder}
          editable={!isRecording}
          className={cn('pr-14', className)}
          {...props}
        />
        <View className="absolute bottom-3 right-3">
          <VoiceInput
            onTranscript={t =>
              onChange({ target: { value: value ? `${value} ${t}` : t } })
            }
            isRecording={isRecording}
            setIsRecording={setIsRecording}
          />
        </View>
      </View>
    );
  },
);
TextareaWithVoice.displayName = 'TextareaWithVoice';
export default TextareaWithVoice;
