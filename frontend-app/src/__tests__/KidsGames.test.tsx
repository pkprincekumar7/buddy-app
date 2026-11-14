import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import KidsGame from '@/components/kids/KidsGames';
import type { GameKey } from '@/lib/kidsGames';

const SIZE = 300;

function play(game: GameKey) {
  const onWin = jest.fn();
  const view = render(<KidsGame game={game} onWin={onWin} />);
  fireEvent(view.getByTestId('kids-game'), 'layout', {
    nativeEvent: { layout: { width: SIZE, height: SIZE } },
  });
  return { ...view, onWin };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the mini games: each one finishes and reports once', () => {
  it('focus: five catches of the light', () => {
    const { getByLabelText, onWin } = play('focus');
    for (let i = 0; i < 4; i++)
      fireEvent(getByLabelText('The light'), 'pressIn');
    expect(onWin).not.toHaveBeenCalled();
    fireEvent(getByLabelText('The light'), 'pressIn');
    fireEvent(getByLabelText('The light'), 'pressIn');
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('curious: opening every box finds the three planets', () => {
    const { getByLabelText, getAllByLabelText, onWin } = play('curious');
    for (let i = 1; i <= 9; i++)
      fireEvent(getByLabelText(`Box ${i}`), 'pressIn');
    expect(getAllByLabelText('A planet!')).toHaveLength(3);
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('order: the stars from 1 to 6, after a wrong one', () => {
    const { getByLabelText, onWin } = play('order');
    fireEvent(getByLabelText('Star 3'), 'pressIn');
    for (let i = 1; i <= 6; i++)
      fireEvent(getByLabelText(`Star ${i}`), 'pressIn');
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('draw: enough line fills the sky', () => {
    const { getByTestId, onWin } = play('draw');
    const sky = getByTestId('kids-game');
    const touch = (x: number, y: number) => ({
      nativeEvent: { locationX: x, locationY: y },
    });
    fireEvent(sky, 'responderGrant', touch(0, 0));
    // Back and forth across the sky: 100 units each way.
    for (let sweep = 0; sweep < 8; sweep++) {
      for (let step = 1; step <= 30; step++) {
        const x = sweep % 2 === 0 ? step * 10 : SIZE - step * 10;
        fireEvent(sky, 'responderMove', touch(x, 150));
      }
    }
    fireEvent(sky, 'responderRelease');
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('climb: fast taps reach the top', () => {
    const { getByLabelText, onWin } = play('climb');
    for (let i = 0; i < 20; i++) fireEvent(getByLabelText('Climb'), 'pressIn');
    act(() => jest.advanceTimersByTime(600));
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('voice: holding long enough makes it big', () => {
    const { getByLabelText, onWin } = play('voice');
    fireEvent(getByLabelText('Press and hold'), 'pressIn');
    act(() => jest.advanceTimersByTime(2000));
    expect(onWin).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1000));
    fireEvent(getByLabelText('Press and hold'), 'pressOut');
    act(() => jest.advanceTimersByTime(1000));
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('energy: ten popped bubbles', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01); // a new bubble every tick
    const { queryAllByLabelText, onWin } = play('energy');
    let popped = 0;
    while (popped < 12) {
      act(() => jest.advanceTimersByTime(40));
      for (const b of queryAllByLabelText('A bubble')) {
        fireEvent(b, 'pressIn');
        popped += 1;
      }
    }
    expect(onWin).toHaveBeenCalledTimes(1);
  });
});
