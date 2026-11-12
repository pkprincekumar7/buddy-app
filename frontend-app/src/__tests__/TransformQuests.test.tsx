import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import TransformQuests from '@/components/kids/TransformQuests';
import type { KidQuests } from '@/api/kidQuests';

const quest = (title: string, target: number) => ({
  title,
  how: `${title} how`,
  target,
});
const CATALOG: KidQuests['catalog'] = [
  {
    key: 'music',
    label: 'Music',
    quests: [
      quest('Daily practice', 5),
      quest('Learn a song', 3),
      quest('Play for someone', 1),
    ],
  },
  {
    key: 'space',
    label: 'Space',
    quests: [
      quest('Look up', 5),
      quest('Space fact', 5),
      quest('Draw the sky', 2),
    ],
  },
];
const state = (over: Partial<KidQuests> = {}): KidQuests => ({
  default_interest: null,
  interests: [],
  current: null,
  logs: {},
  last_logged: {},
  logged_today: [],
  catalog: CATALOG,
  ...over,
});

function setup(q: KidQuests, firstLog = true) {
  const pick = jest.fn().mockResolvedValue(q);
  const log = jest.fn().mockResolvedValue(firstLog);
  const awaitProgress = jest.fn();
  const view = render(
    <TransformQuests
      quests={q}
      sending={false}
      pick={pick}
      log={log}
      awaitProgress={awaitProgress}
    />,
  );
  return { ...view, pick, log, awaitProgress };
}

describe('TransformQuests', () => {
  it('asks what the child is into when the plan names nothing', () => {
    const { getByText, getByLabelText, pick } = setup(state());
    expect(getByText('What are you into?')).toBeTruthy();
    fireEvent.press(getByLabelText('Space'));
    expect(pick).toHaveBeenCalledWith('space');
  });

  it("shows the plan's interest first, its quests and counts", () => {
    const { getByText, getByLabelText } = setup(
      state({
        default_interest: 'music',
        interests: ['space'],
        logs: { 'music:0': 2, 'music:2': 1 },
      }),
    );
    expect(getByText('From your parent')).toBeTruthy();
    expect(getByText('You added')).toBeTruthy();
    expect(getByText('Daily practice')).toBeTruthy();
    expect(getByLabelText('2 of 5 done')).toBeTruthy();
    expect(getByText('Quest done!')).toBeTruthy(); // "Play for someone": 1 of 1
  });

  it("logs a quest, and waits for its progress only on the quest's first log", async () => {
    const first = setup(state({ default_interest: 'music' }), true);
    fireEvent.press(first.getAllByLabelText('I did it today')[0]!);
    // transform tells children (transform.quest_logged): wait for Transform to show as done.
    await waitFor(() => expect(first.awaitProgress).toHaveBeenCalledTimes(1));
    expect(first.log).toHaveBeenCalledWith('music', 0);
    first.unmount();

    const later = setup(
      state({ default_interest: 'music', logs: { 'music:0': 1 } }),
      false,
    );
    fireEvent.press(later.getAllByLabelText('I did it today')[0]!);
    await waitFor(() => expect(later.log).toHaveBeenCalled());
    expect(later.awaitProgress).not.toHaveBeenCalled();
  });

  it("doesn't log a quest twice in a day", () => {
    const { getByLabelText, log } = setup(
      state({ default_interest: 'music', logged_today: ['music:1'] }),
    );
    fireEvent.press(getByLabelText('Done today'));
    expect(log).not.toHaveBeenCalled();
  });

  it('adds another interest, and comes back without one', () => {
    const { getByLabelText, getByText, queryByText, pick } = setup(
      state({ default_interest: 'music' }),
    );
    fireEvent.press(getByLabelText('Add another'));
    expect(getByText('Add another one')).toBeTruthy();
    expect(queryByText('Music')).toBeNull(); // already the child's
    fireEvent.press(getByLabelText('Back to my quests'));
    expect(getByText('Your quests')).toBeTruthy();
    expect(pick).not.toHaveBeenCalled();
  });
});
