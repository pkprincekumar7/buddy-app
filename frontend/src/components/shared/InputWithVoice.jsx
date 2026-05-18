import { useState } from 'react';
import PropTypes from 'prop-types';
import { Input } from "@/components/ui/input";
import VoiceInput from './VoiceInput';

export default function InputWithVoice({ value, onChange, placeholder, className, ...props }) {
  const [isRecording, setIsRecording] = useState(false);

  const handleTranscript = (transcript) => {
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
      <VoiceInput
        onTranscript={handleTranscript}
        isRecording={isRecording}
        setIsRecording={setIsRecording}
      />
    </div>
  );
}

InputWithVoice.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  className: PropTypes.string,
};