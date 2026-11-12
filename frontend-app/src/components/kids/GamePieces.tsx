import React, { useState, type ReactNode } from 'react';
import { Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { rgb } from '@/theme';
import { color, game } from '@/components/kids/palette';

/**
 * The pieces every kids mini game draws (Discover's, 2.6, and Grow's, 3.5; web
 * components/kids/GamePieces): the frame (measured, so pieces are sized in points), the night
 * sky, the progress bar, the captions and the corner readouts.
 */

const SKY = [
  [12, 20],
  [80, 14],
  [66, 80],
  [20, 72],
  [44, 30],
  [88, 52],
  [8, 48],
] as const;

/** `.kids-game`'s width: centred, at most `min(100%, 100vh - 260px)`, at least 220px, so
 * the dialog fits on screen. For the frame and for a Pressable that wraps one. */
export function useFrameWidth(): ViewStyle {
  const { height } = useWindowDimensions();
  return {
    width: '100%',
    maxWidth: Math.max(220, height - 260),
    minWidth: 220,
    alignSelf: 'center',
  };
}

/** The square a game is played in; `children` gets its width in points. */
export function Frame({ children }: { children: (size: number) => ReactNode }) {
  const [size, setSize] = useState(0);
  const width = useFrameWidth();
  return (
    <View
      testID="kids-game"
      style={[game.frame, width]}
      onLayout={e => setSize(e.nativeEvent.layout.width)}
    >
      {size > 0 ? children(size) : null}
    </View>
  );
}

export function Sky() {
  return SKY.map(([x, y]) => (
    <View
      key={`${x}-${y}`}
      pointerEvents="none"
      style={[game.sky, { left: `${x}%`, top: `${y}%` }]}
    />
  ));
}

/** `.kids-game-bar-fill`'s glow. */
const BAR_GLOW = {
  boxShadow: `0 0 12px ${rgb('kids-discover', 0.7)}`,
} as const;

export function Bar({ value }: { value: number }) {
  return (
    <View pointerEvents="none" style={game.bar}>
      <View
        style={[
          game.barFill,
          BAR_GLOW,
          { width: `${Math.max(0, Math.min(1, value)) * 100}%` },
        ]}
      />
    </View>
  );
}

/** `.kids-game-caption`: text-lg, tracking 0.22em. */
export const CAPTION_TEXT = { fontSize: 18, letterSpacing: 18 * 0.22 } as const;

export function Caption({
  children,
  top,
}: {
  children: ReactNode;
  top?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      className="absolute left-0 right-0 items-center"
      // `top`: the web's `bottom-auto top-1/2` (its top edge at the middle).
      style={top ? { top: '50%' } : { bottom: '5%' }}
    >
      <Text style={[game.caption, CAPTION_TEXT]}>{children}</Text>
    </View>
  );
}

/** A round thing centred at (x%, y%) of a `size`-wide frame, `d`% across. */
export const at = (size: number, x: number, y: number, d: number) => {
  const px = (d / 100) * size;
  return {
    width: px,
    height: px,
    transform: [
      { translateX: (x / 100) * size - px / 2 },
      { translateY: (y / 100) * size - px / 2 },
    ],
  };
};

/** The score (left, light) and the time or count (right, gold) under the bar. */
export function Hud({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <>
      <Text
        pointerEvents="none"
        style={[
          game.number,
          { position: 'absolute', left: '6%', top: '9%', fontSize: 16 },
        ]}
      >
        {left}
      </Text>
      <Text
        pointerEvents="none"
        style={[
          game.number,
          {
            position: 'absolute',
            right: '6%',
            top: '9%',
            fontSize: 16,
            color: color('streak'),
          },
        ]}
      >
        {right}
      </Text>
    </>
  );
}
