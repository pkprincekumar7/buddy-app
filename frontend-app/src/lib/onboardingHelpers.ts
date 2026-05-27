// Shared defaults and helpers for the onboarding wizard.
// Consumed by both the Onboarding page and the personality/journey hooks.

export function determinePhase(age: number | string | undefined | null): string {
  if (!age) return 'foundation';
  const n = typeof age === 'string' ? parseFloat(age) : age;
  if (isNaN(n)) return 'foundation';
  if (n >= 15) return 'direction';
  if (n >= 12) return 'exploration';
  return 'foundation';
}

export const DEFAULT_CHILD_STATE = {
  name: '',
  age: '',
  school: '',
  strengths: [] as string[],
  hobbies: [] as string[],
  thinking_pattern: '',
  communication_style: '',
  energy_level: '',
  social_behaviour: '',
  emotional_behaviour: '',
  current_phase: 'foundation',
  onboarding_completed: false,
};

export function mergeChildDraft(
  partial: Partial<typeof DEFAULT_CHILD_STATE> | null | undefined,
): typeof DEFAULT_CHILD_STATE {
  return {
    ...DEFAULT_CHILD_STATE,
    ...(partial && typeof partial === 'object' ? partial : {}),
  };
}
