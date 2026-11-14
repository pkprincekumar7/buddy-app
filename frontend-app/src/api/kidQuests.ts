// The child's Transform quests in child view (docs/child-view-build-plan.md, 3.1 and 3.2),
// through the generated transform client. Transform keeps the counts; the star for a quest's
// first log is children's (`quest` on api/kids).

import type { components } from './generated/transform';
import { services, unwrap } from './services';

type Schemas = components['schemas'];

export type KidQuests = Schemas['KidQuests'];
export type QuestInterestKey = Schemas['CurrentIn']['interest'];
export type QuestInterest = Schemas['QuestInterestView'];

const at = (id: string, day: string) => ({
  params: { path: { id }, query: { date: day } },
});

export const kidQuests = {
  get: (childId: string, day: string): Promise<KidQuests> =>
    unwrap(
      services.transform.GET(
        '/api/v1/children/{id}/transform/quests',
        at(childId, day),
      ),
    ),
  /** Shows an interest's quests; one the plan doesn't name is added to the child's. */
  pick: (
    childId: string,
    day: string,
    interest: QuestInterestKey,
  ): Promise<KidQuests> =>
    unwrap(
      services.transform.PUT('/api/v1/children/{id}/transform/quests/current', {
        ...at(childId, day),
        body: { interest },
      }),
    ),
  /** +1 for a quest today (once a day, up to its target). */
  log: (
    childId: string,
    day: string,
    interest: QuestInterestKey,
    quest: number,
  ): Promise<KidQuests> =>
    unwrap(
      services.transform.POST('/api/v1/children/{id}/transform/quests/log', {
        ...at(childId, day),
        body: { interest, quest },
      }),
    ),
};

/** What the Transform tab shows for a refusal, matched on `detail.code`. */
export const QUEST_ERRORS: Record<string, string> = {
  circle_locked: 'This one opens later. Keep going!',
  bad_date: "Your device's date looks wrong. Please check it.",
  interest_not_picked: 'Pick this one first.',
};

/** The child's interests in order: the plan's first ("From your parent"), then their own. */
export function myInterests(q: KidQuests): QuestInterestKey[] {
  const out: QuestInterestKey[] = q.default_interest
    ? [q.default_interest]
    : [];
  for (const k of q.interests) if (!out.includes(k)) out.push(k);
  return out;
}

/** The interest on screen: the stored one if it's still the child's, else the first. */
export function currentInterest(q: KidQuests): QuestInterestKey | null {
  const mine = myInterests(q);
  return q.current && mine.includes(q.current) ? q.current : mine[0] ?? null;
}

export const questKey = (interest: QuestInterestKey, quest: number) =>
  `${interest}:${quest}`;

/** One quest in the parent's summary: how far the child is and when they last did it. */
export interface QuestProgress {
  title: string;
  count: number;
  target: number;
  /** The child's day of the last log, YYYY-MM-DD; null before the first. */
  lastLogged: string | null;
  /** What to do (shown until the first log). */
  how: string;
}

/**
 * What the parent's Life Pathway shows of the child's quests (3.3): the plan's interest, then
 * any the child added and logged, each with its quests. Empty when nothing is to show.
 */
export function questSummary(q: KidQuests): {
  key: QuestInterestKey;
  label: string;
  fromParent: boolean;
  quests: QuestProgress[];
}[] {
  return myInterests(q)
    .map(key => {
      const interest = q.catalog.find(c => c.key === key);
      if (!interest) return null;
      const quests = interest.quests.map((quest, i) => {
        const k = questKey(key, i);
        return {
          title: quest.title,
          count: Math.min(q.logs[k] ?? 0, quest.target),
          target: quest.target,
          lastLogged: q.last_logged[k] ?? null,
          how: quest.how,
        };
      });
      const fromParent = key === q.default_interest;
      return fromParent || quests.some(p => p.count > 0)
        ? { key, label: interest.label, fromParent, quests }
        : null;
    })
    .filter(s => s !== null);
}

/** Whether the child has logged any quest at all. */
export const anyLogged = (q: KidQuests) =>
  Object.values(q.logs).some(n => n > 0);

/** "12 Nov" for a YYYY-MM-DD day, read as that calendar day (no time zone shift). */
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

/** "today", "yesterday" or "N days ago" for a YYYY-MM-DD day, against `today` (YYYY-MM-DD). */
export function daysAgo(day: string, today: string): string {
  const utc = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1);
  };
  const n = Math.round((utc(today) - utc(day)) / 86_400_000);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

/** An interest's totals on the parent's page: times logged, quests finished, and how many. */
export function questTotals(quests: QuestProgress[]): {
  logged: number;
  finished: number;
  total: number;
} {
  return {
    logged: quests.reduce((n, q) => n + q.count, 0),
    finished: quests.filter(q => q.count >= q.target).length,
    total: quests.length,
  };
}
