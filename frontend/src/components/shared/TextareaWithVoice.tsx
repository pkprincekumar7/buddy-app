import { forwardRef, useRef, useState } from 'react';
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

const TextareaWithVoice = forwardRef<HTMLTextAreaElement, TextareaWithVoiceProps>(
  ({ value, onChange, placeholder, className, ...props }, ref) => {
    const [isRecording, setIsRecording] = useState(false);
    // Latest value, so a transcript arriving after "Transcribing…" appends to
    // whatever was typed meanwhile instead of the value captured at record time.
    const valueRef = useRef(value);
    valueRef.current = value;

    const handleTranscript = (transcript: string) => {
      const current = valueRef.current;
      const newValue = current ? `${current} ${transcript}` : transcript;
      onChange({ target: { value: newValue } });
    };

    return (
      <div className="relative">
        <Textarea
          ref={ref}
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
  },
);
TextareaWithVoice.displayName = 'TextareaWithVoice';

export default TextareaWithVoice;
