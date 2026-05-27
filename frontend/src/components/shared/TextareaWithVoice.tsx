import { useState } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { Textarea } from '@/components/ui/textarea';
import VoiceInput from './VoiceInput';

type TextareaWithVoiceProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
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

  const handleTranscript = (transcript: string) => {
    const newValue = value ? `${value} ${transcript}` : transcript;
    onChange({ target: { value: newValue } });
  };

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={onChange}
        placeholder={isRecording ? 'Listening...' : placeholder}
        disabled={isRecording}
        className={className}
        {...props}
      />
      <div className="absolute bottom-3 right-3">
        <VoiceInput
          onTranscript={handleTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </div>
    </div>
  );
}
