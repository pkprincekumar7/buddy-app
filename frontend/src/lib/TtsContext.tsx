import {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';

interface TtsContextValue {
  ttsEnabled: boolean;
  toggleTts: () => void;
}

const TtsContext = createContext<TtsContextValue | null>(null);

/**
 * Split out of AuthContext: ttsEnabled toggles on every voice-mute tap, and
 * previously lived in the same context value as session/user state. Every
 * consumer that only needed `user`/`isAuthenticated` (most of the app) was
 * re-rendering on each toggle purely because they shared one memoized object.
 * Must be nested inside AuthProvider — it reads isAuthenticated from it to
 * reset/reload the preference around login and logout.
 */
export const TtsProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);

  // Keep ref in sync so toggleTts never captures a stale value
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  // Load tts_enabled from DB after login; reset to true on logout
  useEffect(() => {
    if (!isAuthenticated) {
      setTtsEnabled(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const prefs = (await api.preferences.get()) as { tts_enabled?: boolean };
        if (!cancelled && typeof prefs.tts_enabled === 'boolean') setTtsEnabled(prefs.tts_enabled);
      } catch (err) {
        console.warn('[TtsContext] Could not load TTS preference:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const toggleTts = useCallback(() => {
    const next = !ttsEnabledRef.current;
    setTtsEnabled(next);
    api.preferences.patch({ tts_enabled: next }).catch((err) => {
      console.warn('[TtsContext] Could not persist TTS toggle:', err);
    });
  }, []);

  const contextValue = useMemo(() => ({ ttsEnabled, toggleTts }), [ttsEnabled, toggleTts]);

  return <TtsContext.Provider value={contextValue}>{children}</TtsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTts = (): TtsContextValue => {
  const context = useContext(TtsContext);
  if (!context) {
    throw new Error('useTts must be used within a TtsProvider');
  }
  return context;
};
