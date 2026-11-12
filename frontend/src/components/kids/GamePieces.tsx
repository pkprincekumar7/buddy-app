import type { ReactNode } from 'react';

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

export function Sky() {
  return SKY.map(([x, y]) => (
    <span
      key={`${x}-${y}`}
      aria-hidden="true"
      className="kids-game-sky"
      style={{ left: `${x}%`, top: `${y}%` }}
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
      <span className="kids-game-hud left-[6%] text-kids-text">{left}</span>
      <span className="kids-game-hud right-[6%] text-kids-streak">{right}</span>
    </>
  );
}
