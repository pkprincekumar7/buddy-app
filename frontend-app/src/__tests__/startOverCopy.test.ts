import { START_OVER_DESCRIPTION, startOverCopy } from '@/lib/startOverCopy';

describe('startOverCopy', () => {
  it('keeps the general copy when the name is unknown', () => {
    expect(startOverCopy()).toEqual({
      title: 'Start Over?',
      description: START_OVER_DESCRIPTION,
    });
  });
  it('names the child when it can', () => {
    const copy = startOverCopy('Aarav');
    expect(copy.title).toBe("Delete Aarav's journey?");
    expect(copy.description).toMatch(/^All of Aarav's progress/);
  });
});
