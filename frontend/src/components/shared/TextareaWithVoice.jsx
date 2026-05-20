import { useState } from 'react';
import PropTypes from 'prop-types';
import { Textarea } from '@/components/ui/textarea';
import VoiceInput from './VoiceInput';

export default function TextareaWithVoice({ value, onChange, placeholder, className, ...props }) {
  const [isRecording, setIsRecording] = useState(false);

  const handleTranscript = (transcript) => {
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

TextareaWithVoice.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  className: PropTypes.string,
};
