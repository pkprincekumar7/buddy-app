import { useState, forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';
import VoiceInput from './VoiceInput';

type InputWithVoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value?: string;
  onChange: (e: { target: { value: string } }) => void;
};

const InputWithVoice = forwardRef<HTMLInputElement, InputWithVoiceProps>(
  ({ value, onChange, placeholder, className, ...props }, ref) => {
    const [isRecording, setIsRecording] = useState(false);

    const handleTranscript = (transcript: string) => {
      onChange({ target: { value: transcript } });
    };

    return (
      <div className="flex items-center gap-2">
        <Input
          ref={ref}
          value={value}
          onChange={onChange}
          placeholder={isRecording ? 'Listening...' : placeholder}
          disabled={isRecording}
          className={className}
          {...props}
        />
        <VoiceInput
          onTranscript={handleTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </div>
    );
  },
);

InputWithVoice.displayName = 'InputWithVoice';
export default InputWithVoice;
