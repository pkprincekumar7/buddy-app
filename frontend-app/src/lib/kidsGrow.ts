/**
 * Grow's seven game types in child view (docs/child-view-build-plan.md, 3.5): the rules and
 * the scoring, shared by both apps (the prototype's). Each game's view only draws its state
 * and calls these; a game ends once with a score from 0 to 100 and a line saying how it went.
 *
 * Positions are percent of the game's square box; `rand` is Math.random (a test passes its own).
 */

export type Rand = () => number;
export interface GrowResult {
  score: number;
  line: string;
}

export const clampScore = (v: number) =>
  Math.max(0, Math.min(100, Math.round(v)));
const between = (rand: Rand, a: number, b: number) => a + rand() * (b - a);

// ── catch: move the basket, catch the good ones ────────────────────────────────

export const CATCH_SECONDS = 20;
export const CATCH_TICK_MS = 40;
const CATCH_MAX = 5;
/** A falling word: `good` is whether to catch it. */
export interface Falling {
  id: number;
  x: number;
  y: number;
  speed: number;
  label: string;
  good: boolean;
}
export interface CatchCfg {
  good?: string[];
  bad?: string[];
  rule?: 'even';
  max?: number;
}
export interface CatchTally {
  caught: number;
  oops: number;
  missed: number;
}
/** The next word to fall: a good one two times in three, or a number for the `even` rule. */
export function catchWord(
  cfg: CatchCfg,
  rand: Rand = Math.random,
): { label: string; good: boolean } {
  if (cfg.rule === 'even') {
    const n = 1 + Math.floor(rand() * (cfg.max ?? 30));
    return { label: String(n), good: n % 2 === 0 };
  }
  const good = cfg.good ?? [];
  const bad = cfg.bad ?? [];
  const pickGood = rand() < 0.66 || bad.length === 0;
  const list = pickGood ? good : bad;
  return {
    label: list[Math.floor(rand() * list.length)] ?? '',
    good: pickGood,
  };
}
/** One tick: the words fall; one at the basket (`basketX`) is caught, one off the bottom gone. */
export function catchTick(
  items: readonly Falling[],
  basketX: number,
  tally: CatchTally,
  nextId: number,
  cfg: CatchCfg,
  rand: Rand = Math.random,
): { items: Falling[]; tally: CatchTally; nextId: number; hits: Falling[] } {
  const keep: Falling[] = [];
  const hits: Falling[] = [];
  const next = { ...tally };
  for (const old of items) {
    const it = { ...old, y: old.y + old.speed };
    if (it.y >= 80 && it.y < 92 && Math.abs(it.x - basketX) < 14) {
      if (it.good) next.caught += 1;
      else next.oops += 1;
      hits.push(it);
    } else if (it.y > 104) {
      if (it.good) next.missed += 1;
    } else keep.push(it);
  }
  let id = nextId;
  if (rand() < 0.055 && keep.length < CATCH_MAX) {
    const word = catchWord(cfg, rand);
    keep.push({
      id: id++,
      x: between(rand, 14, 86),
      y: -6,
      speed: between(rand, 0.9, 1.4),
      ...word,
    });
  }
  return { items: keep, tally: next, nextId: id, hits };
}
export function catchResult(t: CatchTally): GrowResult {
  return {
    score: clampScore(
      (100 * (t.caught - t.oops)) / Math.max(1, t.caught + t.missed),
    ),
    line: `${t.caught} caught, ${t.oops} oops, ${t.missed} missed`,
  };
}

// ── sort: pick a side for each card ────────────────────────────────────────────

export const SORT_CARDS = 8;
export const SORT_PAUSE_MS = 520;
export interface SortItem {
  text: string;
  right: boolean;
}
/** The cards for one round: `n` of them, shuffled. */
export function sortCards(
  items: readonly SortItem[],
  rand: Rand = Math.random,
  n = SORT_CARDS,
) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as SortItem, out[i] as SortItem];
  }
  return out.slice(0, n);
}
/** Right answers, scaled down a little for slow ones (to 75% at 2.4 s a card and over). */
export function sortResult(
  right: number,
  total: number,
  msEach: readonly number[],
): GrowResult {
  const avg = msEach.length
    ? msEach.reduce((a, b) => a + b, 0) / msEach.length
    : 0;
  const speed = Math.max(0.75, Math.min(1, 1.15 - avg / 6000));
  return {
    score: clampScore(((100 * right) / Math.max(1, total)) * speed),
    line: `${right} of ${total} right, ${(avg / 1000).toFixed(1)}s each`,
  };
}

// ── memory: repeat the pattern ─────────────────────────────────────────────────

export const MEMORY_TOP = 8;
export const MEMORY_LIVES = 2;
export const MEMORY_START = 2;
export const MEMORY_LIT_MS = 460;
export const MEMORY_GAP_MS = 200;
/** The pattern grown to `length` (it keeps what it had: each level adds one). */
export function growPattern(
  pattern: readonly number[],
  length: number,
  rand: Rand = Math.random,
) {
  const out = [...pattern];
  while (out.length < length) out.push(Math.floor(rand() * 4));
  return out;
}
export function memoryResult(best: number): GrowResult {
  return {
    score: clampScore((best / MEMORY_TOP) * 100),
    line: `Remembered ${best} in a row`,
  };
}

// ── timing: tap when the rings meet ────────────────────────────────────────────

export type Beat = 'perfect' | 'good' | 'miss';
export const TIMING_LEAD_MS = 900;
export const TIMING_GAP_MS = 380;
/** A tap `ms` into a beat of `per` ms: the rings meet at `per`. */
export function judgeBeat(ms: number, per: number): Beat | null {
  if (ms / per < 0.15) return null; // too early to count
  const off = Math.abs(ms - per);
  return off < 110 ? 'perfect' : off < 260 ? 'good' : 'miss';
}
/** Whether a beat has gone by untapped. */
export const beatMissed = (ms: number, per: number) => ms / per > 1.3;
/** The shrinking ring's size, percent of the box, `ms` into a beat. */
export const ringSize = (ms: number, per: number) =>
  26 + Math.max(0, 1 - Math.max(0, ms) / per) * 60;
export function timingResult(
  beats: readonly Beat[],
  total: number,
): GrowResult {
  const perfect = beats.filter(b => b === 'perfect').length;
  const good = beats.filter(b => b === 'good').length;
  return {
    score: clampScore((100 * (perfect + 0.6 * good)) / Math.max(1, total)),
    line: `${perfect} perfect, ${good} good, ${total - perfect - good} missed`,
  };
}

// ── dash: tap the ones you like as they fly past ───────────────────────────────

export const DASH_SECONDS = 20;
export const DASH_TICK_MS = 40;
const DASH_MAX = 6;
export interface DashItem {
  text: string;
  kind: string;
}
export interface Flying extends DashItem {
  id: number;
  x: number;
  y: number;
  speed: number;
  phase: number;
}
/** One tick: the words drift across; gone ones leave; sometimes one comes in from a side. */
export function dashTick(
  items: readonly Flying[],
  pool: readonly DashItem[],
  nextId: number,
  rand: Rand = Math.random,
): { items: Flying[]; nextId: number } {
  let next = items
    .map(o => ({
      ...o,
      x: o.x + o.speed,
      y: o.y + Math.sin((o.x + o.phase) / 9) * 0.25,
    }))
    .filter(o => o.x > -20 && o.x < 120);
  let id = nextId;
  if (rand() < 0.06 && next.length < DASH_MAX && pool.length) {
    const it = pool[Math.floor(rand() * pool.length)] as DashItem;
    const fromLeft = rand() < 0.5;
    next = [
      ...next,
      {
        ...it,
        id: id++,
        x: fromLeft ? -14 : 114,
        y: between(rand, 22, 78),
        speed: (fromLeft ? 1 : -1) * between(rand, 0.45, 0.8),
        phase: between(rand, 0, 40),
      },
    ];
  }
  return { items: next, nextId: id };
}
export function dashResult(picked: readonly DashItem[]): GrowResult {
  const kinds = new Set(picked.map(p => p.kind)).size;
  return {
    score: clampScore(picked.length * 7 + kinds * 8),
    line: `${picked.length} picked, ${kinds} kinds`,
  };
}

// ── react: tap the light as soon as it shows ───────────────────────────────────

export const REACT_WAIT_MIN_MS = 900;
export const REACT_WAIT_MAX_MS = 2300;
export const reactWait = (rand: Rand = Math.random) =>
  between(rand, REACT_WAIT_MIN_MS, REACT_WAIT_MAX_MS);
export const reactSpot = (rand: Rand = Math.random) => ({
  x: between(rand, 20, 80),
  y: between(rand, 24, 76),
});
export function reactResult(
  times: readonly number[],
  early: number,
): GrowResult {
  const avg = times.length
    ? times.reduce((a, b) => a + b, 0) / times.length
    : 0;
  return {
    score: clampScore(100 - (avg - 320) / 5 - early * 5),
    line: `Average ${(avg / 1000).toFixed(2)}s${
      early ? `, ${early} too soon` : ''
    }`,
  };
}

// ── spark: paint the sky in colours ────────────────────────────────────────────

export const SPARK_SECONDS = 15;
/** The colours strokes cycle through (kids palette names). */
export const SPARK_COLORS = [
  'transform',
  'discover',
  'teal',
  'release',
  'connect',
] as const;
/** The sky's 10×10 cell a point lights. */
export const sparkCell = (p: { x: number; y: number }) =>
  p.x >= 0 && p.x < 100 && p.y >= 0 && p.y < 100
    ? `${Math.floor(p.x / 10)},${Math.floor(p.y / 10)}`
    : null;
export function sparkResult(cellsLit: number, strokes: number): GrowResult {
  const colours = Math.min(SPARK_COLORS.length, strokes);
  return {
    score: clampScore(cellsLit * 1.25 + colours * 2),
    line: `Lit ${cellsLit}% of the sky with ${colours} colours`,
  };
}
