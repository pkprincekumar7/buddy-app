/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface Window {
  webkitSpeechRecognition: {
    new (): {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onstart: ((this: unknown, ev: Event) => void) | null;
      onresult: ((this: unknown, ev: Event) => void) | null;
      onerror: ((this: unknown, ev: Event) => void) | null;
      onend: ((this: unknown, ev: Event) => void) | null;
      start(): void;
      stop(): void;
      abort(): void;
    };
  };
}
