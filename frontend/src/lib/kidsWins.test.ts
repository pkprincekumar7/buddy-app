import { describe, expect, it } from 'vitest';
import type { KidActivity } from '@/api/kids';
import type { KidQuests } from '@/api/kidQuests';
import type { KidWorlds } from '@/api/kidWorlds';
import { streakMilestone, winsFrom } from '@/lib/kidsWins';

const activity = (over: Partial<KidActivity> = {}) =>
  ({ discover_badge: false, flipped_powers: [], moods: {}, ...over }) as unknown as KidActivity;

const quests = {
  catalog: [
    {
      key: 'art',
      quests: [
        { title: 'Paint a cloud', target: 1 },
        { title: 'Draw a pet', target: 3 },
      ],
    },
  ],
  logs: { 'art:0': 1, 'art:1': 2 },
} as unknown as KidQuests;

const worlds = {
  worlds: [{ name: 'Self Care' }, { name: 'Creativity' }, { name: 'Social Skills' }],
  runs: { '0': [{ total: 50 }], '1': [{ total: 30 }, { total: 90 }] },
  bands: [
    { min: 80, label: 'Super strong', color: 'gold' },
    { min: 0, label: 'Keep practising', color: 'violet' },
  ],
} as unknown as KidWorlds;

describe('winsFrom', () => {
  it('lists quests done, then worlds played (gold for a super strong best), then the badge', () => {
    const wins = winsFrom({
      activity: activity({ discover_badge: true }),
      quests,
      worlds,
      day: '2026-11-15',
    });
    expect(wins.map((w) => w.title)).toEqual([
      'Quest done: Paint a cloud',
      'Played the Self Care world',
      'Super strong in Creativity',
      'Discover badge unlocked',
    ]);
    expect(wins.map((w) => w.key)).toEqual(['quest:art:0', 'world:0', 'world:1', 'badge:discover']);
  });

  it('counts opened powers from three until the badge', () => {
    const wins = winsFrom({
      activity: activity({ flipped_powers: [0, 1, 2] }),
      quests: null,
      worlds: null,
      day: '2026-11-15',
    });
    expect(wins).toEqual([{ key: 'powers:open', kind: 'powers', title: 'Opened 3 superpowers' }]);
  });

  it('is shorter without the quests or the worlds (why Connect waits for both)', () => {
    const all = winsFrom({ activity: activity(), quests, worlds, day: '2026-11-15' });
    const noWorlds = winsFrom({ activity: activity(), quests, worlds: null, day: '2026-11-15' });
    expect(noWorlds.length).toBeLessThan(all.length);
  });
});

describe('streakMilestone', () => {
  it('is the longest milestone reached', () => {
    expect([0, 2, 3, 6, 7, 29, 30, 61].map(streakMilestone)).toEqual([0, 0, 3, 3, 7, 14, 30, 60]);
  });
});
