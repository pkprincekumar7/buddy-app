/**
 * Connect's wins in child view (docs/child-view-build-plan.md, 4.1): what the child has done,
 * from their own activity (2.1), quests (3.1) and world runs (3.4), newest kinds first. Shared
 * by both apps. Each win's `key` is what "Show my grown-up" keeps (children's `show_win`).
 */
import type { KidActivity } from '@/api/kids';
import type { KidQuests } from '@/api/kidQuests';
import type { KidWorlds } from '@/api/kidWorlds';
import { questKey } from '@/api/kidQuests';
import { bandFor } from '@/api/kidWorlds';
import { moodStreak } from '@/lib/kidsDay';

export type WinKind = 'badge' | 'quest' | 'world' | 'streak' | 'powers';
export interface Win {
  key: string;
  kind: WinKind;
  title: string;
}

/** A streak worth a win. */
export const STREAK_WIN = 3;

export function winsFrom({
  activity,
  quests,
  worlds,
  day,
}: {
  activity: KidActivity;
  quests: KidQuests | null;
  worlds: KidWorlds | null;
  day: string;
}): Win[] {
  const wins: Win[] = [];
  for (const interest of quests?.catalog ?? []) {
    interest.quests.forEach((q, i) => {
      if ((quests?.logs[questKey(interest.key, i)] ?? 0) >= q.target) {
        wins.push({
          key: `quest:${interest.key}:${i}`,
          kind: 'quest',
          title: `Quest done: ${q.title}`,
        });
      }
    });
  }
  worlds?.worlds.forEach((w, i) => {
    const runs = worlds.runs[String(i)] ?? [];
    const best = runs.reduce((top, r) => Math.max(top, r.total), -1);
    if (best < 0) return;
    const band = bandFor(best, worlds.bands);
    wins.push({
      key: `world:${i}`,
      kind: 'world',
      title: band?.color === 'gold' ? `Super strong in ${w.name}` : `Played the ${w.name} world`,
    });
  });
  if (activity.discover_badge) {
    wins.push({ key: 'badge:discover', kind: 'badge', title: 'Discover badge unlocked' });
  } else if (activity.flipped_powers.length >= 3) {
    wins.push({
      key: 'powers:open',
      kind: 'powers',
      title: `Opened ${activity.flipped_powers.length} superpowers`,
    });
  }
  const streak = moodStreak(activity.moods, day);
  if (streak >= STREAK_WIN) {
    wins.push({ key: `streak:${streak}`, kind: 'streak', title: `${streak}-day check-in streak` });
  }
  return wins;
}
