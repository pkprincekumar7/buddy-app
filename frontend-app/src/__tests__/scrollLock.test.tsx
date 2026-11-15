import React, { useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { render } from '@testing-library/react-native';
import PageScroll from '@/components/layout/PageScroll';
import GrowGame from '@/components/kids/GrowGames';
import { useLockScroll } from '@/lib/scrollLock';

jest.mock('@/components/layout/PageBackRow', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function Locker() {
  const box = useRef<View>(null);
  useLockScroll(box);
  return <View ref={box} />;
}

const scrollEnabled = (view: ReturnType<typeof render>) =>
  view.UNSAFE_getByType(ScrollView).props.scrollEnabled;

describe('a game locks the page scroll while it follows a finger', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('scrolls as usual with no game in it', () => {
    const view = render(
      <PageScroll>
        <View />
      </PageScroll>,
    );
    expect(scrollEnabled(view)).toBe(true);
  });

  it('stops scrolling while a game is in it, and scrolls again after', () => {
    const view = render(
      <PageScroll>
        <Locker />
      </PageScroll>,
    );
    expect(scrollEnabled(view)).toBe(false);
    view.rerender(
      <PageScroll>
        <View />
      </PageScroll>,
    );
    expect(scrollEnabled(view)).toBe(true);
  });

  it("keeps a page's own scrollEnabled={false}", () => {
    const view = render(
      <PageScroll scrollEnabled={false}>
        <View />
      </PageScroll>,
    );
    expect(scrollEnabled(view)).toBe(false);
  });

  it.each([
    ['catch', { good: ['Water'], bad: ['Candy'] }],
    ['spark', { time: 15 }],
  ] as const)('locks for Grow’s %s game', (type, cfg) => {
    const view = render(
      <PageScroll>
        <GrowGame type={type} cfg={cfg} onDone={jest.fn()} />
      </PageScroll>,
    );
    expect(scrollEnabled(view)).toBe(false);
  });

  it('leaves the page scrolling for a tap game', () => {
    const view = render(
      <PageScroll>
        <GrowGame
          type="memory"
          cfg={{ pads: ['A', 'B', 'C', 'D'] }}
          onDone={jest.fn()}
        />
      </PageScroll>,
    );
    expect(scrollEnabled(view)).toBe(true);
  });
});
