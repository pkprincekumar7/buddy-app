/**
 * Phase-2 constellation geometry — the web DimensionCirclesScreen's mobile
 * (`max-width: 639px`) values, in its 700×700 ring box coordinates.
 */

// The circle the hub's glowing spoke + traveling dots point to — the next
// step in the Discover → Grow → Transform → Release → Connect flow the user
// hasn't reached yet, so the animation always leads toward the frontier
// circle instead of staying pinned on Discover. null once every step —
// including Connect — has been visited, so nothing is pointed at.
export type ActiveDimension =
  | 'discover'
  | 'grow'
  | 'transform'
  | 'release'
  | 'connect'
  | null;

export type SpokeKey =
  | 'connect'
  | 'transform'
  | 'release'
  | 'grow'
  | 'startAgain'
  | 'discover';

/** Spoke end points — web `SP` (mobile): `M350 350 L{x} {y}`. */
export const SPOKE_END: Record<SpokeKey, { x: number; y: number }> = {
  connect: { x: 177, y: 250 },
  transform: { x: 523, y: 250 },
  release: { x: 523, y: 450 },
  grow: { x: 177, y: 450 },
  startAgain: { x: 350, y: 550 },
  discover: { x: 350, y: 150 },
};

/** Spoke stroke-dasharray / initial dashoffset — web `SD` (mobile) and `spokeDrawSm`. */
export const SPOKE_DASH = 200;

const pct = (p: number) => (p / 100) * 700;
/** Node centers — web `NP` (mobile) percentages of the 700px box. */
export const NODE_CENTER: Record<SpokeKey, { x: number; y: number }> = {
  connect: { x: pct(25.27), y: pct(35.71) },
  discover: { x: pct(50), y: pct(21.43) },
  transform: { x: pct(74.73), y: pct(35.71) },
  release: { x: pct(74.73), y: pct(64.29) },
  grow: { x: pct(25.27), y: pct(64.29) },
  startAgain: { x: pct(50), y: pct(78.57) },
};

/** web `watchRing` (mobile): `Math.min(width / 488, height / 560, 1)`. */
export function ringScaleFor(width: number, height: number): number {
  if (!width || !height) return 1;
  return Math.min(width / 488, height / 560, 1);
}
