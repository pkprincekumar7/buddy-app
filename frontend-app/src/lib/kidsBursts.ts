/** A ring that grows and fades where a thing was hit in a kids mini game: gold, or red for a
 * wrong catch (drawn by components/kids/GamePieces' Bursts). */
export interface Burst {
  key: number;
  x: number;
  y: number;
  wrong?: boolean;
}

/** The last four bursts and a new one at (x%, y%). */
export const addBurst = (
  list: Burst[],
  x: number,
  y: number,
  wrong = false,
): Burst[] => [
  ...list.slice(-3),
  { key: Date.now() + Math.random(), x, y, wrong },
];
