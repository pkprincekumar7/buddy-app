import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import DiscoverPowers from '@/components/kids/DiscoverPowers';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortalHost } from '@/components/ui/portal';
import type { KidPowers } from '@/api/discover';
import type { KidActivity } from '@/api/kids';

/** The dialog pads the backdrop by the safe area. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const GAMES = [
  'focus',
  'curious',
  'order',
  'draw',
  'climb',
  'voice',
  'energy',
] as const;
const POWERS: KidPowers = {
  style: 'Thinker',
  style_line: 'You can think about one hard thing for a long time.',
  powers: GAMES.map((game, i) => ({
    name: `Power ${i}`,
    game,
    level: i === 0 ? 5 : 3,
    line: `Line ${i}`,
    try_this: `Try ${i}`,
  })),
};
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

function setup(a: KidActivity, send = jest.fn().mockResolvedValue(a)) {
  const view = render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PortalHost>
        <DiscoverPowers
          childName="Aarav Shah"
          powers={POWERS}
          activity={a}
          send={send}
        />
      </PortalHost>
    </SafeAreaProvider>,
  );
  // The orbit lays its bubbles out from its measured width.
  fireEvent(view.getByTestId('kids-orbit'), 'layout', {
    nativeEvent: { layout: { width: 320, height: 320 } },
  });
  return { ...view, send };
}

describe('DiscoverPowers', () => {
  it('shows the prototype heading, the child in the middle and every power', () => {
    const { getByText, getByLabelText } = setup(activity());
    expect(getByText('Hey Aarav, your superpowers are here!')).toBeTruthy();
    expect(getByText('The Thinker')).toBeTruthy();
    expect(getByText(POWERS.style_line)).toBeTruthy();
    expect(getByText('Aarav')).toBeTruthy();
    for (let i = 0; i < 7; i++) {
      expect(
        getByLabelText(`Power ${i}: play its game (not opened yet)`),
      ).toBeTruthy();
    }
    expect(getByText('7 superpowers unlocked')).toBeTruthy();
  });

  it('opens a power and its game; a later tap opens the game only', () => {
    const first = setup(activity());
    fireEvent.press(
      first.getByLabelText('Power 2: play its game (not opened yet)'),
    );
    expect(first.send).toHaveBeenCalledWith({ type: 'flip_power', power: 2 });
    expect(first.getByText('Tap the stars in order, 1 to 6.')).toBeTruthy();
    first.unmount();

    const again = setup(activity({ flipped_powers: [2] }));
    fireEvent.press(again.getByLabelText('Power 2: play its game'));
    expect(again.send).not.toHaveBeenCalled();
    expect(again.getByText('Tap the stars in order, 1 to 6.')).toBeTruthy();
  });

  it("saves a game's first time as its best", () => {
    jest.useFakeTimers();
    try {
      const { getByLabelText, getByTestId, send } = setup(
        activity({ flipped_powers: [0] }),
      );
      fireEvent.press(getByLabelText('Power 0: play its game'));
      fireEvent(getByTestId('kids-game'), 'layout', {
        nativeEvent: { layout: { width: 300, height: 300 } },
      });
      act(() => jest.advanceTimersByTime(2000));
      for (let i = 0; i < 5; i++) {
        fireEvent(getByLabelText('The light'), 'pressIn');
      }
      expect(send).toHaveBeenCalledWith({
        type: 'game_best',
        game: 'focus',
        seconds: 2,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
