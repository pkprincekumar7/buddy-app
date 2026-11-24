// The child's Grow worlds in child view (docs/child-view-build-plan.md, 3.4 and 3.5), through
// the generated grow client: the six worlds, their games and the score bands are grow's data;
// a finished world is saved as a run (its three scores), and grow keeps the last 10 per world.

import type { components } from './generated/grow';
import { services, unwrap } from './services';

type Schemas = components['schemas'];

export type KidWorlds = Schemas['Worlds'];
export type KidWorld = Schemas['World'];
export type KidWorldGame = Schemas['WorldGame'];
export type ScoreBand = Schemas['Band'];
export type WorldRun = Schemas['WorldRun'];
export type GrowGameType = KidWorldGame['type'];

const byId = (id: string) => ({ params: { path: { id } } });

export const kidWorlds = {
  get: (childId: string): Promise<KidWorlds> =>
    unwrap(
      services.grow.GET(
        '/api/v1/children/{id}/growth-areas/worlds',
        byId(childId),
      ),
    ),
  /** A finished world: its three games' scores, 0 to 100. */
  addRun: (
    childId: string,
    world: number,
    scores: number[],
  ): Promise<KidWorlds> =>
    unwrap(
      services.grow.POST(
        '/api/v1/children/{id}/growth-areas/worlds/{world}/runs',
        {
          params: { path: { id: childId, world } },
          body: { scores },
        },
      ),
    ),
};

/** The band a score falls in (grow sends them highest first). */
export function bandFor(
  score: number,
  bands: readonly ScoreBand[],
): ScoreBand | null {
  return bands.find(b => score >= b.min) ?? bands[bands.length - 1] ?? null;
}

/** A band's colour as a kids palette name (index.css --kids-*). */
export const BAND_COLOR = {
  gold: 'transform',
  cyan: 'discover',
  violet: 'release',
} as const;

/** A world's runs, oldest first. */
export const runsOf = (worlds: KidWorlds, world: number): WorldRun[] =>
  worlds.runs[String(world)] ?? [];

/** The games of a run ordered best first: for "strongest" and "keep practising". */
export function rankedGames(scores: readonly number[]): number[] {
  return scores
    .map((_, i) => i)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
}

/** How the new total compares with the run before it. */
export function trendLine(total: number, previous: number | null): string {
  if (previous === null) return 'First report for this world';
  if (total > previous) return `Up ${total - previous} since last time!`;
  if (total === previous) return 'Same as last time';
  return `${previous - total} lower than last time. Try again!`;
}

/** What the parent's Growth page shows of a world (3.6): the child's latest run of it. */
export interface WorldSummary {
  name: string;
  total: number;
  /** When the latest run was played (ISO). */
  at: string;
  tries: number;
  /** Change since the run before; null for the first. */
  change: number | null;
  rows: {
    skill: string;
    title: string;
    score: number;
    band: ScoreBand | null;
  }[];
}

/** The world named `name` (a growth area's), summarised; null until the child plays it. */
export function worldSummary(
  worlds: KidWorlds,
  name: string,
): WorldSummary | null {
  const index = worlds.worlds.findIndex(w => w.name === name);
  const world = worlds.worlds[index];
  const runs = runsOf(worlds, index);
  const last = runs[runs.length - 1];
  if (!world || !last) return null;
  const before = runs[runs.length - 2];
  return {
    name: world.name,
    total: last.total,
    at: last.at,
    tries: runs.length,
    change: before ? last.total - before.total : null,
    rows: world.games.map((g, j) => {
      const score = last.scores[j] ?? 0;
      return {
        skill: g.skill,
        title: g.title,
        score,
        band: bandFor(score, worlds.bands),
      };
    }),
  };
}

/** "today", "yesterday" or "3 days ago", by calendar day. */
export function daysAgo(at: string, now: Date = new Date()): string {
  const then = new Date(at);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
