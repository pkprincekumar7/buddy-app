import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, X } from 'lucide-react';
import type { KidPower } from '@/api/discover';
import { GAME_PLAY, bestNote, gameSeconds, winLine } from '@/lib/kidsGames';
import { POWER_ICONS } from '@/components/kids/icons';
import KidsGame from '@/components/kids/KidsGames';
import { cn } from '@/lib/utils';

/** How long the finished game stays on screen before "You did it!". */
const WIN_PAUSE_MS = 500;

/** The four twinkling dots round the win (the prototype's): where, how big, gold or cyan, and
 * their own pace. */
const WIN_DOTS = [
  { at: { left: '12%', top: '10%' }, size: 10, gold: true, secs: 1.2, delay: 0 },
  { at: { right: '14%', top: '18%' }, size: 8, gold: false, secs: 1, delay: 0.3 },
  { at: { left: '22%', top: '46%' }, size: 6, gold: false, secs: 1.4, delay: 0.6 },
  { at: { right: '20%', top: '52%' }, size: 9, gold: true, secs: 1.1, delay: 0.2 },
] as const;

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
  // "New best!" (gold) beats a time from before; a first try is no record yet.
  const newBest = !!note?.isBest && result?.previous !== undefined;

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
        <div className="flex items-center gap-3.5">
          <span className="kids-dialog-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[22px] w-[22px] stroke-kids-discover md:h-[26px] md:w-[26px]"
            >
              <path d={POWER_ICONS[power.game]} />
            </svg>
          </span>
          <h2
            id="kids-game-title"
            className="min-w-0 font-orbitron text-lg font-black tracking-[0.04em] text-kids-world-name md:text-[22px]"
          >
            {power.name}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="kids-dialog-close"
          >
            <X className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        {result && note ? (
          <div className="relative px-1.5 pb-1 pt-3 text-center" role="status">
            {WIN_DOTS.map((d, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={cn('kids-win-dot', d.gold ? 'bg-kids-gold' : 'bg-kids-discover')}
                style={
                  {
                    ...d.at,
                    width: d.size,
                    height: d.size,
                    '--twinkle': `${d.secs}s`,
                    '--twinkle-delay': `${d.delay}s`,
                  } as CSSProperties
                }
              />
            ))}
            <div className="kids-win-medal" aria-hidden="true">
              <Check className="h-9 w-9 md:h-10 md:w-10" strokeWidth={2.6} />
            </div>
            <p className="mt-3 font-orbitron text-2xl font-black text-kids-world-name md:text-[28px]">
              You did it!
            </p>
            <p className="kids-win-time mt-2.5 flex items-baseline justify-center gap-2">
              <span className="font-orbitron text-4xl font-black leading-none md:text-[44px]">
                {result.secs.toFixed(1)}
              </span>
              <span className="font-rajdhani text-base font-bold uppercase tracking-[0.18em] md:text-xl">
                sec
              </span>
            </p>
            <div className="mt-2 flex min-h-[26px] justify-center gap-2">
              <span className={cn('kids-win-pill', newBest && 'kids-win-pill-best')}>
                {note.text}
              </span>
            </div>
            <p className="kids-win-line mt-3">{winLine(power.game, result.secs)}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                onClick={again}
                className="kids-btn-line kids-btn-line-strong h-11 px-5 text-sm md:h-12 md:text-base"
              >
                Play again
              </button>
              <button
                type="button"
                onClick={onClose}
                className="kids-btn-glow h-11 px-6 text-sm md:h-12 md:text-base"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-4 mt-3.5 text-pretty text-[17px] font-bold leading-[1.3] text-kids-heading md:text-[21px]">
              {GAME_PLAY[power.game]}
            </p>
            <KidsGame key={round} game={power.game} onWin={win} />
          </>
        )}
      </div>
    </div>
  );
}
