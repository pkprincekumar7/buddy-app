import { localDay, moodStreak, previousDay } from '@/lib/kidsDay';
import { parentStreakLine, recentMoodDays, streakLine } from '@/lib/kidsMoods';
import { areaOpen } from '@/lib/kidsAreas';
import type { Child } from '@/api/children';

describe('the child day', () => {
  it('is the local date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
  it('steps back across month and year ends', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('the mood streak', () => {
  const moods = (...days: string[]) =>
    Object.fromEntries(days.map(d => [d, { mood: 'good', note: null }]));

  it('counts consecutive days ending today', () => {
    expect(
      moodStreak(moods('2026-11-11', '2026-11-10', '2026-11-09'), '2026-11-11'),
    ).toBe(3);
  });
  it("isn't broken until today is over", () => {
    expect(moodStreak(moods('2026-11-10', '2026-11-09'), '2026-11-11')).toBe(2);
  });
  it('stops at the first missed day, and starts at none', () => {
    expect(moodStreak(moods('2026-11-11', '2026-11-09'), '2026-11-11')).toBe(1);
    expect(moodStreak({}, '2026-11-11')).toBe(0);
    expect(streakLine(0)).toBe('Check in today to start a streak');
    expect(streakLine(4)).toBe('4-day streak');
  });
});

describe('the open circles', () => {
  const progress = (done: string[]) =>
    Object.fromEntries(
      [
        'profile',
        'conversation',
        'discover',
        'grow',
        'transform',
        'release',
        'connect',
      ].map(f => [f, done.includes(f)]),
    ) as Child['progress'];

  const done = (circles: string[]) => ({
    discover: circles.includes('discover'),
    grow: circles.includes('grow'),
    transform: circles.includes('transform'),
    release: circles.includes('release'),
    connect: circles.includes('connect'),
  });

  it("follow child view's own order, not the parent's progress", () => {
    const parentDone = progress([
      'profile',
      'conversation',
      'discover',
      'grow',
      'transform',
    ]);
    expect(areaOpen('discover', parentDone, done([]))).toBe(true);
    expect(areaOpen('grow', parentDone, done([]))).toBe(false);
    expect(areaOpen('grow', parentDone, done(['discover']))).toBe(true);
    expect(areaOpen('transform', parentDone, done(['discover']))).toBe(false);
    expect(areaOpen('transform', parentDone, done(['discover', 'grow']))).toBe(
      true,
    );
    expect(
      areaOpen('release', parentDone, done(['discover', 'grow', 'transform'])),
    ).toBe(true);
    expect(
      areaOpen('connect', parentDone, done(['discover', 'grow', 'transform'])),
    ).toBe(false);
    // Skipping a circle opens nothing after it.
    expect(areaOpen('transform', parentDone, done(['grow']))).toBe(false);
  });

  it('opens nothing before the chat, or without the activity yet', () => {
    const everything = done([
      'discover',
      'grow',
      'transform',
      'release',
      'connect',
    ]);
    expect(areaOpen('discover', progress(['profile']), everything)).toBe(false);
    expect(areaOpen('grow', progress(['profile']), everything)).toBe(false);
    expect(areaOpen('grow', progress(['conversation']), null)).toBe(false);
  });
});

describe('recentMoodDays', () => {
  it('lists the last days oldest first, across a month end, with only the mood', () => {
    const days = recentMoodDays(
      {
        '2026-11-02': { mood: 'good', note: 'private' },
        '2026-10-31': { mood: 'low' },
      } as Record<string, { mood: string }>,
      '2026-11-02',
      3,
    );
    expect(days).toEqual([
      { day: '2026-10-31', mood: 'low' },
      { day: '2026-11-01', mood: null },
      { day: '2026-11-02', mood: 'good' },
    ]);
  });

  it('ignores a mood it does not know', () => {
    expect(
      recentMoodDays({ '2026-11-02': { mood: 'meh' } }, '2026-11-02', 1),
    ).toEqual([{ day: '2026-11-02', mood: null }]);
  });
});

describe('parentStreakLine', () => {
  it('names the child when there is a streak', () => {
    expect(parentStreakLine(3, 'Rahul')).toBe('Rahul is on a 3-day streak');
    expect(parentStreakLine(0, 'Rahul')).toBe('No check-in streak right now');
  });
});
