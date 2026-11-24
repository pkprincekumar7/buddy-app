import React from 'react';
import { BackHandler, Text } from 'react-native';
import { render } from '@testing-library/react-native';

let mockRoute: { name: string; params?: Record<string, unknown> };
let mockCanGoBack = false;
let mockView: { mode: 'parent' } | { mode: 'child'; childId: string };
const mockResetTo = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual<object>('@react-navigation/native'),
    useRoute: () => mockRoute,
    useNavigation: () => ({ canGoBack: () => mockCanGoBack }),
    // Run the focus effect like a mount effect.
    useFocusEffect: (effect: () => void | (() => void)) =>
      ReactActual.useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/router', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/router')>('@/lib/router');
  return {
    buildPath: actual.buildPath,
    resetTo: (...a: unknown[]) => mockResetTo(...a),
  };
});
jest.mock('@/lib/ViewModeContext', () => ({
  useViewMode: () => ({ view: mockView }),
}));

import { withChildViewGuard } from '@/navigation/withChildViewGuard';

const Guarded = withChildViewGuard(() => <Text>screen</Text>);

beforeEach(() => {
  mockResetTo.mockReset().mockReturnValue(true);
  mockCanGoBack = false;
});

describe('withChildViewGuard', () => {
  it('shows every screen in parent view', () => {
    mockView = { mode: 'parent' };
    mockRoute = { name: 'Home' };
    expect(render(<Guarded />).getByText('screen')).toBeTruthy();
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  it("shows the child's circles and kids page in child view", () => {
    mockView = { mode: 'child', childId: 'a' };
    mockRoute = {
      name: 'PersonalityJourney',
      params: { childId: 'a', sub: 'DimensionCircles' },
    };
    expect(render(<Guarded />).getByText('screen')).toBeTruthy();
    mockRoute = { name: 'Kids', params: { childId: 'a', sub: 'grow' } };
    expect(render(<Guarded />).getByText('screen')).toBeTruthy();
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  it('sends any other screen back to the circles alone in child view', () => {
    mockView = { mode: 'child', childId: 'a' };
    for (const route of [
      { name: 'Home' },
      { name: 'GrowthAreas', params: { childId: 'a' } },
      { name: 'AccountSettings' },
      { name: 'Kids', params: { childId: 'b', sub: 'grow' } },
    ]) {
      mockRoute = route;
      mockResetTo.mockReset().mockReturnValue(true);
      expect(render(<Guarded />).queryByText('screen')).toBeNull();
      expect(mockResetTo).toHaveBeenCalledWith(
        '/PersonalityJourney/a/DimensionCircles',
      );
    }
  });

  it('tries again until navigation is ready, as on a cold start in child view', () => {
    jest.useFakeTimers();
    try {
      mockView = { mode: 'child', childId: 'a' };
      mockRoute = { name: 'Home' };
      // Not ready on the first two tries, then the reset takes.
      mockResetTo
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      const { unmount } = render(<Guarded />);
      expect(mockResetTo).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(200);
      expect(mockResetTo).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps Android's Back from leaving the bottom of the stack in child view", () => {
    const add = jest.spyOn(BackHandler, 'addEventListener');
    mockView = { mode: 'child', childId: 'a' };
    mockRoute = {
      name: 'PersonalityJourney',
      params: { childId: 'a', sub: 'DimensionCircles' },
    };
    render(<Guarded />);
    const handler = add.mock.calls.at(-1)?.[1] as () => boolean;
    expect(handler()).toBe(true);
    mockCanGoBack = true;
    expect(handler()).toBe(false);
    add.mockRestore();
  });
});
