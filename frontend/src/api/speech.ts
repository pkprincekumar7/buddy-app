// Voice input's transcription (build plan 7.8), through the shared service's generated
// client: the recording goes up as multipart `audio`, and the text comes back. Nothing
// is stored. Web only: the mobile app recognises speech on the device.

import { services, unwrap } from './services';

export const speech = {
  /** The text of a recording; `filename`'s extension tells shared its type. */
  async transcribe(audio: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.append('audio', audio, filename);
    const { transcript } = await unwrap(
      services.shared.POST('/api/v1/speech/transcriptions', {
        // The form below carries the file; this only satisfies the generated type.
        body: { audio: filename },
        bodySerializer: () => form,
      }),
    );
    return transcript;
  },
};

/** What voice input shows for a refusal, matched on `detail.code`. */
export const SPEECH_ERRORS: Record<string, string> = {
  audio_too_large: 'That recording is too long. Please try a shorter one.',
  unsupported_audio_type: 'That recording format isn’t supported. Please try again.',
  transcription_unavailable: 'Transcription failed. Please try again.',
  transcription_not_configured: 'Voice input isn’t available right now.',
  parents_only: 'Voice input is for parents’ accounts.',
};
