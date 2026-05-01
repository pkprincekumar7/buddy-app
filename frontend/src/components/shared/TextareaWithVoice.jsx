import { useState } from 'react';
import { Textarea } from "@/components/ui/textarea";
import VoiceInputButton from './VoiceInput';

export default function TextareaWithVoice({ value, onChange, placeholder, className, ...props }) {
  const [isRecording, setIsRecording] = useState(false);

  const handleTranscript = (transcript) => {
    // Append transcript to existing value or set as new value
    const newValue = value ? `${value} ${transcript}` : transcript;
    onChange({ target: { value: newValue } });
  };

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={onChange}
        placeholder={isRecording ? "Listening..." : placeholder}
        disabled={isRecording}
        className={className}
        {...props}
      />
      <div className="absolute bottom-3 right-3">
        <VoiceInputButton
          onTranscript={handleTranscript}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
        />
      </div>
    </div>
  );
}