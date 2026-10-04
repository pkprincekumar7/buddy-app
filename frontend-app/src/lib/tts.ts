import Speech from '@mhpdev/react-native-speech';

/**
 * Native counterpart of the web's lib/tts.ts. The web picks a browser
 * SpeechSynthesis voice; on RN `@mhpdev/react-native-speech` speaks with the
 * platform voice, tuned to the same energetic, natural delivery.
 */

/** No-op on native — iOS Safari's gesture unlock has no RN equivalent. */
export function unlockIOSSpeechSynthesis(): void {}

/** No-op on native — per-voice selection isn't exposed; see speakText(). */
export function pickPreferredVoice(): null {
  return null;
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  onDone?: () => void;
}

/** Speaks `text`, cancelling anything already speaking (web: speechSynthesis.cancel() + speak()). */
export function speakText(
  text: string,
  { rate = 0.95, pitch = 1.15, onDone }: SpeakOptions = {},
): void {
  void Speech.stop();
  Speech.configure({ language: 'en-US', rate, pitch });
  void Speech.speak(text).then(id => {
    if (!onDone) return;
    // Like the web utterance's onend: fires when this utterance finishes or is cancelled.
    const finish = Speech.onFinish(e => {
      if (e.id === id) done();
    });
    const stopped = Speech.onStopped(e => {
      if (e.id === id) done();
    });
    function done() {
      finish.remove();
      stopped.remove();
      onDone?.();
    }
  });
}

/** web: window.speechSynthesis.cancel(). */
export function stopSpeech(): void {
  void Speech.stop();
}
