import { connectItems } from '@/components/connect/shared';
import type { Win } from '@/lib/kidsWins';

const when = (at: string) => `at ${at}`;
const WINS: Win[] = [
  {
    key: 'quest:drawing:0',
    kind: 'quest',
    title: 'Quest done: Draw your street',
  },
  { key: 'world:0', kind: 'world', title: 'Super strong in Life Ambition' },
  { key: 'badge:discover', kind: 'badge', title: 'Discover badge unlocked' },
];

describe('connectItems', () => {
  it('puts the shown wins first, newest first, each with its own id', () => {
    const items = connectItems(
      {
        'streak:3': {
          title: '3-day check-in streak',
          at: '2026-11-10T10:00:00Z',
        },
        'world:1': {
          title: 'Super strong in Self Care',
          at: '2026-11-12T10:00:00Z',
        },
      },
      WINS,
      'Aarav',
      when,
    );
    expect(items.slice(0, 2).map(i => [i.id, i.title, i.kind])).toEqual([
      ['shown:world:1', 'Super strong in Self Care', 'From Aarav'],
      ['shown:streak:3', '3-day check-in streak', 'From Aarav'],
    ]);
    expect(items[0]?.when).toBe('at 2026-11-12T10:00:00Z');
    expect(items).toHaveLength(2 + WINS.length);
  });

  it("then the child's other wins, each once, tagged by kind", () => {
    const items = connectItems(
      {
        'badge:discover': {
          title: 'Discover badge unlocked',
          at: '2026-11-12T10:00:00Z',
        },
      },
      WINS,
      'Aarav',
      when,
    );
    expect(items.map(i => [i.id, i.kind])).toEqual([
      ['shown:badge:discover', 'From Aarav'],
      ['win:quest:drawing:0', 'Quest'],
      ['win:world:0', 'Grow'],
    ]);
    expect(items[1]?.caption).toBe('Aarav did it for real, day by day.');
  });

  it('makes nothing up: no wins, an empty list', () => {
    expect(connectItems({}, [], 'Aarav', when)).toEqual([]);
  });

  it("keeps the wins' ids when shown ones arrive, so their edits stay put", () => {
    const before = connectItems({}, WINS.slice(0, 2), 'Aarav', when).map(
      i => i.id,
    );
    const after = connectItems(
      {
        'badge:discover': {
          title: 'Discover badge unlocked',
          at: '2026-11-12T10:00:00Z',
        },
      },
      WINS.slice(0, 2),
      'Aarav',
      when,
    ).map(i => i.id);
    expect(after.slice(1)).toEqual(before);
  });

  it('uses the first name only', () => {
    const [shown] = connectItems(
      {
        'badge:discover': {
          title: 'Discover badge unlocked',
          at: '2026-11-12T10:00:00Z',
        },
      },
      [],
      '  Aarav  Shah ',
      when,
    );
    expect(shown?.kind).toBe('From Aarav');
    expect(shown?.caption).toBe('Aarav chose to show you this in child view.');
  });

  it('says "Your child" without a name', () => {
    expect(connectItems({}, WINS.slice(0, 1), '  ', when)[0]?.caption).toBe(
      'Your child did it for real, day by day.',
    );
  });
});
