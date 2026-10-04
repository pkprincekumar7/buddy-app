import React from 'react';
import { TextInput, View, useWindowDimensions } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { color, edge, gradient, recipe } from '@/theme';
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition';

interface ChatInputBarProps {
  value: string;
  /** Same `{ target: { value } }` shape as the web's ChangeEvent, so call sites port unchanged. */
  onChange: (e: { target: { value: string } }) => void;
  onSubmit: (e: null) => void;
  onVoiceTranscript: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<TextInput>;
}

// Waveform bar heights 12/18/24/18/12px, 3px wide, 4px gap — and the web's
// `voice-wave` keyframes (scaleY 1 → 1.65 → 1 over 0.55s, staggered 0/90/180/90/0ms).
const BARS = [12, 18, 24, 18, 12] as const;
const BAR_DELAYS = [0, 90, 180, 90, 0] as const;
const VOICE_WAVE = {
  '0%': { transform: [{ scaleY: 1 }] },
  '50%': { transform: [{ scaleY: 1.65 }] },
  '100%': { transform: [{ scaleY: 1 }] },
};

/** RN port of the web ChatInputBar — the glass pill over the blue `chat-bar-panel` glow. */
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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isRecording, toggle } = useVoiceRecognition({
    onTranscript: onVoiceTranscript,
  });

  // On small screens, keep only the first example values to avoid overlapping the mic icon.
  const displayPlaceholder = (() => {
    if (width > 640 || !placeholder) return placeholder;
    const parts = placeholder.split(',');
    return parts.length > 2 ? `${parts.slice(0, 2).join(',')}…` : placeholder;
  })();

  const showSend = value.trim().length > 0;

  return (
    <View
      className={cn('p-[35px]', className)}
      style={{
        experimental_backgroundImage: gradient.chatBarPanel,
        paddingBottom: Math.max(35, insets.bottom),
      }}
    >
      <View
        className={cn(
          'h-[60px] flex-row items-center rounded-[40px] px-7',
          disabled && 'opacity-60',
        )}
        style={recipe.chatInputBar}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={text => onChange({ target: { value: text } })}
          editable={!disabled}
          placeholder={isRecording ? 'Listening…' : displayPlaceholder}
          placeholderTextColor={edge(0.85)}
          selectionColor={color.ring}
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="sentences"
          returnKeyType="send"
          onSubmitEditing={() => value.trim() && onSubmit(null)}
          accessibilityLabel={placeholder}
          className="min-w-0 flex-1 text-[16px] font-light text-white"
        />

        {showSend ? (
          <Pressable
            onPress={() => onSubmit(null)}
            disabled={disabled || !value.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            className={cn(
              'h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-medium',
              (disabled || !value.trim()) && 'opacity-30',
            )}
            style={({ pressed }) => pressed && { transform: [{ scale: 0.95 }] }}
          >
            <Send size={16} color={color.foreground} />
          </Pressable>
        ) : (
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={
              isRecording ? 'Stop recording' : 'Start voice input'
            }
            hitSlop={10}
            className="shrink-0 flex-row items-end gap-1"
          >
            {BARS.map((h, i) => (
              <Animated.View
                key={i}
                className={cn(
                  'w-[3px] rounded-[3px]',
                  isRecording ? 'bg-error-medium' : 'bg-white/85',
                )}
                style={[
                  { height: h, transformOrigin: 'bottom' },
                  isRecording && {
                    animationName: VOICE_WAVE,
                    animationDuration: '0.55s',
                    animationDelay: `${BAR_DELAYS[i] ?? 0}ms`,
                    animationIterationCount: 'infinite',
                    animationTimingFunction: 'ease-in-out',
                  },
                ]}
              />
            ))}
          </Pressable>
        )}
      </View>
    </View>
  );
}
