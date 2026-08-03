import { useState, useRef, useEffect } from 'react';
import type { ChangeEvent, FormEvent, Ref } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import VoiceInput from '@/components/shared/VoiceInput';

interface ChatInputBarProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent | null) => void;
  onVoiceTranscript: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export default function ChatInputBar({
  value,
  onChange,
  onSubmit,
  onVoiceTranscript,
  disabled = false,
  placeholder = 'Ask anything...',
  className,
  inputRef,
}: ChatInputBarProps) {
  const [isRecording, setIsRecording] = useState(false);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsSmallScreen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // On small screens, keep only the first example value to avoid overlapping the mic icon
  const displayPlaceholder = (() => {
    if (!isSmallScreen || !placeholder) return placeholder;
    const parts = placeholder.split(',');
    return parts.length > 2 ? `${parts.slice(0, 2).join(',')}…` : placeholder;
  })();

  const showSend = value.trim().length > 0;

  return (
    <div
      className={cn('chat-bar-panel', className)}
      style={{ padding: 35, paddingBottom: 'max(35px, env(safe-area-inset-bottom))' }}
    >
      {/* VoiceInput off-screen — logic only, triggered programmatically via voiceButtonRef */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1 }}
      >
        <VoiceInput
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          onTranscript={onVoiceTranscript}
          buttonRef={voiceButtonRef}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(e);
        }}
      >
        {/* Pill — exact 74px height, 28px horizontal padding to match design */}
        <div
          className={cn(
            'chat-input-bar flex h-[74px] items-center rounded-[40px] px-7',
            disabled && 'opacity-60',
          )}
        >
          {/* Input — 20px font, white at 85% opacity for placeholder to match design */}
          <input
            ref={inputRef}
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={isRecording ? 'Listening…' : displayPlaceholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
            className="min-w-0 flex-1 bg-transparent text-[20px] text-white outline-none placeholder:text-white/85 disabled:cursor-not-allowed"
          />

          {showSend ? (
            <button
              type="submit"
              disabled={disabled || !value.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-medium text-white transition-all hover:bg-info active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          ) : (
            /* Waveform bars — exact heights 12/18/24/18/12px, 3px wide, 4px gap, white */
            <button
              type="button"
              onClick={() => voiceButtonRef.current?.click()}
              aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
              className={cn(
                'flex shrink-0 cursor-pointer items-end border-none bg-transparent p-0',
                isRecording && 'voice-wave-active',
              )}
              style={{ gap: 4 }}
            >
              {([12, 18, 24, 18, 12] as const).map((h, i) => (
                <span
                  key={i}
                  className={cn(isRecording ? 'bg-error-medium' : 'bg-white/85')}
                  style={{ width: 3, height: h, borderRadius: 3, display: 'block' }}
                />
              ))}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
