import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ConnectWins from '@/components/kids/ConnectWins';
import { winsFrom } from '@/lib/kidsWins';
import type { KidActivity } from '@/api/kids';
import type { KidQuests } from '@/api/kidQuests';
import type { KidWorlds } from '@/api/kidWorlds';

const DAY = '2026-11-11';
const activity = (over: Partial<KidActivity> = {}): KidActivity => ({
  stars: 0,
  circles_done: {
    discover: false,
    grow: false,
    transform: false,
    release: false,
    connect: false,
  },
  flipped_powers: [],
  discover_badge: false,
  tried_today: [],
  best_times: {},
  moods: {},
  shown: {},
  ...over,
});
const quests: KidQuests = {
  default_interest: 'music',
  interests: [],
  current: null,
  logs: { 'music:2': 1, 'music:0': 2 },
  last_logged: {},
  logged_today: [],
  catalog: [
    {
      key: 'music',
      label: 'Music',
      quests: [
        { title: 'Daily practice', how: '', target: 5 },
        { title: 'Learn a song', how: '', target: 3 },
        { title: 'Play for someone', how: '', target: 1 },
      ],
    },
  ],
};
const worlds: KidWorlds = {
  worlds: [
    { name: 'Self Care', icon: '', mission: '', hint: '', games: [] },
    { name: 'Creativity', icon: '', mission: '', hint: '', games: [] },
  ],
  bands: [
    { min: 80, label: 'Super strong', color: 'gold' },
    { min: 0, label: 'Keep practising', color: 'violet' },
  ],
  runs: {
    '0': [{ total: 85, scores: [85, 85, 85], at: '2026-11-10T10:00:00Z' }],
  },
};

describe('winsFrom', () => {
  it('collects finished quests, played worlds, the badge and a streak', () => {
    const wins = winsFrom({
      activity: activity({
        discover_badge: true,
        moods: {
          '2026-11-11': { mood: 'good', note: null },
          '2026-11-10': { mood: 'good', note: null },
          '2026-11-09': { mood: 'okay', note: null },
        },
      }),
      quests,
      worlds,
      day: DAY,
    });
    expect(wins.map(w => [w.key, w.title])).toEqual([
      ['quest:music:2', 'Quest done: Play for someone'],
      ['world:0', 'Super strong in Self Care'],
      ['badge:discover', 'Discover badge unlocked'],
      ['streak:3', '3-day check-in streak'],
    ]);
  });

  it('counts open powers before the badge, and nothing without data', () => {
    expect(
      winsFrom({
        activity: activity({ flipped_powers: [0, 1, 2] }),
        quests: null,
        worlds: null,
        day: DAY,
      }),
    ).toEqual([
      { key: 'powers:open', kind: 'powers', title: 'Opened 3 superpowers' },
    ]);
    expect(
      winsFrom({ activity: activity(), quests: null, worlds: null, day: DAY }),
    ).toEqual([]);
  });
});

describe('ConnectWins', () => {
  const wins = [
    {
      key: 'badge:discover',
      kind: 'badge' as const,
      title: 'Discover badge unlocked',
    },
    {
      key: 'world:0',
      kind: 'world' as const,
      title: 'Played the Self Care world',
    },
  ];

  it('says there are no wins yet', () => {
    const { getByText } = render(
      <ConnectWins
        wins={[]}
        childName="Aarav Shah"
        activity={activity()}
        sending={false}
        send={jest.fn()}
      />,
    );
    expect(getByText('No wins yet')).toBeTruthy();
  });

  it('shows the picked win on a card with the first name, and keeps it for the grown-up', () => {
    const send = jest.fn().mockResolvedValue(null);
    const { getByLabelText, getAllByText, getByText } = render(
      <ConnectWins
        wins={wins}
        childName="Aarav Shah"
        activity={activity()}
        sending={false}
        send={send}
      />,
    );
    expect(getByText('Aarav')).toBeTruthy();
    fireEvent.press(getByLabelText('Played the Self Care world'));
    expect(getAllByText('Played the Self Care world')).toHaveLength(2); // the list and the card
    fireEvent.press(getByLabelText('Show my grown-up'));
    expect(send).toHaveBeenCalledWith({
      type: 'show_win',
      key: 'world:0',
      title: 'Played the Self Care world',
    });
  });

  it('puts the age beside the first name when one is saved', () => {
    const { getByText } = render(
      <ConnectWins
        wins={wins}
        childName="Aarav Shah"
        childAge={10}
        activity={activity()}
        sending={false}
        send={jest.fn()}
      />,
    );
    expect(getByText('Aarav, age 10')).toBeTruthy();
    expect(
      getByText('Only your first name and age go on the card.'),
    ).toBeTruthy();
  });

  it("doesn't keep a win twice", () => {
    const send = jest.fn();
    const { getByLabelText } = render(
      <ConnectWins
        wins={wins}
        childName="Aarav"
        activity={activity({
          shown: {
            'badge:discover': {
              title: 'Discover badge unlocked',
              at: '2026-11-11T10:00:00Z',
            },
          },
        })}
        sending={false}
        send={send}
      />,
    );
    fireEvent.press(getByLabelText('Your grown-up can see it'));
    expect(send).not.toHaveBeenCalled();
  });
});
