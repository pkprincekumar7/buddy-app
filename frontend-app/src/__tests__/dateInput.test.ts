import { dateToIso } from '@/components/lifepathway/fields';

// The picker hands back a Date; the plan stores the day the parent picked as YYYY-MM-DD,
// as the web's <input type="date"> does.

test('the picked day is kept in the phone’s own time zone', () => {
  // Late evening locally can already be the next day in UTC (toISOString's zone).
  expect(dateToIso(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  expect(dateToIso(new Date(2027, 0, 5, 0, 5))).toBe('2027-01-05');
});
