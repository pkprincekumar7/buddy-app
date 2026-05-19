// Shared defaults and helpers for the onboarding wizard.
// Consumed by both the Onboarding page and the personality/journey hooks.

export function determinePhase(age) {
  if (!age) return 'foundation';
  if (age >= 15) return 'direction';
  if (age >= 12) return 'exploration';
  return 'foundation';
}

export const DEFAULT_CHILD_STATE = {
  name: '',
  age: '',
  school: '',
  strengths: [],
  hobbies: [],
  thinking_pattern: '',
  communication_style: '',
  energy_level: '',
  social_behaviour: '',
  emotional_behaviour: '',
  current_phase: 'foundation',
  onboarding_completed: false,
};

export function mergeChildDraft(partial) {
  return {
    ...DEFAULT_CHILD_STATE,
    ...(partial && typeof partial === 'object' ? partial : {}),
  };
}
