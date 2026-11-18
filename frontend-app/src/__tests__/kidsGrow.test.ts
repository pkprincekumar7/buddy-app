import {
  catchResult,
  catchTick,
  catchWord,
  clampScore,
  dashResult,
  dashTick,
  growPattern,
  judgeBeat,
  memoryResult,
  reactResult,
  sortCards,
  sortResult,
  sparkCell,
  sparkResult,
  timingResult,
} from '@/lib/kidsGrow';
import { bandFor, rankedGames, trendLine } from '@/api/kidWorlds';

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe('kidsGrow', () => {
  it('keeps every score between 0 and 100', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(54.5)).toBe(55);
  });

  it('catch: words at the basket are caught, good ones off the bottom missed', () => {
    const tally = { caught: 0, oops: 0, missed: 0 };
    const items = [
      { id: 1, x: 50, y: 80, speed: 1, label: 'Water', good: true },
      { id: 2, x: 52, y: 81, speed: 1, label: 'Candy', good: false },
      { id: 3, x: 10, y: 104, speed: 1, label: 'Fruit', good: true },
    ];
    const next = catchTick(
      items,
      50,
      tally,
      4,
      { good: ['a'], bad: ['b'] },
      () => 0.9,
    );
    expect(next.tally).toEqual({ caught: 1, oops: 1, missed: 1 });
    expect(next.items).toHaveLength(0);
    expect(catchResult({ caught: 6, oops: 1, missed: 2 })).toEqual({
      score: 63,
      line: '6 caught, 1 oops, 2 missed',
    });
    expect(catchWord({ rule: 'even', max: 30 }, () => 0.1)).toEqual({
      label: '4',
      good: true,
    });
  });

  it('sort: right answers, a little less for slow ones', () => {
    expect(sortCards([{ text: 'a', right: true }], () => 0)).toHaveLength(1);
    expect(sortResult(8, 8, [1000, 1000]).score).toBe(98);
    expect(sortResult(8, 8, [6000]).score).toBe(75);
    expect(sortResult(4, 8, [900]).line).toBe('4 of 8 right, 0.9s each');
  });

  it('memory: the pattern grows by one and keeps what it had', () => {
    const two = growPattern([], 2, seq(0.1, 0.9));
    expect(two).toEqual([0, 3]);
    expect(growPattern(two, 3, () => 0.5)).toEqual([0, 3, 2]);
    expect(memoryResult(4)).toEqual({
      score: 50,
      line: 'Remembered 4 in a row',
    });
  });

  it('timing: close to the meeting is perfect, near is good, early is ignored', () => {
    expect(judgeBeat(100, 1300)).toBeNull();
    expect(judgeBeat(1350, 1300)).toBe('perfect');
    expect(judgeBeat(1500, 1300)).toBe('good');
    expect(judgeBeat(1700, 1300)).toBe('miss');
    expect(timingResult(['perfect', 'good', 'miss', 'miss'], 4).score).toBe(40);
  });

  it('dash: more picks and more kinds score higher', () => {
    const drift = dashTick(
      [],
      [{ text: 'Rocket', kind: 'Go' }],
      1,
      seq(0.01, 0, 0.2, 0.3, 0.4, 0.5),
    );
    expect(drift.items[0]?.text).toBe('Rocket');
    expect(
      dashResult([
        { text: 'a', kind: 'x' },
        { text: 'b', kind: 'y' },
      ]),
    ).toEqual({
      score: 30,
      line: '2 picked, 2 kinds',
    });
  });

  it('react and spark', () => {
    expect(reactResult([320, 320], 0).score).toBe(100);
    expect(reactResult([820], 2)).toEqual({
      score: 0,
      line: 'Average 0.82s, 2 too soon',
    });
    expect(sparkCell({ x: 55, y: 99 })).toBe('5,9');
    expect(sparkCell({ x: 100, y: 5 })).toBeNull();
    expect(sparkResult(40, 9).score).toBe(60);
  });

  it('bands, the best game first, and the trend', () => {
    const bands = [
      { min: 80, label: 'Super strong', color: 'gold' as const },
      { min: 55, label: 'Growing well', color: 'cyan' as const },
      { min: 0, label: 'Keep practising', color: 'violet' as const },
    ];
    expect(bandFor(80, bands)?.label).toBe('Super strong');
    expect(bandFor(54, bands)?.label).toBe('Keep practising');
    expect(rankedGames([40, 90, 70])).toEqual([1, 2, 0]);
    expect(trendLine(70, null)).toBe('First report for this world');
    expect(trendLine(75, 70)).toBe('Up 5 since last time!');
    expect(trendLine(70, 75)).toBe('5 lower than last time. Try again!');
  });
});
