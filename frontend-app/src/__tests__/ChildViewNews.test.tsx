import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { Child } from '@/api/children';
import type { KidQuests } from '@/api/kidQuests';

const mockNavigate = jest.fn();
let mockShown: Record<string, { title: string; at: string }> = {};
let mockQuests: KidQuests | null = null;
jest.mock('@/lib/router', () => ({
  navigate: (...a: unknown[]) => mockNavigate(...a),
}));
jest.mock('@/hooks/useKidActivity', () => ({
  useKidActivity: () => ({ activity: { shown: mockShown } }),
}));
jest.mock('@/hooks/useKidQuests', () => ({
  useKidQuests: () => ({ quests: mockQuests }),
}));

import ChildViewNews from '@/components/home/ChildViewNews';

const child = (release: boolean) =>
  ({
    id: 'c1',
    name: 'Rahul',
    progress: { conversation: true, release },
  } as unknown as Child);
const quests = (logs: Record<string, number>): KidQuests => ({
  default_interest: null,
  interests: ['football'],
  current: 'football',
  logs,
  last_logged: Object.fromEntries(
    Object.keys(logs).map(k => [k, '2026-11-11']),
  ),
  logged_today: [],
  catalog: [
    {
      key: 'football',
      label: 'Football',
      quests: [
        { title: '100 touches', how: '', target: 5 },
        { title: 'Weak foot hero', how: '', target: 5 },
        { title: 'Sprint race', how: '', target: 3 },
      ],
    },
  ],
});

beforeEach(() => {
  mockShown = {};
  mockQuests = null;
  mockNavigate.mockReset();
});

describe('ChildViewNews', () => {
  it('shows nothing until the child has done something to show', () => {
    mockQuests = quests({});
    expect(render(<ChildViewNews child={child(true)} />).toJSON()).toBeNull();
  });

  it('lists the wins the child chose and the quests they logged', () => {
    mockShown = {
      'badge:discover': {
        title: 'Discover badge unlocked',
        at: new Date().toISOString(),
      },
    };
    mockQuests = quests({ 'football:0': 1 });
    const { getByText, queryByLabelText } = render(
      <ChildViewNews child={child(false)} />,
    );
    expect(getByText('From Rahul’s child view')).toBeTruthy();
    expect(getByText('Discover badge unlocked')).toBeTruthy();
    expect(getByText('today')).toBeTruthy();
    expect(getByText(/1 of 5/)).toBeTruthy();
    // The parent's Connect isn't open yet: no way to share from there.
    expect(queryByLabelText('Share from Connect')).toBeNull();
  });

  it("offers Connect to share them once the parent's Connect is open", () => {
    mockShown = {
      'world:0': {
        title: 'Played the Self Care world',
        at: new Date().toISOString(),
      },
    };
    const { getByLabelText } = render(<ChildViewNews child={child(true)} />);
    fireEvent.press(getByLabelText('Share from Connect'));
    expect(mockNavigate).toHaveBeenCalledWith('/Connect/c1');
  });
});
