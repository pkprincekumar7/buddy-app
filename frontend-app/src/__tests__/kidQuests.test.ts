import {
  anyLogged,
  currentInterest,
  myInterests,
  questKey,
  questSummary,
  shortDay,
  type KidQuests,
} from '@/api/kidQuests';

const q = (over: Partial<KidQuests>): KidQuests => ({
  default_interest: null,
  interests: [],
  current: null,
  logs: {},
  last_logged: {},
  logged_today: [],
  catalog: [],
  ...over,
});

describe('kidQuests', () => {
  it("puts the plan's interest first, without repeats", () => {
    expect(
      myInterests(
        q({ default_interest: 'music', interests: ['space', 'music'] }),
      ),
    ).toEqual(['music', 'space']);
    expect(myInterests(q({}))).toEqual([]);
  });

  it('shows the stored interest while it is still the child’s, else the first', () => {
    expect(
      currentInterest(
        q({
          default_interest: 'music',
          interests: ['space'],
          current: 'space',
        }),
      ),
    ).toBe('space');
    expect(
      currentInterest(q({ default_interest: 'music', current: 'cooking' })),
    ).toBe('music');
    expect(currentInterest(q({}))).toBeNull();
    expect(questKey('space', 2)).toBe('space:2');
  });

  it("summarises the plan's interest, and the child's only once logged", () => {
    const catalog: KidQuests['catalog'] = [
      {
        key: 'music',
        label: 'Music',
        quests: [{ title: 'A', how: '', target: 2 }],
      },
      {
        key: 'space',
        label: 'Space',
        quests: [{ title: 'B', how: '', target: 2 }],
      },
    ];
    const none = q({
      default_interest: 'music',
      interests: ['space'],
      catalog,
    });
    expect(questSummary(none).map(s => s.key)).toEqual(['music']);
    expect(anyLogged(none)).toBe(false);
    const logged = q({
      ...none,
      logs: { 'space:0': 5 },
      last_logged: { 'space:0': '2026-11-02' },
    });
    const space = questSummary(logged)[1]!;
    expect(space.quests[0]).toEqual({
      title: 'B',
      count: 2,
      target: 2,
      lastLogged: '2026-11-02',
      how: '',
    });
    expect(anyLogged(logged)).toBe(true);
  });

  it('writes a day as the calendar day', () => {
    expect(shortDay('2026-11-02')).toBe('2 Nov');
    expect(shortDay('nope')).toBe('nope');
  });
});
