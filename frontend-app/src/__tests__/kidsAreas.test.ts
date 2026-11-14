import { READ_ALOUD, discoverReadAloud } from '@/lib/kidsAreas';

describe('discoverReadAloud', () => {
  it("reads the child's own result, as the prototype does", () => {
    expect(
      discoverReadAloud(
        'Thinker',
        'You can think about one hard thing for a long time.',
      ),
    ).toBe(
      'You are The Thinker. You can think about one hard thing for a long time. Tap each power around you.',
    );
  });

  it('ends the line with a full stop when it has none', () => {
    expect(discoverReadAloud('Thinker', 'You love big ideas')).toBe(
      'You are The Thinker. You love big ideas. Tap each power around you.',
    );
  });

  it('skips a missing line, and falls back without a result', () => {
    expect(discoverReadAloud('Thinker', '  ')).toBe(
      'You are The Thinker. Tap each power around you.',
    );
    expect(discoverReadAloud(undefined, 'x')).toBe(READ_ALOUD.discover);
  });
});
