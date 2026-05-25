import { useState } from 'react';
import { Input } from '@/components/ui/input';
import VoiceInput from './VoiceInput';

interface InputWithVoiceProps {
  value?: string;
  onChange: (e: { target: { value: string } }) => void;
  placeholder?: string;
  className?: string;
  [key: string]: unknown;
}

export default function InputWithVoice({
  value,
  onChange,
  placeholder,
  className,
  ...props
}: InputWithVoiceProps) {
  const [isRecording, setIsRecording] = useState(false);

  const handleTranscript = (transcript: string) => {
    onChange({ target: { value: transcript } });
  };

  return (
    <div className="flex items-center gap-2">
      <Input
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
}
