/**
 * iOS Safari requires speechSynthesis to be triggered from a user gesture.
 * Call this once on the first user interaction to unlock the API for async use.
 */
export function unlockIOSSpeechSynthesis() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance('');
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

/**
 * Picks the best available English TTS voice using a consistent preference waterfall.
 * Must be called just before speaking — the browser voice list may be empty on first load.
 * @returns {SpeechSynthesisVoice | null}
 */
export function pickPreferredVoice() {
  if (typeof window === 'undefined') return null;
  const voices = window.speechSynthesis.getVoices();
  // Preference order: energetic, high-quality female voices first
  return (
    voices.find((v) => v.name.includes('Google UK English Female')) ??
    voices.find((v) => v.name.includes('Google US English Female')) ??
    voices.find((v) => v.name.includes('Fiona')) ??
    voices.find((v) => v.name.includes('Serena')) ??
    voices.find((v) => v.name.includes('Karen')) ??
    voices.find((v) => v.name.includes('Samantha')) ??
    voices.find((v) => v.name.includes('Moira')) ??
    voices.find((v) => v.name.includes('Microsoft') && v.name.includes('Zira')) ??
    voices.find((v) => v.name.includes('Microsoft') && v.name.includes('Eva')) ??
    voices.find((v) => v.lang.startsWith('en') && !v.localService) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  );
}

/**
 * Speaks `text` with the preferred voice, cancelling anything already speaking: the
 * kids page's read-aloud (mobile lib/tts.ts has the same function).
 */
export function speakText(text: string, { rate = 0.95, pitch = 1.15 } = {}): void {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickPreferredVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? 'en-US';
  utterance.rate = rate;
  utterance.pitch = pitch;
  window.speechSynthesis.speak(utterance);
}

/** Stops any speech (mobile lib/tts.ts has the same function). */
export function stopSpeech(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}
