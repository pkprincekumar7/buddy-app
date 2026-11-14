/**
 * Discover's seven mini games (docs/child-view-build-plan.md, 2.6): the rules, shared by both
 * apps. Each game's view only draws its state and calls these; a game ends once, and its time
 * becomes the best time (`game_best`) when it beats the saved one.
 *
 * Positions are percent of the game's square box; `rand` is Math.random (a test passes its own).
 */

export type GameKey =
  | 'focus'
  | 'curious'
  | 'order'
  | 'draw'
  | 'climb'
  | 'voice'
  | 'energy';
export type Rand = () => number;

/** What to do, under the game's name. */
export const GAME_PLAY: Record<GameKey, string> = {
  focus: 'Tap the light 5 times. It moves fast!',
  curious: 'Open the boxes. Find the 3 hidden planets.',
  order: 'Tap the stars in order, 1 to 6.',
  draw: 'Draw with your finger. Fill the sky with light.',
  climb: "Tap fast to climb. Don't stop or you slide!",
  voice: 'Press and hold to make your voice big.',
  energy: 'Pop 10 bubbles before they float away.',
};

/** The line after a win; `{s}` is the time. */
export const GAME_WIN_LINE: Record<GameKey, string> = {
  focus: 'You caught the moving light 5 times in {s} seconds with super Focus!',
  curious:
    "You found all 3 hidden planets in {s} seconds. That's real Curiosity!",
  order:
    'You joined 6 stars in the right order in {s} seconds, all on your own!',
  draw: 'You filled the whole sky with light in {s} seconds. Pure Imagination!',
  climb: 'You climbed to the top in {s} seconds. You never give up!',
  voice: 'You made your voice big and loud in {s} seconds. Brave Voice!',
  energy: 'You popped 10 bubbles in {s} seconds. So much Energy!',
};

/** The server's limits on a best time (children kids.BEST_MIN_SECONDS / BEST_MAX_SECONDS). */
export const BEST_MIN_SECONDS = 0.5;
export const BEST_MAX_SECONDS = 600;

/** A finished game's time, in seconds to one decimal, within what the server keeps. */
export function gameSeconds(startedAt: number, endedAt: number): number {
  const secs = Math.round((endedAt - startedAt) / 100) / 10;
  return Math.min(BEST_MAX_SECONDS, Math.max(BEST_MIN_SECONDS, secs));
}

/** Whether `secs` is a new best over the saved one, and the line under the time. */
export function bestNote(
  secs: number,
  previous: number | undefined,
): { isBest: boolean; text: string } {
  if (previous === undefined) return { isBest: true, text: 'First try!' };
  if (secs < previous) return { isBest: true, text: 'New best!' };
  return { isBest: false, text: `Best: ${previous.toFixed(1)}s` };
}

export const winLine = (game: GameKey, secs: number) =>
  GAME_WIN_LINE[game].replace('{s}', secs.toFixed(1));

// ── focus: catch the moving light ──────────────────────────────────────────────

export const FOCUS_GOAL = 5;
export const FOCUS_MOVE_MS = 1300;
export const focusSpot = (rand: Rand = Math.random) => ({
  x: 16 + rand() * 68,
  y: 22 + rand() * 62,
});

// ── curious: three planets under nine boxes ────────────────────────────────────

export const CURIOUS_BOXES = 9;
export const CURIOUS_GOAL = 3;
/** The three boxes hiding a planet. */
export function hidePlanets(rand: Rand = Math.random): number[] {
  const boxes = Array.from({ length: CURIOUS_BOXES }, (_, i) => i);
  for (let i = boxes.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [boxes[i], boxes[j]] = [boxes[j] as number, boxes[i] as number];
  }
  return boxes.slice(0, CURIOUS_GOAL).sort((a, b) => a - b);
}
export const planetsFound = (planets: number[], opened: ReadonlySet<number>) =>
  planets.filter(p => opened.has(p)).length;

// ── order: tap the stars 1 to 6 ────────────────────────────────────────────────

export const ORDER_STARS: readonly { x: number; y: number }[] = [
  { x: 24, y: 30 },
  { x: 70, y: 24 },
  { x: 50, y: 48 },
  { x: 80, y: 66 },
  { x: 30, y: 72 },
  { x: 58, y: 86 },
];
/** After tapping star `i` with `done` stars joined: the new count, and whether it was wrong. */
export function orderTap(
  done: number,
  i: number,
): { done: number; wrong: boolean } {
  if (i === done) return { done: done + 1, wrong: false };
  return { done, wrong: i > done };
}

// ── draw: fill the sky ─────────────────────────────────────────────────────────

/** How much line fills the sky (percent units of the box). */
export const DRAW_GOAL = 700;
const DRAW_MIN_STEP = 1.2;
const DRAW_POINTS_KEPT = 220;
export interface DrawState {
  points: { x: number; y: number }[];
  length: number;
  /** The last point of the current stroke; null between strokes. */
  last: { x: number; y: number } | null;
}
export const DRAW_START: DrawState = { points: [], length: 0, last: null };
/** The finger moved to `p` (`stroke`: false when a new stroke starts). */
export function drawTo(
  state: DrawState,
  p: { x: number; y: number },
  stroke = true,
): DrawState {
  const last = stroke ? state.last : null;
  if (!last)
    return {
      ...state,
      last: p,
      points: [...state.points, p].slice(-DRAW_POINTS_KEPT),
    };
  const d = Math.hypot(p.x - last.x, p.y - last.y);
  if (d < DRAW_MIN_STEP) return state;
  return {
    points: [...state.points, p].slice(-DRAW_POINTS_KEPT),
    length: state.length + d,
    last: p,
  };
}
export const drawLift = (state: DrawState): DrawState => ({
  ...state,
  last: null,
});
/** The points as an SVG polyline's `points`. */
export const polyline = (points: readonly { x: number; y: number }[]) =>
  points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

// ── climb: tap to climb, slide when you stop ───────────────────────────────────

export const CLIMB_TICK_MS = 60;
export const climbTap = (height: number) => Math.min(100, height + 6);
export const climbSlide = (height: number) =>
  height >= 100 ? 100 : Math.max(0, height - 0.7);
/** The climber's place on the mountain at `height` (0 to 100). */
export function climbSpot(height: number): { x: number; y: number } {
  const t = height / 100;
  return { x: 14 + 36 * t, y: 86 - 66 * t };
}

// ── voice: press and hold (no microphone) ──────────────────────────────────────

export const VOICE_TICK_MS = 40;
export const voiceStep = (level: number, holding: boolean) =>
  level >= 100
    ? 100
    : Math.max(0, Math.min(100, level + (holding ? 1.5 : -1.8)));

// ── energy: pop the rising bubbles ─────────────────────────────────────────────

export const ENERGY_GOAL = 10;
export const ENERGY_TICK_MS = 40;
const ENERGY_MAX_BUBBLES = 7;
export interface Bubble {
  id: number;
  x: number;
  y: number;
  /** Rise per tick, percent. */
  speed: number;
  /** Diameter, percent of the box. */
  size: number;
  /** The sway's phase. */
  phase: number;
}
/** One tick: the bubbles rise and sway, the gone ones leave, sometimes a new one comes. */
export function energyTick(
  bubbles: readonly Bubble[],
  nextId: number,
  rand: Rand = Math.random,
) {
  let next = bubbles
    .map(b => ({
      ...b,
      y: b.y - b.speed,
      x: b.x + Math.sin((b.y + b.phase) / 8) * 0.3,
    }))
    .filter(b => b.y > -12);
  let id = nextId;
  if (rand() < 0.09 && next.length < ENERGY_MAX_BUBBLES) {
    next = [
      ...next,
      {
        id: id++,
        x: 14 + rand() * 72,
        y: 110,
        speed: 0.5 + rand() * 0.4,
        size: 12 + rand() * 6,
        phase: rand() * 50,
      },
    ];
  }
  return { bubbles: next, nextId: id };
}

/** A game's progress, 0 to 1, for the bar along its top. */
export function progress(done: number, goal: number): number {
  return Math.max(0, Math.min(1, done / goal));
}
