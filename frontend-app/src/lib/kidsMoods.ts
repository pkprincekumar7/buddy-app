import type { KidMoodKey } from '@/api/kids';
import { previousDay } from '@/lib/kidsDay';

/** A colour of the kids palette: index.css --kids-<name>-rgb and its -shade. */
export type KidsColor =
  | 'discover'
  | 'grow'
  | 'transform'
  | 'connect'
  | 'release'
  | 'teal'
  | 'orange';

/** Release's five moods (docs/child-view-build-plan.md, 2.3): face colour and mouth. */
export const MOODS: readonly {
  key: KidMoodKey;
  label: string;
  color: KidsColor;
  /** The face's mouth, an SVG path in a 24×24 box. */
  mouth: string;
}[] = [
  {
    key: 'great',
    label: 'Great',
    color: 'teal',
    mouth: 'M7.5 13.5c1.4 3 7.6 3 9 0',
  },
  {
    key: 'good',
    label: 'Good',
    color: 'discover',
    mouth: 'M8.5 14.5c1.5 1.6 5.5 1.6 7 0',
  },
  { key: 'okay', label: 'Okay', color: 'transform', mouth: 'M8.5 15h7' },
  {
    key: 'low',
    label: 'Low',
    color: 'release',
    mouth: 'M8.5 16.2c1.5-1.5 5.5-1.5 7 0',
  },
  {
    key: 'upset',
    label: 'Upset',
    color: 'connect',
    mouth: 'M7.5 17c1.5-2.8 7.5-2.8 9 0',
  },
];

/** The streak line under the moods. */
export function streakLine(streak: number): string {
  return streak === 0
    ? 'Check in today to start a streak'
    : `${streak}-day streak`;
}

/** One day of the parent's mood row: the child's mood that day, or null. */
export interface MoodDay {
  day: string;
  mood: KidMoodKey | null;
}

/**
 * The last `count` days ending today, oldest first, each with the mood saved that day
 * (docs/child-view-build-plan.md, 2.4). Only the mood: the parent never sees the note.
 */
export function recentMoodDays(
  moods: Record<string, { mood: string }>,
  today: string,
  count = 14,
): MoodDay[] {
  const days: MoodDay[] = [];
  let day = today;
  for (let i = 0; i < count; i += 1) {
    const saved = MOODS.find(m => m.key === moods[day]?.mood);
    days.unshift({ day, mood: saved?.key ?? null });
    day = previousDay(day);
  }
  return days;
}

/** The streak as the parent reads it. */
export function parentStreakLine(streak: number, name: string): string {
  return streak === 0
    ? 'No check-in streak right now'
    : `${name} is on a ${streak}-day streak`;
}
