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
    const send = jest.fn().mockResolvedValue(null);
    const { getByLabelText, getByText } = render(
      <GrowWorlds worlds={WORLDS} saving={false} addRun={addRun} send={send} />,
    );
    expect(getByText('Last: 60')).toBeTruthy();
    fireEvent.press(getByLabelText('Self Care'));
    for (const [i, score] of [80, 80, 60].entries()) {
      mockScore = score;
      fireEvent.press(getByLabelText('Play'));
      fireEvent.press(getByLabelText('Finish this game'));
      expect(getByText(`scored ${score}`)).toBeTruthy();
      fireEvent.press(getByLabelText(i < 2 ? 'Next game' : 'Finish world'));
    }
    await waitFor(() => expect(getByText('73')).toBeTruthy());
    expect(addRun).toHaveBeenCalledWith(0, [80, 80, 60]);
    // Grow is done in child view: Transform opens next.
    expect(send).toHaveBeenCalledWith({ type: 'world_done', world: 0 });
    expect(getByText('Up 13 since last time!')).toBeTruthy();
    expect(getByText('Growing well')).toBeTruthy();
    expect(getByText('Skill one')).toBeTruthy(); // strongest
    expect(getByText('Skill three tip')).toBeTruthy(); // keep practising
    expect(getByText('Make your bed.')).toBeTruthy();
    fireEvent.press(getByLabelText('Pick another world'));
    expect(getByText('Self Care')).toBeTruthy();
  });

  it('shows each game score and band, and plays a game again', () => {
    mockScore = 90;
    const { getByLabelText, getByText, queryByText } = render(
      <GrowWorlds
        worlds={WORLDS}
        saving={false}
        addRun={jest.fn()}
        send={jest.fn()}
      />,
    );
    fireEvent.press(getByLabelText('Self Care'));
    fireEvent.press(getByLabelText('Play'));
    fireEvent.press(getByLabelText('Finish this game'));
    expect(getByText('Super strong')).toBeTruthy();
    fireEvent.press(getByLabelText('Try again'));
    expect(queryByText('Well done!')).toBeNull();
    expect(getByLabelText('Finish this game')).toBeTruthy();
  });
});
