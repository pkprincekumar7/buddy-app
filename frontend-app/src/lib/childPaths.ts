import type { Child } from '@/api/children';

/**
 * Where a child opens in parent view: their setup (the profile form, then the
 * onboarding chat) until the chat is done, then their journey.
 */
export function childPath(child: Pick<Child, 'id' | 'progress'>): string {
  return child.progress.conversation
    ? `/PersonalityJourney/${child.id}`
    : `/Onboarding/${child.id}`;
}

/** The line under a child's name in the profile menu: "Child · age 10". */
export function childSubtitle(child: Pick<Child, 'age' | 'progress'>): string {
  if (!child.progress.conversation) return 'Child · setting up';
  return child.age !== null ? `Child · age ${child.age}` : 'Child';
}
