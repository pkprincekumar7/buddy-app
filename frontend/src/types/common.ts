export type ID = string;
export type Timestamp = string;

export type OnboardingAction =
  | { type: 'SET_PERSONALITY_BUSY'; payload: boolean }
  | { type: 'SET_MBTI_RESULT'; payload: Record<string, unknown> | null }
  | { type: 'SET_GENERATED_PROFILE'; payload: Record<string, unknown> | null }
  | { type: 'SET_JOURNEY_BUSY'; payload: boolean }
  | { type: 'SET_RECOMMENDATIONS'; payload: unknown }
  | { type: 'SET_COMPLETION_BUSY'; payload: boolean }
  | { type: 'SET_ACTIVE_CHILD_ID'; payload: string };

export type DispatchFn = (action: OnboardingAction) => void;
