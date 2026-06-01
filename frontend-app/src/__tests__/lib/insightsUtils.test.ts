import {
  truncate,
  buildMonthData,
  completedCount,
  INSIGHTS_SCHEMA_VERSION,
  NON_SCORABLE_DELTA_PTS,
} from '@/lib/insightsUtils';

describe('constants', () => {
  it('INSIGHTS_SCHEMA_VERSION is a positive integer', () => {
    expect(Number.isInteger(INSIGHTS_SCHEMA_VERSION)).toBe(true);
    expect(INSIGHTS_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('NON_SCORABLE_DELTA_PTS is a positive number', () => {
    expect(NON_SCORABLE_DELTA_PTS).toBeGreaterThan(0);
  });
});

describe('truncate', () => {
  it('returns empty string for null/undefined', () => {
    expect(truncate(null)).toBe('');
    expect(truncate(undefined)).toBe('');
  });

  it('returns string unchanged when shorter than limit', () => {
    expect(truncate('short', 20)).toBe('short');
  });

  it('truncates at the specified limit and adds ellipsis', () => {
    const result = truncate('a'.repeat(50), 10);
    expect(result.length).toBe(10);
    expect(result.endsWith('…')).toBe(true);
  });

  it('uses default limit of 38 characters', () => {
    const long = 'x'.repeat(40);
    const result = truncate(long);
    expect(result.length).toBe(38);
  });
});

describe('completedCount', () => {
  it('returns 0 for null/undefined plan', () => {
    expect(completedCount(null)).toBe(0);
    expect(completedCount(undefined)).toBe(0);
  });

  it('returns 0 when no activities are completed', () => {
    const plan = {
      months: [
        {
          periods: [
            { activities: [{ completed: false }, { completed: false }] },
          ],
        },
      ],
    };
    expect(completedCount(plan)).toBe(0);
  });

  it('counts completed activities across all months and periods', () => {
    const plan = {
      months: [
        {
          periods: [
            { activities: [{ completed: true }, { completed: false }] },
            { activities: [{ completed: true }, { completed: true }] },
          ],
        },
        {
          periods: [{ activities: [{ completed: true }] }],
        },
      ],
    };
    expect(completedCount(plan)).toBe(4);
  });
});

describe('buildMonthData', () => {
  const makeActivity = (score: number, completed = true, scorable = true) => ({
    title: `Act score=${score}`,
    completed,
    score,
    scorable,
  });

  it('returns empty array for null/undefined plan', () => {
    expect(buildMonthData(null)).toEqual([]);
    expect(buildMonthData(undefined)).toEqual([]);
  });

  it('returns one MonthData per month in the plan', () => {
    const plan = {
      months: [
        { month: 1, goal: 'Goal 1', periods: [] },
        { month: 2, goal: 'Goal 2', periods: [] },
      ],
    };
    const result = buildMonthData(plan);
    expect(result).toHaveLength(2);
  });

  it('computes improved observation when follow-up score > original', () => {
    const plan = {
      months: [
        {
          month: 1,
          periods: [
            { activities: [makeActivity(5)] },
            { activities: [makeActivity(8)] }, // follow-up is better
          ],
        },
      ],
    };
    const [monthData] = buildMonthData(plan);
    expect(monthData!.pairs[0]!.observation.type).toBe('improved');
  });

  it('computes declined observation when follow-up score < original', () => {
    const plan = {
      months: [
        {
          month: 1,
          periods: [
            { activities: [makeActivity(8)] },
            { activities: [makeActivity(4)] }, // follow-up is worse
          ],
        },
      ],
    };
    const [monthData] = buildMonthData(plan);
    expect(monthData!.pairs[0]!.observation.type).toBe('declined');
  });

  it('computes notStarted when original activity is not completed', () => {
    const plan = {
      months: [
        {
          month: 1,
          periods: [
            { activities: [makeActivity(0, false)] },
            { activities: [makeActivity(0, false)] },
          ],
        },
      ],
    };
    const [monthData] = buildMonthData(plan);
    expect(monthData!.pairs[0]!.observation.type).toBe('notStarted');
  });

  it('preserves the month record in the output', () => {
    const plan = {
      months: [{ month: 3, goal: 'Custom Goal', periods: [] }],
    };
    const [monthData] = buildMonthData(plan);
    expect(monthData!.month.month).toBe(3);
    expect(monthData!.month.goal).toBe('Custom Goal');
  });
});
