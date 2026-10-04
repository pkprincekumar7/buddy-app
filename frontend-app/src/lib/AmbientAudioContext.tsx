import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { useLocation } from '@/lib/router';
import { useTts } from '@/lib/TtsContext';

// expo-video's player doubles as an audio-only player (no VideoView needed),
// which keeps this off a second native audio dependency.
const AMBIENT_SRC = require('../../assets/audio/growth-ambient.mp3');
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

const AmbientAudioContext = createContext<AmbientAudioContextValue | null>(
  null,
);

export function AmbientAudioProvider({ children }: { children: ReactNode }) {
  const { ttsEnabled } = useTts();
  const location = useLocation();
  const playerRef = useRef<VideoPlayer | null>(null);
  const [suppressed, setSuppressed] = useState(false);

  const inScope = useMemo(
    () =>
      IN_SCOPE_PREFIXES.some(prefix => location.pathname.startsWith(prefix)),
    [location.pathname],
  );

  // Keyed on [ttsEnabled, inScope, suppressed] rather than the full pathname —
  // moving between in-scope pages leaves all three unchanged, so the same
  // player (and its playback position) survives the navigation.
  useEffect(() => {
    if (!ttsEnabled || !inScope || suppressed) {
      playerRef.current?.pause();
      return;
    }
    const player = playerRef.current ?? createVideoPlayer(AMBIENT_SRC);
    player.loop = true;
    player.volume = AMBIENT_VOLUME;
    player.audioMixingMode = 'mixWithOthers';
    playerRef.current = player;
    player.play();
  }, [ttsEnabled, inScope, suppressed]);

  useEffect(
    () => () => {
      playerRef.current?.release();
      playerRef.current = null;
    },
    [],
  );

  const duck = useCallback((to: number, ms: number) => {
    const p = playerRef.current;
    if (!p) return;
    const from = p.volume;
    const steps = 12;
    let i = 0;
    const id = setInterval(() => {
      i++;
      p.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
      if (i >= steps) clearInterval(id);
    }, ms / steps);
  }, []);

  const value = useMemo(() => ({ duck, setSuppressed }), [duck]);

  return (
    <AmbientAudioContext.Provider value={value}>
      {children}
    </AmbientAudioContext.Provider>
  );
}

export function useAmbientAudio() {
  const ctx = useContext(AmbientAudioContext);
  if (!ctx)
    throw new Error(
      'useAmbientAudio must be used within an AmbientAudioProvider',
    );
  return ctx;
}
