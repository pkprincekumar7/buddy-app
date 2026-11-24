import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { KidWorlds } from '@/api/kidWorlds';

let mockScore = 80;
jest.mock('@/components/kids/GrowGames', () => {
  const { Pressable, Text: T } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({
      onDone,
    }: {
      onDone: (r: { score: number; line: string }) => void;
    }) => (
      <Pressable
        accessibilityLabel="Finish this game"
        onPress={() =>
          onDone({ score: mockScore, line: `scored ${mockScore}` })
        }
      >
        <T>game</T>
      </Pressable>
    ),
  };
});

import GrowWorlds from '@/components/kids/GrowWorlds';

const game = (title: string, skill: string) => ({
  type: 'sort' as const,
  title,
  skill,
  how: `${title} how`,
  tip: `${skill} tip`,
  cfg: {},
  build_on: { title: 'b', body: 'b' },
  support: { title: 's', body: 's' },
});
const WORLDS: KidWorlds = {
  worlds: [
    {
      name: 'Self Care',
      icon: 'M0 0',
      mission: 'Make your bed.',
      hint: 'Tick it off.',
      games: [
        game('One', 'Skill one'),
        game('Two', 'Skill two'),
        game('Three', 'Skill three'),
      ],
    },
  ],
  bands: [
    { min: 80, label: 'Super strong', color: 'gold' },
    { min: 55, label: 'Growing well', color: 'cyan' },
    { min: 0, label: 'Keep practising', color: 'violet' },
  ],
  runs: {
    '0': [{ total: 60, scores: [60, 60, 60], at: '2026-11-10T10:00:00Z' }],
  },
};

describe('GrowWorlds', () => {
  it('plays a world through to its saved report', async () => {
    const saved: KidWorlds = {
      ...WORLDS,
      runs: {
        '0': [
          ...(WORLDS.runs['0'] ?? []),
          { total: 73, scores: [80, 80, 60], at: '2026-11-11T10:00:00Z' },
        ],
      },
    };
    const addRun = jest.fn().mockResolvedValue(saved);
    const awaitProgress = jest.fn();
    const { getByLabelText, getByText } = render(
      <GrowWorlds
        worlds={WORLDS}
        saving={false}
        addRun={addRun}
        awaitProgress={awaitProgress}
      />,
    );
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Last: 60')).toBeTruthy();
    fireEvent.press(getByLabelText('Self Care, completed, last 60'));
    for (const [i, score] of [80, 80, 60].entries()) {
      mockScore = score;
      fireEvent.press(getByLabelText('Play'));
      fireEvent.press(getByLabelText('Finish this game'));
      expect(getByText(`scored ${score}`)).toBeTruthy();
      fireEvent.press(getByLabelText(i < 2 ? 'Next game' : 'Finish world'));
    }
    await waitFor(() => expect(getByText('73')).toBeTruthy());
    expect(addRun).toHaveBeenCalledWith(0, [80, 80, 60]);
    // grow tells children (grow.world_played): the page waits for Grow to show as done.
    expect(awaitProgress).toHaveBeenCalledTimes(1);
    const [done] = awaitProgress.mock.calls[0] as [(a: unknown) => boolean];
    expect(done({ circles_done: { grow: false } })).toBe(false);
    expect(done({ circles_done: { grow: true } })).toBe(true);
    expect(getByText('Up 13 since last time!')).toBeTruthy();
    expect(getByText('Growing well')).toBeTruthy();
    expect(getByText('Skill one')).toBeTruthy(); // strongest
    expect(getByText('Skill three tip')).toBeTruthy(); // keep practising
    expect(getByText('Make your bed.')).toBeTruthy();
    fireEvent.press(getByLabelText('Pick another world'));
    expect(getByText('Self Care')).toBeTruthy();
  });

  it("stays on the last game when the world doesn't save, and saves on a retry", async () => {
    const saved: KidWorlds = {
      ...WORLDS,
      runs: {
        '0': [
          ...(WORLDS.runs['0'] ?? []),
          { total: 71, scores: [70, 70, 70], at: '2026-11-11T10:00:00Z' },
        ],
      },
    };
    const addRun = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(saved);
    const awaitProgress = jest.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <GrowWorlds
        worlds={WORLDS}
        saving={false}
        addRun={addRun}
        awaitProgress={awaitProgress}
      />,
    );
    fireEvent.press(getByLabelText('Self Care, completed, last 60'));
    mockScore = 70;
    for (const i of [0, 1, 2]) {
      fireEvent.press(getByLabelText('Play'));
      fireEvent.press(getByLabelText('Finish this game'));
      fireEvent.press(getByLabelText(i < 2 ? 'Next game' : 'Finish world'));
    }
    const note = "That world didn't save. Tap Finish world to try again.";
    await waitFor(() => expect(getByText(note)).toBeTruthy());
    // No report: the last game's result stays, with Finish world to try again.
    expect(queryByText('Pick another world')).toBeNull();
    expect(awaitProgress).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Finish world'));
    // The report shows the kept total (the server's), not one worked out on the device.
    await waitFor(() => expect(getByText('71')).toBeTruthy());
    expect(addRun).toHaveBeenCalledTimes(2);
    expect(awaitProgress).toHaveBeenCalledTimes(1);
    expect(queryByText(note)).toBeNull();
  });

  it('shows each game score and band, and plays a game again', () => {
    mockScore = 90;
    const { getByLabelText, getByText, queryByText } = render(
      <GrowWorlds
        worlds={WORLDS}
        saving={false}
        addRun={jest.fn()}
        awaitProgress={jest.fn()}
      />,
    );
    fireEvent.press(getByLabelText('Self Care, completed, last 60'));
    fireEvent.press(getByLabelText('Play'));
    fireEvent.press(getByLabelText('Finish this game'));
    expect(getByText('Super strong')).toBeTruthy();
    fireEvent.press(getByLabelText('Try again'));
    expect(queryByText('Well done!')).toBeNull();
    expect(getByLabelText('Finish this game')).toBeTruthy();
  });
});
