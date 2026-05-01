import { useState } from 'react';
import { Input } from "@/components/ui/input";
import VoiceInputButton from './VoiceInput';

export default function InputWithVoice({ value, onChange, placeholder, className, ...props }) {
  const [isRecording, setIsRecording] = useState(false);

  const handleTranscript = (transcript) => {
    // Replace value with transcript for single-line inputs
    onChange({ target: { value: transcript } });
  };

  return (
    <div className="flex gap-2 items-center">
      <Input
        value={value}
        onChange={onChange}
        placeholder={isRecording ? "Listening..." : placeholder}
        disabled={isRecording}
        className={className}
        {...props}
      />
      <VoiceInputButton
        onTranscript={handleTranscript}
        isRecording={isRecording}
        setIsRecording={setIsRecording}
      />
    </div>
  );
}