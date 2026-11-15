import { BASE_ITEMS, connectItems } from '@/components/connect/shared';

const when = (at: string) => `at ${at}`;

describe('connectItems', () => {
  it('puts the shown wins first, newest first, each with its own id', () => {
    const items = connectItems(
      {
        'streak:3': {
          title: '3-day check-in streak',
          at: '2026-11-10T10:00:00Z',
        },
        'world:0': {
          title: 'Super strong in Self Care',
          at: '2026-11-12T10:00:00Z',
        },
      },
      'Aarav',
      when,
    );
    expect(items.slice(0, 2).map(i => [i.id, i.title, i.kind])).toEqual([
      ['shown:world:0', 'Super strong in Self Care', 'From Aarav'],
      ['shown:streak:3', '3-day check-in streak', 'From Aarav'],
    ]);
    expect(items[0]?.when).toBe('at 2026-11-12T10:00:00Z');
    expect(items).toHaveLength(2 + BASE_ITEMS.length);
  });

  it('keeps every id unique, even when a shown win has a page item title', () => {
    const items = connectItems(
      {
        'quest:x': { title: BASE_ITEMS[0]!.title, at: '2026-11-12T10:00:00Z' },
      },
      'Aarav',
      when,
    );
    const ids = items.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the page items' ids when wins arrive, so their edits stay put", () => {
    const before = connectItems({}, 'Aarav', when).map(i => i.id);
    const after = connectItems(
      {
        'badge:discover': {
          title: 'Discover badge unlocked',
          at: '2026-11-12T10:00:00Z',
        },
      },
      'Aarav',
      when,
    ).map(i => i.id);
    expect(after.slice(1)).toEqual(before);
  });

  it('puts the name into the page items', () => {
    const titles = connectItems({}, 'Aarav', when).map(i => i.title);
    expect(titles).toContain('Aarav is The Thinker');
  });

  it('uses the first name only, and "Your child" without a name', () => {
    const win = {
      'badge:discover': {
        title: 'Discover badge unlocked',
        at: '2026-11-12T10:00:00Z',
      },
    };
    const [full] = connectItems(win, '  Aarav  Shah ', when);
    expect(full?.kind).toBe('From Aarav');
    expect(full?.caption).toBe('Aarav chose to show you this in child view.');
    expect(connectItems({}, 'Aarav Shah', when).map(i => i.title)).toContain(
      'Aarav is The Thinker',
    );
    expect(connectItems(win, '', when)[0]?.kind).toBe('From Your child');
  });
});
