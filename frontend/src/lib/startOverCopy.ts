/** The Start Over confirmation's copy (the header's, the journey's and the button's). */
export const START_OVER_DESCRIPTION =
  'All progress for this child will be permanently deleted — personality results, growth area answers, and goal plans. You will need to restart the onboarding from the beginning.';

/** The Start Over copy, naming the child when their name is known. */
export function startOverCopy(childName?: string): { title: string; description: string } {
  if (!childName) return { title: 'Start Over?', description: START_OVER_DESCRIPTION };
  return {
    title: `Delete ${childName}'s journey?`,
    description: `All of ${childName}'s progress will be permanently deleted — personality results, growth area answers, and goal plans. You will need to restart the onboarding from the beginning.`,
  };
}
