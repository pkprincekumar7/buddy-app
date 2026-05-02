/**
 * Picks the best available English TTS voice using a consistent preference waterfall.
 * Must be called just before speaking — the browser voice list may be empty on first load.
 * @returns {SpeechSynthesisVoice | null}
 */
export function pickPreferredVoice() {
  if (typeof window === 'undefined') return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v =>
      v.name.includes('Google US English Female') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Samantha') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira') ||
      v.name.includes('Fiona') ||
      v.name.includes('Serena') ||
      (v.name.includes('Microsoft') && v.name.includes('Zira')) ||
      (v.name.includes('Microsoft') && v.name.includes('Eva'))
    ) ||
    voices.find(v => v.lang.startsWith('en') && !v.localService) ||
    voices.find(v => v.lang.startsWith('en')) ||
    null
  );
}
