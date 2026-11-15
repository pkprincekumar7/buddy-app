import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import GameDialog from '@/components/kids/GameDialog';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortalHost } from '@/components/ui/portal';
import type { KidPower } from '@/api/discover';

/** The dialog pads the backdrop by the safe area. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const FOCUS: KidPower = {
  name: 'Focus',
  game: 'focus',
  level: 5,
  line: 'Line',
  try_this: 'Try',
};

function setup(best: number | undefined) {
  const onFinish = jest.fn();
  const onClose = jest.fn();
  const view = render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PortalHost>
        <GameDialog
          power={FOCUS}
          best={best}
          onClose={onClose}
          onFinish={onFinish}
        />
      </PortalHost>
    </SafeAreaProvider>,
  );
  fireEvent(view.getByTestId('kids-game'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 300 } },
  });
  const finish = () => {
    act(() => jest.advanceTimersByTime(3000));
    for (let i = 0; i < 5; i++) {
      fireEvent(view.getByLabelText('The light'), 'pressIn');
    }
    act(() => jest.advanceTimersByTime(500));
  };
  return { ...view, onFinish, onClose, finish };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('GameDialog', () => {
  it('times the first round, saves it and shows it', () => {
    const { getByText, onFinish, finish } = setup(undefined);
    expect(getByText('Tap the light 5 times. It moves fast!')).toBeTruthy();
    finish();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(3);
    expect(getByText('You did it!')).toBeTruthy();
    expect(getByText('First try!')).toBeTruthy();
    expect(getByText('3.0')).toBeTruthy();
  });

  it("doesn't save a slower round, and says the best to beat", () => {
    const { getByText, getByLabelText, onFinish, finish } = setup(1.5);
    finish();
    expect(onFinish).not.toHaveBeenCalled();
    expect(getByText('Best: 1.5s')).toBeTruthy();
    fireEvent.press(getByLabelText('Play again'));
    expect(getByText('Tap the light 5 times. It moves fast!')).toBeTruthy();
  });

  it('closes on ×', () => {
    const { getByLabelText, onClose } = setup(undefined);
    fireEvent.press(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a press on the backdrop', () => {
    const { getByTestId, onClose } = setup(undefined);
    fireEvent.press(getByTestId('kids-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
