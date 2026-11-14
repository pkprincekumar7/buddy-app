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
      { title: 'Learn a song', how: 'Pick one you like.', target: 3 },
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

  it('shows the topic as not started before any log', () => {
    mockQuests = state();
    const { getByText, getAllByText, queryByText } = show();
    expect(getByText("Aarav's quests")).toBeTruthy();
    expect(getByText('Your topic: Music · done in child view')).toBeTruthy();
    expect(getAllByText('Not started')).toHaveLength(2); // the chip and the topic's pill
    expect(
      getByText(
        'When Aarav logs a Music quest in child view, it shows up here.',
      ),
    ).toBeTruthy();
    expect(queryByText('Logged')).toBeNull();
  });

  it("shows each quest's ring, status and last day, the plan's interest first", () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 12) });
    mockQuests = state({
      interests: ['space'],
      logs: { 'music:0': 2, 'music:2': 1, 'space:1': 1 },
      last_logged: {
        'music:0': '2026-11-10',
        'music:2': '2026-11-11',
        'space:1': '2026-11-09',
      },
    });
    const { getByText, getByLabelText, getAllByText } = show();
    // The plan's topic in the header: 3 logs, 1 of its 3 quests finished.
    expect(getByText('1/3 quests done')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('1/3')).toBeTruthy();
    expect(getByText('Space · Aarav added')).toBeTruthy();
    expect(getByLabelText('2 of 5 logged')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
    expect(getAllByText('In progress')).toHaveLength(2);
    expect(getByText('Last logged 2 days ago')).toBeTruthy();
    expect(getByText('Last logged yesterday')).toBeTruthy();
    // A quest not started yet shows its how-to.
    expect(getByText('Pick one you like.')).toBeTruthy();
    jest.useRealTimers();
  });

  it('lists the quests when only an interest the child added is logged', () => {
    mockQuests = state({
      interests: ['space'],
      logs: { 'space:1': 1 },
      last_logged: { 'space:1': '2026-11-09' },
    });
    const { getByText, queryByText } = show();
    // The header still counts the plan's topic.
    expect(getByText('0/3 quests done')).toBeTruthy();
    expect(getByText('Space · Aarav added')).toBeTruthy();
    expect(
      queryByText(
        'When Aarav logs a Music quest in child view, it shows up here.',
      ),
    ).toBeNull();
  });
});
