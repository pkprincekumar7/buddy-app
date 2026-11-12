import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { KidPower } from '@/api/discover';
import { GAME_PLAY, bestNote, gameSeconds, winLine } from '@/lib/kidsGames';
import { POWER_ICONS } from '@/components/kids/icons';
import KidsGame from '@/components/kids/KidsGames';

/** How long the finished game stays on screen before "You did it!". */
const WIN_PAUSE_MS = 500;

interface GameDialogProps {
  power: KidPower;
  /** The saved best time for this game, if any. */
  best: number | undefined;
  onClose: () => void;
  /** A finished round's time; the page saves it when it's a new best. */
  onFinish: (seconds: number) => void;
}

/**
 * A power's mini game (docs/child-view-build-plan.md, 2.6), over the kids page: the game, then
 * the time with "New best!" or the best so far, and "Play again". Escape or × closes it.
 */
export default function GameDialog({ power, best, onClose, onFinish }: GameDialogProps) {
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<{ secs: number; previous: number | undefined } | null>(null);
  const startedAt = useRef(Date.now());
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pause.current), []);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pressedBackdrop = useRef(false);

  // The page passes a new onClose on every render; read the latest one, so a re-render
  // mid-game doesn't run this again and pull focus back to ×.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const win = () => {
    const secs = gameSeconds(startedAt.current, Date.now());
    const previous = best;
    if (bestNote(secs, previous).isBest) onFinish(secs);
    pause.current = setTimeout(() => setResult({ secs, previous }), WIN_PAUSE_MS);
  };

  const again = () => {
    startedAt.current = Date.now();
    setResult(null);
    setRound((r) => r + 1);
  };

  const note = result ? bestNote(result.secs, result.previous) : null;

  return (
    <div
      className="kids-dialog-backdrop"
      // Closes only for a press that started on the backdrop itself: the click that opened
      // the game, or a drag out of the game, never closes it.
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kids-game-title"
        className="kids-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-7 w-7 stroke-kids-discover"
          >
            <path d={POWER_ICONS[power.game]} />
          </svg>
          <h2
            id="kids-game-title"
            className="flex-1 font-orbitron text-2xl font-bold text-kids-text"
          >
            {power.name}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="kids-btn-off flex h-11 w-11 items-center justify-center"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {result && note ? (
          <div className="py-4 text-center" role="status">
            <p className="font-orbitron text-3xl font-bold text-kids-text">You did it!</p>
            <p className="mt-3 flex items-baseline justify-center gap-2 text-kids-streak">
              <span className="font-orbitron text-5xl font-bold">{result.secs.toFixed(1)}</span>
              <span className="text-xl font-bold uppercase tracking-[0.18em]">sec</span>
            </p>
            <p className="mt-2 text-xl font-bold text-kids-teal">{note.text}</p>
            <p className="mt-3 text-xl font-semibold text-kids-body">
              {winLine(power.game, result.secs)}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={again} className="kids-btn h-14 px-8 text-lg">
                Play again
              </button>
              <button type="button" onClick={onClose} className="kids-btn-off h-14 px-8 text-lg">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="my-4 text-xl font-bold leading-snug text-kids-body">
              {GAME_PLAY[power.game]}
            </p>
            <KidsGame key={round} game={power.game} onWin={win} />
          </>
        )}
      </div>
    </div>
  );
}
