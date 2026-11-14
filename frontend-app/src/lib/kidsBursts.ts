/** A ring that grows and fades where a thing was hit in a kids mini game: gold by default,
 * red for a wrong catch, cyan for Discover's climb and energy (drawn by
 * components/kids/GamePieces' Bursts). */
export type BurstTone = 'gold' | 'wrong' | 'cyan';

export interface Burst {
  key: number;
  x: number;
  y: number;
  tone: BurstTone;
}

/** The last four bursts and a new one at (x%, y%). */
export const addBurst = (
  list: Burst[],
  x: number,
  y: number,
  tone: BurstTone = 'gold',
): Burst[] => [
  ...list.slice(-3),
  { key: Date.now() + Math.random(), x, y, tone },
];
