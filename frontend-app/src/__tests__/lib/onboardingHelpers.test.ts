import {
  determinePhase,
  mergeChildDraft,
  DEFAULT_CHILD_STATE,
} from '@/lib/onboardingHelpers';

describe('determinePhase', () => {
  it('returns "foundation" for children under 12', () => {
    expect(determinePhase(5)).toBe('foundation');
    expect(determinePhase(11)).toBe('foundation');
    expect(determinePhase('9')).toBe('foundation');
  });

  it('returns "exploration" for ages 12–14', () => {
    expect(determinePhase(12)).toBe('exploration');
    expect(determinePhase(14)).toBe('exploration');
    expect(determinePhase('13')).toBe('exploration');
  });

  it('returns "direction" for ages 15 and above', () => {
    expect(determinePhase(15)).toBe('direction');
    expect(determinePhase(18)).toBe('direction');
    expect(determinePhase('17')).toBe('direction');
  });

  it('returns "foundation" for null/undefined/NaN inputs', () => {
    expect(determinePhase(null)).toBe('foundation');
    expect(determinePhase(undefined)).toBe('foundation');
    expect(determinePhase('not-a-number')).toBe('foundation');
    expect(determinePhase('')).toBe('foundation');
  });
});

describe('mergeChildDraft', () => {
  it('returns DEFAULT_CHILD_STATE for null/undefined input', () => {
    expect(mergeChildDraft(null)).toEqual(DEFAULT_CHILD_STATE);
    expect(mergeChildDraft(undefined)).toEqual(DEFAULT_CHILD_STATE);
  });

  it('merges partial fields over defaults', () => {
    const result = mergeChildDraft({ name: 'Alice', age: '10' });
    expect(result.name).toBe('Alice');
    expect(result.age).toBe('10');
    // Non-specified defaults remain
    expect(result.school).toBe('');
    expect(result.onboarding_completed).toBe(false);
  });

  it('allows overriding arrays', () => {
    const result = mergeChildDraft({ strengths: ['Reading', 'Math'] });
    expect(result.strengths).toEqual(['Reading', 'Math']);
  });

  it('does not mutate DEFAULT_CHILD_STATE', () => {
    const before = { ...DEFAULT_CHILD_STATE };
    mergeChildDraft({ name: 'Bob' });
    expect(DEFAULT_CHILD_STATE).toEqual(before);
  });
});
