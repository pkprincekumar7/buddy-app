import Speech from '@mhpdev/react-native-speech';

export function unlockIOSSpeechSynthesis(): void {
  // No-op on native — react-native-speech handles iOS permissions automatically.
}

export function pickPreferredVoice(): null {
  // @mhpdev/react-native-speech does not expose per-voice selection;
  // language + pitch are configured at speak time instead.
  return null;
}

/**
 * Speaks text using the same TTS engine as the ConversationalOnboarding chatbot.
 * rate=0.95 and pitch=1.15 give an energetic but natural female-leaning voice.
 */
export function speakText(text: string): void {
  Speech.stop();
  Speech.configure({ language: 'en-US', rate: 0.95, pitch: 1.15 });
  Speech.speak(text);
}

export function stopSpeech(): void {
  Speech.stop();
}
