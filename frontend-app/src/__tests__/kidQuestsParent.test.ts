import { daysAgo, questTotals } from '@/api/kidQuests';

describe('daysAgo', () => {
  it('reads a day against today', () => {
    expect(daysAgo('2026-11-14', '2026-11-14')).toBe('today');
    expect(daysAgo('2026-11-13', '2026-11-14')).toBe('yesterday');
    expect(daysAgo('2026-11-11', '2026-11-14')).toBe('3 days ago');
  });

  it('counts across a month end, and treats a later day as today', () => {
    expect(daysAgo('2026-10-30', '2026-11-02')).toBe('3 days ago');
    expect(daysAgo('2026-11-15', '2026-11-14')).toBe('today');
  });
});

describe('questTotals', () => {
  it('adds the logs and counts the finished quests', () => {
    const q = (count: number, target: number) => ({
      title: `t${count}${target}`,
      count,
      target,
      lastLogged: null,
      how: 'h',
    });
    expect(questTotals([q(2, 5), q(1, 1), q(2, 2)])).toEqual({
      logged: 5,
      finished: 2,
      total: 3,
    });
    expect(questTotals([])).toEqual({ logged: 0, finished: 0, total: 0 });
  });
});
