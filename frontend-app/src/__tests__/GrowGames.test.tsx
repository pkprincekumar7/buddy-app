import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import GrowGame from '@/components/kids/GrowGames';
import type { GrowGameType } from '@/api/kidWorlds';

const SIZE = 300;

function play(type: GrowGameType, cfg: Record<string, unknown>) {
  const onDone = jest.fn();
  const view = render(<GrowGame type={type} cfg={cfg} onDone={onDone} />);
  fireEvent(view.getByTestId('kids-game'), 'layout', {
    nativeEvent: { layout: { width: SIZE, height: SIZE } },
  });
  return { ...view, onDone };
}
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the grow games: each one ends and reports once', () => {
  it('catch: when the time is up', () => {
    const { onDone } = play('catch', { good: ['Water'], bad: ['Candy'] });
    advance(19_000);
    expect(onDone).not.toHaveBeenCalled();
    advance(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].line).toMatch(/caught/);
  });

  it('sort: after every card', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      text: `c${i}`,
      right: i % 2 === 0,
    }));
    const { getByLabelText, onDone } = play('sort', {
      left: 'No',
      right: 'Yes',
      items,
    });
    for (let i = 0; i < 8; i++) {
      fireEvent.press(getByLabelText('Yes'));
      advance(600);
    }
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].line).toMatch(/^4 of 8 right/);
  });

  it('memory: a level right, then two lives lost', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // every step lights the first pad
    const { getByLabelText, onDone } = play('memory', {
      pads: ['A', 'B', 'C', 'D'],
    });
    advance(700 + 2 * 660 + 50); // the pattern of two plays
    fireEvent.press(getByLabelText('A'));
    fireEvent.press(getByLabelText('A'));
    advance(600 + 700 + 3 * 660 + 50); // the next level plays
    fireEvent.press(getByLabelText('B'));
    advance(900 + 700 + 3 * 660 + 50);
    fireEvent.press(getByLabelText('B'));
    advance(1000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0]).toEqual({
      score: 25,
      line: 'Remembered 2 in a row',
    });
  });

  it('timing: every beat counted, tapped or not', () => {
    const { getByLabelText, onDone } = play('timing', {
      label: 'Jump',
      n: 3,
      per: 1000,
    });
    advance(900 + 1000); // the first beat meets
    fireEvent(getByLabelText('Jump: tap when the rings meet'), 'pressIn');
    advance(10_000); // the other two go by
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].line).toBe('1 perfect, 0 good, 2 missed');
  });

  it('dash: when the time is up, with what was picked', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const { getAllByLabelText, onDone } = play('dash', {
      items: [{ text: 'Rocket', kind: 'Go' }],
    });
    advance(200);
    fireEvent(getAllByLabelText('Rocket')[0]!, 'pressIn');
    advance(20_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].line).toMatch(
      /^[1-9]\d* picked, 1 kinds$/,
    );
  });

  it('react: after five lights, counting a tap too soon', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const { getByLabelText, onDone } = play('react', { label: 'Tap!', n: 5 });
    fireEvent(getByLabelText('Wait for the light'), 'pressIn'); // too soon
    for (let i = 0; i < 5; i++) {
      advance(900);
      fireEvent(getByLabelText('Tap!'), 'pressIn');
    }
    advance(600);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].line).toMatch(/1 too soon$/);
  });

  it('spark: when the time is up, with the sky lit', () => {
    const { getByTestId, onDone } = play('spark', { time: 15 });
    const sky = getByTestId('kids-grow-spark');
    fireEvent(sky, 'layout', {
      nativeEvent: { layout: { width: SIZE, height: SIZE } },
    });
    const at = (x: number, y: number) => ({
      nativeEvent: { locationX: x, locationY: y },
    });
    fireEvent(sky, 'responderGrant', at(5, 5));
    for (let x = 10; x < SIZE; x += 10)
      fireEvent(sky, 'responderMove', at(x, 5));
    advance(16_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].line).toBe(
      'Lit 10% of the sky with 1 colours',
    );
  });
});
