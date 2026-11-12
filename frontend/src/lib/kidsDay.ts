/**
 * The child's own day, and the Release streak (docs/child-view-build-plan.md, 2.3). The day
 * is the device's local date, which the server accepts within a day of its own.
 */

/** The local date as YYYY-MM-DD. */
export function localDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day before `day` (YYYY-MM-DD), across month and year ends. */
export function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) - 1));
}

/**
 * Consecutive days with a mood, ending today (or yesterday, when today has none yet: the
 * streak isn't broken until the day is over).
 */
export function moodStreak(moods: Record<string, unknown>, today: string): number {
  let day = today in moods ? today : previousDay(today);
  let streak = 0;
  while (day in moods) {
    streak += 1;
    day = previousDay(day);
  }
  return streak;
}
