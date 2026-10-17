import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';

const AMBIENT_SRC = '/growth-ambient.mp3';
const AMBIENT_VOLUME = 0.5;

// The personality-journey flow — the ambient bed plays continuously across
// all of these routes without restarting when the user moves between them.
const IN_SCOPE_PREFIXES = [
  '/PersonalityJourney',
  '/PersonalityProfile',
  '/Connect',
  '/LifePathway',
  '/Observations',
  '/GrowthAreas',
];

interface AmbientAudioContextValue {
  /** Ramps the ambient bed's volume over `ms`, e.g. to duck under a sound effect. */
  duck: (to: number, ms: number) => void;
  /** Pauses (and later resumes) the ambient bed without losing playback position —
   *  for pages that briefly need it silent, e.g. a splash video with its own audio. */
  setSuppressed: (suppressed: boolean) => void;
}

const AmbientAudioContext = createContext<AmbientAudioContextValue | null>(null);

export function AmbientAudioProvider({ children }: { children: ReactNode }) {
  const { ttsEnabled } = useTts();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);

  // A background tab stays silent (same as TTS in Layout.tsx) — otherwise a
  // journey page left open in another tab keeps looping unseen, even after
  // signing out in this one (a logout here never reaches that tab).
  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const inScope = useMemo(
    () => IN_SCOPE_PREFIXES.some((prefix) => location.pathname.startsWith(prefix)),
    [location.pathname],
  );

  // Deliberately keyed on these flags rather than the full pathname —
  // navigating between in-scope pages leaves them all unchanged, so the same
  // Audio element (and its playback position) survives the swap instead of
  // restarting on every route change. isAuthenticated stops it on logout
  // directly, whatever route the sign-out lands on.
  useEffect(() => {
    if (!ttsEnabled || !isAuthenticated || !inScope || suppressed || hidden) {
      audioRef.current?.pause();
      return;
    }
    const audio = audioRef.current ?? new Audio(AMBIENT_SRC);
    audio.loop = true;
    audio.volume = AMBIENT_VOLUME;
    audioRef.current = audio;
    const play = () => void audio.play().catch(() => {});
    play();
    // Autoplay may be blocked until the page has been interacted with; retry on
    // the first pointer event rather than leaving it silently stopped.
    const onPointerDown = () => {
      play();
      document.removeEventListener('pointerdown', onPointerDown);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ttsEnabled, isAuthenticated, inScope, suppressed, hidden]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const duck = useCallback((to: number, ms: number) => {
    const a = audioRef.current;
    if (!a) return;
    const from = a.volume;
    const steps = 12;
    let i = 0;
    const id = setInterval(() => {
      i++;
      a.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
      if (i >= steps) clearInterval(id);
    }, ms / steps);
  }, []);

  const value = useMemo(() => ({ duck, setSuppressed }), [duck]);

  return <AmbientAudioContext.Provider value={value}>{children}</AmbientAudioContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAmbientAudio() {
  const ctx = useContext(AmbientAudioContext);
  if (!ctx) throw new Error('useAmbientAudio must be used within an AmbientAudioProvider');
  return ctx;
}
