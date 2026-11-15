import React, { useState, type ReactNode } from 'react';
import { Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, {
  useReducedMotion,
  type CSSAnimationKeyframes,
} from 'react-native-reanimated';
import { rgb } from '@/theme';
import type { Burst } from '@/lib/kidsBursts';
import { color, game } from '@/components/kids/palette';
import { loop } from '@/components/kids/enter';

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
 * the dialog fits on screen; Grow's (`.kids-game-grow`) at most `min(100%, 540px, 100vh -
 * 300px)`, at least 260px. For the frame and for a Pressable that wraps one. */
export function useFrameWidth(grow = false): ViewStyle {
  const { height } = useWindowDimensions();
  return grow
    ? {
        width: '100%',
        maxWidth: Math.max(260, Math.min(540, height - 300)),
        minWidth: 260,
        alignSelf: 'center',
      }
    : {
        width: '100%',
        maxWidth: Math.max(220, height - 260),
        minWidth: 220,
        alignSelf: 'center',
      };
}

/** A wrong memory tap: the frame fades back in (web .kids-game-flash). */
const FLASH: CSSAnimationKeyframes = {
  from: { opacity: 0 },
  to: { opacity: 1 },
};

/** The square a game is played in; `children` gets its width in points. `grow`: Grow's size;
 * `flash`: fades it back in (a wrong memory tap). */
export function Frame({
  children,
  grow = false,
  flash = false,
}: {
  children: (size: number) => ReactNode;
  grow?: boolean;
  flash?: boolean;
}) {
  const [size, setSize] = useState(0);
  const width = useFrameWidth(grow);
  const reduced = useReducedMotion();
  return (
    <Animated.View
      testID="kids-game"
      style={[
        game.frame,
        width,
        flash && !reduced
          ? {
              animationName: FLASH,
              animationDuration: '0.3s',
              animationTimingFunction: 'ease',
            }
          : null,
      ]}
      onLayout={e => setSize(e.nativeEvent.layout.width)}
    >
      {size > 0 ? children(size) : null}
    </Animated.View>
  );
}

/** web kids-twinkle. */
const TWINKLE: CSSAnimationKeyframes = {
  '0%': { opacity: 0.25 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.25 },
};

/** The sky's seven stars, each twinkling at its own pace (1.4 s, then .3 s slower each). */
export function Sky() {
  const reduced = useReducedMotion();
  return SKY.map(([x, y], i) => (
    <Animated.View
      key={`${x}-${y}`}
      pointerEvents="none"
      style={[
        game.sky,
        { left: `${x}%`, top: `${y}%` },
        loop(TWINKLE, 1.4 + i * 0.3, 0, 'ease-in-out', reduced),
      ]}
    />
  ));
}

/** `.kids-game-bar-fill`'s glow. */
const BAR_GLOW = {
  boxShadow: `0 0 12px ${rgb('kids-discover', 0.7)}`,
} as const;

/** web kids-burst: a ring that grows from .4 to 2.6 times its size as it fades. */
const BURST: CSSAnimationKeyframes = {
  from: { opacity: 1, transform: [{ scale: 0.4 }] },
  to: { opacity: 0, transform: [{ scale: 2.6 }] },
};

/** The bursts (lib/kidsBursts) in a `size`-wide frame: gold, red or cyan by tone. None
 * when the device asks for reduced motion, as the web hides them. */
export function Bursts({ list, size }: { list: Burst[]; size: number }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const d = 0.16 * size;
  return list.map(b => (
    <Animated.View
      key={b.key}
      pointerEvents="none"
      style={{
        position: 'absolute',
        borderRadius: 9999,
        borderWidth: 3,
        borderColor: rgb(
          `kids-${
            b.tone === 'wrong'
              ? 'wrong'
              : b.tone === 'cyan'
              ? 'discover'
              : 'gold'
          }`,
        ),
        width: d,
        height: d,
        left: (b.x / 100) * size - d / 2,
        top: (b.y / 100) * size - d / 2,
        animationName: BURST,
        animationDuration: '0.6s',
        animationTimingFunction: 'ease-out',
        animationFillMode: 'forwards',
      }}
    />
  ));
}

export function Bar({ value }: { value: number }) {
  const reduced = useReducedMotion();
  return (
    <View pointerEvents="none" style={game.bar}>
      {/* The fill eases to its new width (web transition-[width] duration-200). */}
      <Animated.View
        style={[
          game.barFill,
          BAR_GLOW,
          { width: `${Math.max(0, Math.min(1, value)) * 100}%` },
          !reduced && {
            transitionProperty: 'width',
            transitionDuration: 200,
          },
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
          {
            position: 'absolute',
            left: '6%',
            top: '9%',
            fontSize: 16,
            color: color('world-name'),
          },
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
            color: color('gold'),
          },
        ]}
      >
        {right}
      </Text>
    </>
  );
}
