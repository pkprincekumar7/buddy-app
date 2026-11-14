import type { Child } from '@/api/children';
import type { KidActivity } from '@/api/kids';
import { KIDS_AREAS, type KidsArea } from '@/lib/childView';

/** The circles' names on the kids page. */
export const AREA_NAMES: Record<KidsArea, string> = {
  discover: 'Discover',
  grow: 'Grow',
  transform: 'Transform',
  connect: 'Connect',
  release: 'Release',
};

/** The kids page's tabs, in the hub's order. */
export const AREA_ORDER: readonly KidsArea[] = KIDS_AREAS;

/** The order circles open in (the hub's: Discover → Grow → Transform → Release → Connect). */
export const UNLOCK_ORDER: readonly KidsArea[] = [
  'discover',
  'grow',
  'transform',
  'release',
  'connect',
];

/** What the child has done in child view, circle by circle (children's `circles_done`). */
export type CirclesDone = KidActivity['circles_done'];

/**
 * Whether a circle is open in child view (decided 2026-11-11: child view's own order, apart
 * from the parent's progress): Discover once the parent's chat is done (the powers need it),
 * then each circle once the child has done the one before it there. The children service
 * checks the same rule.
 */
export function areaOpen(
  area: KidsArea,
  progress: Child['progress'],
  done: CirclesDone | null | undefined,
): boolean {
  if (area === 'discover') return progress.conversation;
  const before = UNLOCK_ORDER[UNLOCK_ORDER.indexOf(area) - 1];
  return Boolean(before && areaOpen(before, progress, done) && done?.[before]);
}

/**
 * The avatar video a circle plays on entry, as its parent page does (Grow's growth map plays
 * stage 7, Transform's Life Pathway stage 4). Discover's plays on the hub before it opens.
 */
export const AREA_SPLASH: Partial<Record<KidsArea, number>> = {
  grow: 7,
  transform: 4,
};

/** What "Read to me" says on each circle. */
export const READ_ALOUD: Record<KidsArea, string> = {
  discover: 'You have superpowers. Tap each power around you.',
  grow: 'Pick a world. Play three quick games. See your score.',
  transform: 'Your quests. Do one today, then tap I did it.',
  connect: 'Your wins. Pick one and show it to your grown-up.',
  release: 'How do you feel today? There is no wrong answer.',
};

/** Discover's read-aloud from the child's own result (the prototype's): "You are The {style}.
 *  {line} Tap each power around you." Without a result, the general line. */
export function discoverReadAloud(
  style?: string | null,
  line?: string | null,
): string {
  if (!style) return READ_ALOUD.discover;
  const said = line?.trim();
  const sentence = said ? (/[.!?]$/.test(said) ? said : `${said}.`) : '';
  return [`You are The ${style}.`, sentence, 'Tap each power around you.']
    .filter(Boolean)
    .join(' ');
}
