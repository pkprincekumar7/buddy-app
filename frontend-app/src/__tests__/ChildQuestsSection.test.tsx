import React from 'react';
import { render } from '@testing-library/react-native';
import type { KidQuests } from '@/api/kidQuests';

let mockQuests: KidQuests | null = null;
jest.mock('@/hooks/useKidQuests', () => ({
  useKidQuests: () => ({ quests: mockQuests }),
}));

import ChildQuestsSection from '@/components/lifePathwayPage/ChildQuestsSection';

const CATALOG: KidQuests['catalog'] = [
  {
    key: 'music',
    label: 'Music',
    quests: [
      { title: 'Daily practice', how: '', target: 5 },
      { title: 'Learn a song', how: '', target: 3 },
      { title: 'Play for someone', how: '', target: 1 },
    ],
  },
  {
    key: 'space',
    label: 'Space',
    quests: [
      { title: 'Look up', how: '', target: 5 },
      { title: 'Space fact', how: '', target: 5 },
      { title: 'Draw the sky', how: '', target: 2 },
    ],
  },
];
const state = (over: Partial<KidQuests> = {}): KidQuests => ({
  default_interest: 'music',
  interests: [],
  current: null,
  logs: {},
  last_logged: {},
  logged_today: [],
  catalog: CATALOG,
  ...over,
});

const show = () =>
  render(<ChildQuestsSection childId="c1" childName="Aarav" />);

describe('ChildQuestsSection', () => {
  it('is hidden until the quests load', () => {
    mockQuests = null;
    expect(show().toJSON()).toBeNull();
  });

  it('says nothing is logged yet', () => {
    mockQuests = state();
    const { getByText } = show();
    expect(getByText("Aarav's quests")).toBeTruthy();
    expect(getByText('Nothing logged yet.')).toBeTruthy();
  });

  it("shows each quest's count and last day, the plan's interest first", () => {
    mockQuests = state({
      interests: ['space'],
      logs: { 'music:0': 2, 'music:2': 1, 'space:1': 1 },
      last_logged: {
        'music:0': '2026-11-10',
        'music:2': '2026-11-11',
        'space:1': '2026-11-09',
      },
    });
    const { getByText, getAllByText } = show();
    expect(getByText('From your plan')).toBeTruthy();
    expect(getByText('Aarav added')).toBeTruthy();
    expect(getByText('2 of 5')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
    expect(getAllByText(/last 10 Nov/)).toHaveLength(1);
    expect(getAllByText(/not yet/).length).toBeGreaterThan(0);
  });
});
