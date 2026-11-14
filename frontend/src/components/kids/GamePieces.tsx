import type { CSSProperties, ReactNode } from 'react';
import type { Burst } from '@/lib/kidsBursts';
import { cn } from '@/lib/utils';

/**
 * The pieces every kids mini game draws (Discover's, 2.6, and Grow's, 3.5): the night sky,
 * the progress bar along the top, and the two corner readouts. Colours are .kids-game-*.
 */

const SKY = [
  [12, 20],
  [80, 14],
  [66, 80],
  [20, 72],
  [44, 30],
  [88, 52],
  [8, 48],
] as const;

/** The sky's seven stars, each twinkling at its own pace (1.4 s, then .3 s slower each). */
export function Sky() {
  return SKY.map(([x, y], i) => (
    <span
      key={`${x}-${y}`}
      aria-hidden="true"
      className="kids-game-sky"
      style={{ left: `${x}%`, top: `${y}%`, '--twinkle': `${1.4 + i * 0.3}s` } as CSSProperties}
    />
  ));
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="kids-game-bar" aria-hidden="true">
      <div
        className="kids-game-bar-fill"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

/** The score (left, light) and the time or count (right, gold) under the bar. */
export function Hud({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <>
      <span className="kids-game-hud left-[6%]">{left}</span>
      <span className="kids-game-hud kids-game-hud-gold right-[6%]">{right}</span>
    </>
  );
}

/** The bursts (lib/kidsBursts) in the frame. */
export function Bursts({ list }: { list: Burst[] }) {
  return list.map((b) => (
    <span
      key={b.key}
      aria-hidden="true"
      className={cn('kids-game-burst', b.wrong && 'kids-game-burst-wrong')}
      style={{ left: `${b.x}%`, top: `${b.y}%` }}
    />
  ));
}
