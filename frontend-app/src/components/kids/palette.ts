/**
 * The kids page's styles (web index.css .kids-* classes and components/kids/palette.ts),
 * from the same --kids-* tokens (`yarn theme:sync`). The web points CSS variables at the
 * open circle's pair; here each style is built for its colour.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { css, font, rgb } from '@/theme';
import type { KidsColor } from '@/lib/kidsMoods';

const fill = (c: KidsColor, alpha?: number) => rgb(`kids-${c}`, alpha);
const shade = (c: KidsColor) => rgb(`kids-${c}-shade`);

/** `.kids-page`: the glow over the kids background. */
export const PAGE: ViewStyle = {
  experimental_backgroundImage: css(
    'radial-gradient(ellipse at 85% -10%, rgb(var(--kids-discover-rgb) / 0.2), transparent 50%), radial-gradient(ellipse at 5% 60%, rgb(var(--kids-release-rgb) / 0.16), transparent 45%), radial-gradient(ellipse at 70% 110%, rgb(var(--kids-transform-rgb) / 0.12), transparent 45%)',
  ),
  backgroundColor: rgb('kids-bg'),
};

/** `.kids-btn`: the chunky button in `c`, on its shade (pressed: pushed down). */
export function button(c: KidsColor, pressed = false): ViewStyle {
  return {
    backgroundColor: fill(c),
    borderRadius: 999,
    boxShadow: `0 ${pressed ? 1 : 6}px 0 ${shade(c)}`,
    transform: [{ translateY: pressed ? 5 : 0 }],
  };
}

/** `.kids-btn-off`. */
export function buttonOff(pressed = false): ViewStyle {
  return {
    backgroundColor: rgb('kids-off'),
    borderRadius: 999,
    boxShadow: `0 ${pressed ? 1 : 5}px 0 ${rgb('kids-off-shade')}`,
    transform: [{ translateY: pressed ? 4 : 0 }],
  };
}

/** `.kids-card`: a panel tinted with `c`. */
export function card(c: KidsColor): ViewStyle {
  return {
    backgroundColor: fill(c, 0.12),
    borderWidth: 3,
    borderColor: fill(c, 0.45),
    borderRadius: 28,
    padding: 24,
  };
}

/** `.kids-chip`. */
export function chip(c: KidsColor): ViewStyle {
  return {
    backgroundColor: fill(c, 0.14),
    borderWidth: 2,
    borderColor: fill(c),
    borderRadius: 999,
  };
}

/** `.kids-tile` / `.kids-tile-on`: a big pickable tile in `c`. */
export function tile(c: KidsColor, on: boolean, pressed = false): ViewStyle {
  return {
    backgroundColor: on ? fill(c, 0.22) : rgb('kids-off', 0.6),
    borderWidth: 3,
    borderColor: on ? fill(c) : fill(c, 0.3),
    borderRadius: 26,
    boxShadow: `0 7px 0 ${shade(c)}`,
    transform: [{ translateY: pressed ? 6 : 0 }],
  };
}

/** `.kids-input`. */
export function input(c: KidsColor, focused: boolean): TextStyle {
  return {
    ...font('rajdhani', 600),
    fontSize: 20,
    color: rgb('kids-text'),
    backgroundColor: rgb('kids-bg', 0.7),
    borderWidth: 3,
    borderColor: focused ? fill(c) : fill(c, 0.35),
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 110,
    textAlignVertical: 'top',
  };
}

/** The six pairs Discover's powers cycle through (web POWER_COLORS; power i takes [i % 6]). */
export const POWER_COLORS: readonly KidsColor[] = [
  'discover',
  'teal',
  'transform',
  'connect',
  'release',
  'orange',
];

/** `.kids-orbit-ring` (`dashed`: `.kids-orbit-ring-dashed`) around the child in `c`. */
export function orbitRing(c: KidsColor, dashed = false): ViewStyle {
  return {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
    borderStyle: dashed ? 'dashed' : 'solid',
    borderColor: fill(c, dashed ? 0.14 : 0.28),
  };
}

/** `.kids-avatar`: the child in the middle of the orbit. */
export function avatar(c: KidsColor): ViewStyle {
  return {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 3,
    borderColor: fill(c),
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: `radial-gradient(circle at 50% 35%, ${fill(
      c,
      0.35,
    )}, ${rgb('kids-bg')})`,
    boxShadow: `0 0 40px ${fill(c, 0.35)}`,
  };
}

/** `.kids-power`, `-open` and `-on`: a power's bubble, cyan (the prototype's), its edge
 * gold once opened, lit while its game is open (pressed: a little smaller). */
export function power(
  opened: boolean,
  on: boolean,
  pressed = false,
): ViewStyle {
  return {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: on
      ? fill('discover')
      : opened
      ? rgb('kids-streak', 0.6)
      : fill('discover', 0.4),
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: on
      ? `radial-gradient(circle at 50% 35%, ${fill('discover', 0.85)}, ${shade(
          'discover',
        )})`
      : `radial-gradient(circle at 50% 35%, ${rgb(
          'kids-discover-shade',
          0.55,
        )}, ${rgb('kids-bg', 0.95)})`,
    boxShadow: on
      ? `0 0 40px ${fill('discover', 0.55)}`
      : `0 0 24px ${fill('discover', 0.15)}`,
    transform: [{ scale: pressed ? 0.97 : 1 }],
  };
}

/** Discover's heading and orbit pieces (web .kids-eyebrow, -twinkle, -orbit-glow, -orbit-spoke,
 * -photo-ring, -photo, -name-pill, -count-pill, -power-label). */
export const discoverPage = {
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: rgb('kids-streak', 0.55),
    backgroundColor: rgb('kids-streak', 0.08),
  } satisfies ViewStyle,
  eyebrowText: {
    ...font('rajdhani', 700),
    fontSize: 11,
    letterSpacing: 11 * 0.06,
    textTransform: 'uppercase',
    color: rgb('kids-streak'),
  } satisfies TextStyle,
  twinkle: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: rgb('kids-streak'),
    boxShadow: `0 0 10px ${rgb('kids-streak')}`,
  } satisfies ViewStyle,
  title: {
    ...font('orbitron', 700),
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: 32 * 0.02,
    textAlign: 'center',
    color: rgb('kids-text'),
  } satisfies TextStyle,
  line: {
    ...font('rajdhani', 600),
    fontSize: 19,
    lineHeight: 26,
    textAlign: 'center',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    experimental_backgroundImage: `radial-gradient(circle at 50% 50%, ${fill(
      'discover',
      0.16,
    )}, transparent 62%)`,
  } satisfies ViewStyle,
  photoRing: {
    position: 'absolute',
    borderRadius: 9999,
    padding: 5,
    backgroundColor: fill('discover'),
    boxShadow: `0 0 50px ${fill('discover', 0.35)}`,
  } satisfies ViewStyle,
  photo: {
    flex: 1,
    borderRadius: 9999,
    borderWidth: 4,
    borderColor: rgb('kids-bg'),
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: rgb('kids-discover-shade', 0.6),
  } satisfies ViewStyle,
  namePill: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover', 0.5),
    backgroundColor: rgb('kids-bg', 0.92),
  } satisfies ViewStyle,
  nameText: {
    ...font('orbitron', 600),
    fontSize: 12,
    letterSpacing: 12 * 0.18,
    textTransform: 'uppercase',
    color: rgb('kids-text'),
  } satisfies TextStyle,
  powerLabel: {
    ...font('rajdhani', 700),
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  } satisfies TextStyle,
  countPill: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover'),
    experimental_backgroundImage: `linear-gradient(180deg, ${fill(
      'discover',
      0.25,
    )}, ${rgb('kids-discover-shade', 0.35)})`,
    boxShadow: `0 0 30px ${fill('discover', 0.3)}`,
  } satisfies ViewStyle,
  countText: {
    ...font('orbitron', 700),
    fontSize: 15,
    letterSpacing: 15 * 0.08,
    color: rgb('kids-text'),
  } satisfies TextStyle,
};

/** A spoke from the orbit's centre to a power (web .kids-orbit-spoke, -on), `length` long. */
export function spoke(length: number, on: boolean): ViewStyle {
  return {
    position: 'absolute',
    height: 1,
    width: length,
    experimental_backgroundImage: `linear-gradient(90deg, transparent 40%, ${fill(
      'discover',
      on ? 0.8 : 0.3,
    )})`,
  };
}

/** `.kids-quest` / `-done`: a quest's card in `c`, teal once it's done. */
export function questCard(c: KidsColor, done: boolean): ViewStyle {
  return {
    borderRadius: 26,
    padding: 20,
    borderWidth: 3,
    backgroundColor: done ? fill('teal', 0.12) : fill(c, 0.1),
    borderColor: done ? fill('teal') : fill(c, 0.5),
  };
}

/** `.kids-quest-dot` / `-on`: one time a quest is to be done. */
export function questDot(c: KidsColor, on: boolean): ViewStyle {
  return {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: on ? fill(c) : fill(c, 0.4),
    backgroundColor: on ? fill(c) : undefined,
  };
}

/** The mini games' pieces (web .kids-game-*), from the same tokens. */
export const game = {
  frame: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: fill('discover', 0.3),
    experimental_backgroundImage: `radial-gradient(circle at 50% 40%, ${rgb(
      'kids-discover-shade',
      0.45,
    )}, ${rgb('kids-bg')} 78%)`,
  } satisfies ViewStyle,
  bar: {
    position: 'absolute',
    left: '6%',
    right: '6%',
    top: '5%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: fill('discover', 0.14),
  } satisfies ViewStyle,
  barFill: {
    height: '100%',
    borderRadius: 4,
    experimental_backgroundImage: `linear-gradient(90deg, ${fill(
      'discover',
    )}, ${rgb('kids-streak')})`,
  } satisfies ViewStyle,
  sky: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: rgb('kids-text'),
  } satisfies ViewStyle,
  caption: {
    ...font('rajdhani', 700),
    fontSize: 16,
    letterSpacing: 16 * 0.22,
    textTransform: 'uppercase',
    color: rgb('kids-muted'),
  } satisfies TextStyle,
  orb: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 9999,
    experimental_backgroundImage: `radial-gradient(circle at 40% 35%, ${rgb(
      'kids-text',
    )}, ${fill('discover')} 45%, ${shade('discover')})`,
    boxShadow: `0 0 24px ${fill('discover', 0.8)}`,
  } satisfies ViewStyle,
  bubble: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: fill('discover', 0.8),
    experimental_backgroundImage: `radial-gradient(circle at 32% 30%, ${rgb(
      'kids-text',
      0.95,
    )}, ${fill('discover', 0.25)} 35%, ${fill('discover', 0.12)} 70%)`,
  } satisfies ViewStyle,
  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: fill('discover', 0.5),
  } satisfies ViewStyle,
  wave: {
    width: 6,
    borderRadius: 3,
    backgroundColor: fill('discover'),
  } satisfies ViewStyle,
  number: {
    ...font('orbitron', 700),
    fontSize: 20,
    color: rgb('kids-text'),
  } satisfies TextStyle,
  /** The overlay the game is played in. */
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: rgb('kids-bg', 0.85),
  } satisfies ViewStyle,
  dialog: {
    borderRadius: 28,
    padding: 18,
    borderWidth: 2,
    borderColor: fill('discover', 0.4),
    backgroundColor: rgb('kids-bg'),
    boxShadow: `0 0 60px ${fill('discover', 0.25)}`,
  } satisfies ViewStyle,
};

/** Grow's game pieces (web .kids-game-pill, -basket, -card, -side, -pad, -target, -light). */
export const grow = {
  pill: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: fill('discover'),
    experimental_backgroundImage: `radial-gradient(circle at 40% 30%, ${fill(
      'discover',
      0.6,
    )}, ${rgb('kids-discover-shade', 0.9)})`,
  } satisfies ViewStyle,
  pillText: {
    ...font('orbitron', 700),
    fontSize: 13,
    color: rgb('kids-text'),
  } satisfies TextStyle,
  basket: {
    position: 'absolute',
    left: 0,
    borderWidth: 3,
    borderTopWidth: 0,
    borderColor: rgb('kids-streak'),
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    experimental_backgroundImage: `linear-gradient(180deg, transparent, ${rgb(
      'kids-streak',
      0.35,
    )})`,
  } satisfies ViewStyle,
  cardText: {
    ...font('orbitron', 700),
    fontSize: 19,
    lineHeight: 26,
    textAlign: 'center',
    color: rgb('kids-text'),
  } satisfies TextStyle,
  sideText: {
    ...font('rajdhani', 700),
    fontSize: 15,
    letterSpacing: 15 * 0.12,
    textTransform: 'uppercase',
    color: rgb('kids-text'),
  } satisfies TextStyle,
  closing: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 9999,
    borderWidth: 4,
    borderColor: fill('discover'),
  } satisfies ViewStyle,
  light: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: `radial-gradient(circle at 40% 35%, ${rgb(
      'kids-text',
    )}, ${rgb('kids-streak')} 45%, ${shade('transform')})`,
    boxShadow: `0 0 50px ${rgb('kids-streak', 0.8)}`,
  } satisfies ViewStyle,
  word: {
    ...font('orbitron', 900),
    fontSize: 24,
  } satisfies TextStyle,
};

/** The sort card (web .kids-game-card, -right, -wrong). */
export function sortCard(state: 'shown' | 'right' | 'wrong'): ViewStyle {
  return {
    position: 'absolute',
    left: '11%',
    right: '11%',
    top: '22%',
    minHeight: '34%',
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor:
      state === 'right'
        ? rgb('kids-streak')
        : state === 'wrong'
        ? fill('connect')
        : fill('discover', 0.5),
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-discover-shade',
      0.6,
    )}, ${rgb('kids-bg')})`,
  };
}

/** A sort side's button in `c` (web .kids-game-side). */
export function sortSide(c: KidsColor, pressed = false): ViewStyle {
  return {
    flex: 1,
    minHeight: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: fill(c),
    experimental_backgroundImage: `linear-gradient(180deg, ${fill(
      c,
      0.35,
    )}, ${rgb(`kids-${c}-shade`, 0.6)})`,
    transform: [{ scale: pressed ? 0.97 : 1 }],
  };
}

/** A memory pad in `c`, lit or not (web .kids-game-pad, -lit). */
export function memoryPad(c: KidsColor, lit: boolean): ViewStyle {
  return {
    width: '42%',
    aspectRatio: 1,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: lit ? rgb('kids-text') : fill(c, 0.6),
    experimental_backgroundImage: lit
      ? `radial-gradient(circle at 40% 35%, ${rgb('kids-text')}, ${fill(
          c,
        )} 55%)`
      : `radial-gradient(circle at 40% 35%, ${fill(c, 0.35)}, ${rgb(
          'kids-bg',
          0.9,
        )} 75%)`,
    boxShadow: lit ? `0 0 50px ${fill(c)}` : undefined,
    transform: [{ scale: lit ? 1.06 : 1 }],
  };
}

/** The timing target (web .kids-game-target, -near). */
export function timingTarget(near: boolean): ViewStyle {
  return {
    position: 'absolute',
    left: '37%',
    top: '37%',
    width: '26%',
    height: '26%',
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: near ? rgb('kids-text') : rgb('kids-streak'),
    backgroundColor: rgb('kids-streak', 0.15),
    boxShadow: near ? `0 0 40px ${rgb('kids-streak', 0.8)}` : undefined,
  };
}

/** A score's bar in the world report, in `c` (web .kids-score-bar). */
export function scoreBar(
  c: KidsColor,
  score: number,
): { track: ViewStyle; fill: ViewStyle } {
  return {
    track: {
      height: 12,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: rgb('kids-text', 0.08),
    },
    fill: {
      height: '100%',
      width: `${Math.max(0, Math.min(100, score))}%`,
      borderRadius: 999,
      backgroundColor: fill(c),
    },
  };
}

/** A mystery box (web .kids-game-box, -open, -found). */
export function gameBox(open: boolean, found: boolean): ViewStyle {
  return {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 18,
    borderWidth: found ? 2 : 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: found ? rgb('kids-streak') : fill('discover', 0.4),
    experimental_backgroundImage: found
      ? `radial-gradient(circle, ${rgb('kids-streak', 0.25)}, ${rgb(
          'kids-bg',
          0.9,
        )})`
      : open
      ? undefined
      : `linear-gradient(160deg, ${fill('discover', 0.35)}, ${rgb(
          'kids-discover-shade',
          0.5,
        )})`,
    backgroundColor: open && !found ? rgb('kids-bg', 0.7) : undefined,
  };
}

/** A star to tap in order (web .kids-game-node, -next, -done, -wrong). */
export function gameNode(
  state: 'waiting' | 'next' | 'done' | 'wrong',
): ViewStyle {
  return {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor:
      state === 'done'
        ? rgb('kids-streak')
        : state === 'next'
        ? fill('discover')
        : state === 'wrong'
        ? fill('connect')
        : fill('discover', 0.35),
    experimental_backgroundImage:
      state === 'done'
        ? `radial-gradient(circle, ${rgb('kids-streak')}, ${shade(
            'transform',
          )})`
        : undefined,
    backgroundColor: state === 'done' ? undefined : rgb('kids-bg', 0.85),
  };
}

/** A colour of the palette, for icons and SVG strokes. */
export const color = (
  c:
    | KidsColor
    | `${KidsColor}-shade`
    | 'text'
    | 'ink'
    | 'streak'
    | 'body'
    | 'muted'
    | 'off',
) => rgb(`kids-${c}`);

/** Text styles (web Orbitron/Rajdhani with the prototype's sizes). */
export const text = {
  heading: {
    ...font('orbitron', 900),
    color: rgb('kids-text'),
  } satisfies TextStyle,
  label: {
    ...font('rajdhani', 700),
    color: rgb('kids-text'),
  } satisfies TextStyle,
  body: {
    ...font('rajdhani', 600),
    color: rgb('kids-body'),
  } satisfies TextStyle,
  muted: {
    ...font('rajdhani', 600),
    color: rgb('kids-muted'),
  } satisfies TextStyle,
};
