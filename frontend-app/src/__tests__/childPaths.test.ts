import { childPath, childSubtitle } from '@/lib/childPaths';

const progress = (conversation: boolean) =>
  ({ conversation } as unknown as Parameters<typeof childPath>[0]['progress']);

describe('childPath', () => {
  it('resumes setup until the onboarding chat is done', () => {
    expect(childPath({ id: 'a', progress: progress(false) })).toBe(
      '/Onboarding/a',
    );
  });
  it('opens the journey once the chat is done', () => {
    expect(childPath({ id: 'a', progress: progress(true) })).toBe(
      '/PersonalityJourney/a',
    );
  });
});

describe('childSubtitle', () => {
  it('says the child is setting up until the chat is done, whatever the age', () => {
    expect(childSubtitle({ age: 9, progress: progress(false) })).toBe(
      'Child · setting up',
    );
  });
  it('shows the age when it is known', () => {
    expect(childSubtitle({ age: 9, progress: progress(true) })).toBe(
      'Child · age 9',
    );
    expect(childSubtitle({ age: null, progress: progress(true) })).toBe(
      'Child',
    );
  });
});
