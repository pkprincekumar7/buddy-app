/**
 * The kids page's styles (web index.css .kids-* classes and components/kids/palette.ts),
 * from the same --kids-* tokens (`yarn theme:sync`). The web points CSS variables at the
 * open circle's pair; here each style is built for its colour.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { css, font, rgb } from '@/theme';
import type { KidsColor } from '@/lib/kidsMoods';

/** A pair of the kids palette: the circles' and powers' colours, and Grow's gold. */
export type KidsPair = KidsColor | 'gold';

const fill = (c: KidsPair, alpha?: number) => rgb(`kids-${c}`, alpha);
const shade = (c: KidsPair) => rgb(`kids-${c}-shade`);

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
    borderRadius: 24,
    padding: 20,
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
    borderRadius: 22,
    boxShadow: `0 7px 0 ${shade(c)}`,
    transform: [{ translateY: pressed ? 6 : 0 }],
  };
}

/** `.kids-input`. */
export function input(c: KidsColor, focused: boolean): TextStyle {
  return {
    ...font('rajdhani', 600),
    fontSize: 16,
    color: rgb('kids-text'),
    backgroundColor: rgb('kids-bg', 0.7),
    borderWidth: 3,
    borderColor: focused ? fill(c) : fill(c, 0.35),
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 90,
    textAlignVertical: 'top',
  };
}

/** The kids palette's six pairs in the prototype's order (cyan, gold, teal, pink, violet,
 * orange): Transform's interests and quests and Connect's wins take them in turn. */
export const KIDS_COLORS: readonly KidsColor[] = [
  'discover',
  'transform',
  'teal',
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

/** `.kids-power`, `-open` and `-on`: a power's bubble, deep teal (the prototype's), its edge
 * gold once opened, lit cyan while its game is open (pressed: a little smaller). */
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
      ? rgb('kids-gold', 0.6)
      : fill('discover', 0.4),
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: on
      ? `radial-gradient(circle at 50% 35%, ${rgb('kids-orb-sky')}, ${rgb(
          'kids-orb-cyan-lo',
        )})`
      : `radial-gradient(circle at 50% 35%, ${rgb(
          'kids-world-card',
          0.9,
        )}, ${rgb('kids-world-deep', 0.95)})`,
    boxShadow: on
      ? `0 0 40px ${fill('discover', 0.55)}`
      : `0 0 24px ${rgb('kids-orb-sky', 0.15)}`,
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
    borderColor: rgb('kids-gold', 0.55),
    backgroundColor: rgb('kids-gold', 0.08),
  } satisfies ViewStyle,
  eyebrowText: {
    ...font('rajdhani', 700),
    fontSize: 12,
    letterSpacing: 12 * 0.06,
    textTransform: 'uppercase',
    color: rgb('kids-gold'),
  } satisfies TextStyle,
  twinkle: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: rgb('kids-gold'),
    boxShadow: `0 0 10px ${rgb('kids-gold')}`,
  } satisfies ViewStyle,
  title: {
    ...font('orbitron', 700),
    fontSize: 28,
    lineHeight: 28 * 1.08,
    letterSpacing: 28 * 0.02,
    textAlign: 'center',
    color: rgb('kids-heading'),
  } satisfies TextStyle,
  /** "The {style}": cyan with a glow. */
  titleGlow: {
    color: fill('discover'),
    textShadowColor: fill('discover', 0.45),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 28,
  } satisfies TextStyle,
  line: {
    ...font('rajdhani', 600),
    fontSize: 17,
    lineHeight: 17 * 1.375,
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
    borderColor: rgb('kids-world-deep'),
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: rgb('kids-world-card'),
  } satisfies ViewStyle,
  namePill: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover', 0.5),
    backgroundColor: rgb('kids-world-deep', 0.92),
  } satisfies ViewStyle,
  nameText: {
    ...font('orbitron', 600),
    fontSize: 14,
    letterSpacing: 14 * 0.18,
    textTransform: 'uppercase',
    color: rgb('kids-world-name'),
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
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-orb-sky',
      0.25,
    )}, ${rgb('kids-orb-cyan-lo', 0.35)})`,
    boxShadow: `0 0 30px ${fill('discover', 0.3)}`,
  } satisfies ViewStyle,
  countText: {
    ...font('orbitron', 700),
    fontSize: 14,
    letterSpacing: 14 * 0.08,
    color: rgb('kids-world-name'),
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
  const k: KidsColor = done ? 'teal' : c;
  return {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: 3,
    backgroundColor: fill(k, done ? 0.12 : 0.1),
    borderColor: done ? fill('teal') : fill(c, 0.5),
    boxShadow: `0 8px 0 ${shade(k)}`,
  };
}
/** A quest's progress ring (web .kids-quest-dot): 30 px, filled with a star up to the count. */
export function questDot(c: KidsColor, on: boolean): ViewStyle {
  return {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: on ? fill(c) : fill(c, 0.4),
    backgroundColor: on ? fill(c) : undefined,
  };
}
/** A quest's number (web .kids-quest-no): a rounded square in its colour. */
export function questNo(c: KidsColor): ViewStyle {
  return {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: fill(c),
  };
}
/** "I did it today" (web .kids-quest-log, -today, -done): a big circle in the quest's colour
 * on its shade (pressed: pushed down); off once logged today; teal once done. */
export function questLog(
  c: KidsColor,
  state: 'todo' | 'today' | 'done',
  pressed = false,
): ViewStyle {
  return {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
    backgroundColor:
      state === 'done'
        ? fill('teal')
        : state === 'today'
        ? rgb('kids-off')
        : fill(c),
    boxShadow:
      state === 'done'
        ? undefined
        : `0 8px 0 ${state === 'today' ? rgb('kids-off-shade') : shade(c)}`,
    transform: [{ translateY: pressed ? 6 : 0 }, { scale: pressed ? 0.98 : 1 }],
  };
}
/** Connect's pieces (web .kids-win, -on, .kids-win-card, -avatar, -name). */
export const connect = {
  /** A win to pick: neutral, pink when picked (pressed: slides right, the web's hover). */
  win: (on: boolean, pressed = false): ViewStyle => ({
    minHeight: 64,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 3,
    borderColor: on ? fill('connect') : rgb('kids-text', 0.1),
    backgroundColor: on ? fill('connect', 0.14) : rgb('kids-off', 0.6),
    transform: [{ translateX: pressed ? 4 : 0 }],
  }),
  winText: {
    ...font('rajdhani', 700),
    fontSize: 17,
    lineHeight: 17 * 1.25,
    color: rgb('kids-text'),
  } satisfies TextStyle,
  card: {
    minHeight: 280,
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 20,
    justifyContent: 'space-between',
    experimental_backgroundImage: `linear-gradient(160deg, ${fill(
      'connect',
    )}, ${fill('release')})`,
    boxShadow: `0 10px 0 ${shade('release')}`,
  } satisfies ViewStyle,
  label: {
    ...font('orbitron', 900),
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 14 * 0.14,
    color: rgb('kids-ink'),
  } satisfies TextStyle,
  title: {
    ...font('orbitron', 900),
    fontSize: 24,
    lineHeight: 24 * 1.15,
    color: rgb('kids-ink'),
  } satisfies TextStyle,
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: rgb('kids-ink'),
    backgroundColor: rgb('kids-streak'),
    boxShadow: `0 5px 0 ${shade('release')}`,
  } satisfies ViewStyle,
  initial: {
    ...font('orbitron', 900),
    fontSize: 26,
    lineHeight: 32,
    color: rgb('kids-ink'),
  } satisfies TextStyle,
  name: {
    ...font('rajdhani', 700),
    fontSize: 17,
    lineHeight: 22,
    color: rgb('kids-card-name'),
  } satisfies TextStyle,
};

/** An interest tile (web .kids-interest): solid in its colour on its shade. */
export function interestTile(c: KidsColor, pressed = false): ViewStyle {
  return {
    minHeight: 96,
    borderRadius: 24,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: fill(c),
    boxShadow: `0 7px 0 ${shade(c)}`,
    transform: [{ translateY: pressed ? 5 : 0 }],
  };
}
/** Transform's interest chip, "+ Add another" and "Back to my quests" (web
 * .kids-interest-chip, -on, .kids-interest-add, .kids-quests-back). */
export const interest = {
  chip: (on: boolean): ViewStyle => ({
    minHeight: 60,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 2,
    borderWidth: 2,
    borderColor: on ? fill('transform') : fill('transform', 0.45),
    backgroundColor: on ? fill('transform') : fill('transform', 0.08),
  }),
  add: (pressed: boolean): ViewStyle => ({
    minHeight: 60,
    borderRadius: 20,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: fill('transform', 0.5),
    backgroundColor: pressed ? fill('transform', 0.08) : undefined,
  }),
  back: (pressed: boolean): ViewStyle => ({
    height: 48,
    borderRadius: 999,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: fill('transform', 0.5),
    backgroundColor: pressed ? fill('transform', 0.08) : undefined,
  }),
};

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
      'kids-world-card',
    )}, ${rgb('kids-world-deep')} 78%)`,
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
    experimental_backgroundImage: `linear-gradient(90deg, ${rgb(
      'kids-orb-sky',
    )}, ${rgb('kids-gold')})`,
  } satisfies ViewStyle,
  sky: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: rgb('kids-world-name'),
  } satisfies ViewStyle,
  caption: {
    ...font('rajdhani', 700),
    fontSize: 16,
    letterSpacing: 16 * 0.22,
    textTransform: 'uppercase',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
  orb: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 9999,
    experimental_backgroundImage: `radial-gradient(circle at 40% 35%, ${rgb(
      'kids-world-name',
    )}, ${fill('discover')} 45%, ${rgb('kids-orb-cyan-lo')})`,
    boxShadow: `0 0 24px ${fill('discover', 0.8)}`,
  } satisfies ViewStyle,
  /** A pulsing piece's breathing glow, a layer under it (web kids-pulse; RN can't animate
   * box-shadow). */
  pulseGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    boxShadow: `0 0 46px ${fill('discover', 0.95)}`,
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
    padding: 20,
    backgroundColor: rgb('kids-world-shadow', 0.84),
  } satisfies ViewStyle,
  /** web .kids-dialog: a teal-to-navy panel. */
  dialog: {
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: fill('discover', 0.4),
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-world-card',
    )}, ${rgb('kids-world-deep')} 60%)`,
    boxShadow: `0 30px 80px ${rgb('kids-world-shadow', 0.6)}, 0 0 60px ${rgb(
      'kids-orb-sky',
      0.2,
    )}`,
  } satisfies ViewStyle,
};

/** The game dialog's pieces (web .kids-dialog-icon, -close, .kids-win-*). */
export const dialog = {
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: fill('discover'),
    backgroundColor: rgb('kids-orb-sky', 0.15),
  } satisfies ViewStyle,
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: fill('discover', 0.35),
  } satisfies ViewStyle,
  title: {
    ...font('orbitron', 700),
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 18 * 0.04,
    color: rgb('kids-world-name'),
  } satisfies TextStyle,
  play: {
    ...font('rajdhani', 700),
    fontSize: 17,
    lineHeight: 17 * 1.3,
    color: rgb('kids-heading'),
  } satisfies TextStyle,
  medal: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: fill('discover'),
    experimental_backgroundImage: `radial-gradient(circle at 50% 35%, ${rgb(
      'kids-orb-sky',
    )}, ${rgb('kids-orb-cyan-lo')})`,
    boxShadow: `0 0 18px ${fill('discover', 0.5)}`,
  } satisfies ViewStyle,
  /** The medallion's breathing glow, a layer under it (RN can't animate box-shadow). */
  medalGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    boxShadow: `0 0 46px ${fill('discover', 0.95)}`,
  } satisfies ViewStyle,
  ink: rgb('kids-world-name'),
  won: {
    ...font('orbitron', 700),
    fontSize: 24,
    lineHeight: 30,
    color: rgb('kids-world-name'),
  } satisfies TextStyle,
  time: {
    ...font('orbitron', 700),
    fontSize: 36,
    lineHeight: 40,
    color: rgb('kids-gold'),
    textShadowColor: rgb('kids-gold', 0.5),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  } satisfies TextStyle,
  sec: {
    ...font('rajdhani', 700),
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 16 * 0.18,
    textTransform: 'uppercase',
    color: rgb('kids-gold'),
  } satisfies TextStyle,
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover', 0.4),
  } satisfies ViewStyle,
  pillBest: {
    borderColor: rgb('kids-gold'),
    backgroundColor: rgb('kids-gold'),
  } satisfies ViewStyle,
  pillText: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 14 * 0.2,
    textTransform: 'uppercase',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
  pillBestText: { color: rgb('kids-world-deep') } satisfies TextStyle,
  line: {
    maxWidth: 400,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: fill('discover', 0.35),
    backgroundColor: rgb('kids-world-deep', 0.7),
  } satisfies ViewStyle,
  lineText: {
    ...font('rajdhani', 600),
    fontSize: 16,
    lineHeight: 16 * 1.375,
    textAlign: 'center',
    color: rgb('kids-heading'),
  } satisfies TextStyle,
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
    borderColor: rgb('kids-gold'),
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    experimental_backgroundImage: `linear-gradient(180deg, transparent, ${rgb(
      'kids-gold',
      0.35,
    )})`,
    boxShadow: `0 8px 26px ${rgb('kids-gold', 0.35)}`,
  } satisfies ViewStyle,
  cardText: {
    ...font('orbitron', 700),
    fontSize: 19,
    lineHeight: 26,
    textAlign: 'center',
    color: rgb('kids-world-name'),
  } satisfies TextStyle,
  sideText: {
    ...font('rajdhani', 700),
    fontSize: 15,
    letterSpacing: 15 * 0.12,
    textTransform: 'uppercase',
    color: rgb('kids-world-name'),
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
      'kids-orb-gold-hi',
    )}, ${rgb('kids-orb-gold')} 45%, ${rgb('kids-orb-gold-lo')})`,
    boxShadow: `0 0 50px ${rgb('kids-gold', 0.8)}`,
  } satisfies ViewStyle,
  /** A flashed word ("Perfect!", "Too soon!"); glow() adds its colour's glow. */
  word: {
    ...font('orbitron', 900),
    fontSize: 24,
  } satisfies TextStyle,
  /** A word picked in Dash: a gold chip. */
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: rgb('kids-gold', 0.6),
    backgroundColor: rgb('kids-gold', 0.15),
  } satisfies ViewStyle,
  chipText: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 20,
    color: rgb('kids-gold'),
  } satisfies TextStyle,
};

/** The world cards' three orbs, in turn (web .kids-world-orb-cyan, -gold, -sky). */
export const WORLD_ORBS = ['cyan', 'gold', 'sky'] as const;
export type WorldOrb = (typeof WORLD_ORBS)[number];

/** Grow's "Pick a world" (web .kids-pill-eyebrow, .kids-glow-word, .kids-world-*). */
export const worldPick = {
  eyebrow: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover', 0.5),
    backgroundColor: rgb('kids-orb-sky', 0.1),
  } satisfies ViewStyle,
  eyebrowText: {
    ...font('rajdhani', 700),
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 13 * 0.24,
    textTransform: 'uppercase',
    color: fill('discover'),
  } satisfies TextStyle,
  title: {
    ...font('orbitron', 700),
    fontSize: 28,
    lineHeight: 28 * 1.08,
    letterSpacing: 28 * 0.02,
    textAlign: 'center',
    color: rgb('kids-heading'),
  } satisfies TextStyle,
  glowWord: {
    color: fill('discover'),
    textShadowColor: fill('discover', 0.45),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 28,
  } satisfies TextStyle,
  lead: {
    ...font('rajdhani', 600),
    fontSize: 17,
    lineHeight: 17 * 1.375,
    maxWidth: 520,
    alignSelf: 'center',
    textAlign: 'center',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
  ring: {
    position: 'absolute',
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 9999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: fill('discover', 0.3),
  } satisfies ViewStyle,
  done: {
    position: 'absolute',
    right: -6,
    top: -4,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: rgb('kids-world-deep'),
    backgroundColor: rgb('kids-gold'),
  } satisfies ViewStyle,
  name: {
    ...font('orbitron', 700),
    fontSize: 16,
    lineHeight: 16 * 1.25,
    letterSpacing: 16 * 0.03,
    textAlign: 'center',
    color: rgb('kids-world-name'),
  } satisfies TextStyle,
  tag: {
    ...font('rajdhani', 700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.24,
    textTransform: 'uppercase',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
  tagDone: { color: rgb('kids-gold') } satisfies TextStyle,
  /** The icon on the orb and the check on the played marker. */
  ink: rgb('kids-world-deep'),
};

/** Grow's game screens and report (web .kids-round-back, -step-dot, -pill-gold, -game-intro,
 * -play-orb, -result-card, -check-orb, -report-orb, -btn-glow, -btn-line, -text-link). */
export const growView = {
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: fill('discover', 0.35),
  } satisfies ViewStyle,
  backIcon: rgb('kids-subtle'),
  pillGold: {
    borderColor: rgb('kids-gold', 0.55),
    backgroundColor: rgb('kids-gold', 0.08),
  } satisfies ViewStyle,
  pillGoldText: { color: rgb('kids-gold') } satisfies TextStyle,
  goldGlow: {
    color: rgb('kids-gold'),
    textShadowColor: rgb('kids-gold', 0.45),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 28,
  } satisfies TextStyle,
  title: {
    ...font('orbitron', 700),
    fontSize: 26,
    lineHeight: 26 * 1.1,
    textAlign: 'center',
    color: rgb('kids-heading'),
  } satisfies TextStyle,
  intro: {
    width: '100%',
    maxWidth: 540,
    aspectRatio: 1,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: fill('discover', 0.3),
    experimental_backgroundImage: `radial-gradient(circle at 50% 40%, ${rgb(
      'kids-world-card',
    )}, ${rgb('kids-world-deep')} 78%)`,
  } satisfies ViewStyle,
  skill: {
    ...font('rajdhani', 700),
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 13 * 0.28,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingHorizontal: 16,
    color: rgb('kids-gold'),
  } satisfies TextStyle,
  note: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 14 * 0.2,
    textTransform: 'uppercase',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
  /** The round Play's breathing glow, a layer under it (RN can't animate box-shadow). */
  playGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    boxShadow: `0 0 46px ${fill('discover', 0.95)}`,
  } satisfies ViewStyle,
  playText: {
    ...font('orbitron', 700),
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 18 * 0.08,
    color: rgb('kids-world-name'),
  } satisfies TextStyle,
  playInk: rgb('kids-world-name'),
  result: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    alignItems: 'center',
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: rgb('kids-gold', 0.5),
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-world-card',
      0.7,
    )}, ${rgb('kids-world-deep', 0.92)})`,
    boxShadow: `0 0 50px ${rgb('kids-gold', 0.12)}`,
  } satisfies ViewStyle,
  checkOrb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: `radial-gradient(circle at 40% 35%, ${rgb(
      'kids-orb-gold-hi',
    )}, ${rgb('kids-orb-gold')} 45%, ${rgb('kids-orb-gold-lo')})`,
    boxShadow: `0 0 40px ${rgb('kids-gold', 0.55)}`,
  } satisfies ViewStyle,
  score: {
    ...font('orbitron', 900),
    fontSize: 36,
    lineHeight: 40,
    color: rgb('kids-gold'),
  } satisfies TextStyle,
  reportOrb: {
    borderWidth: 4,
    borderColor: rgb('kids-world-deep'),
    boxShadow: `0 0 50px ${fill('discover', 0.45)}`,
  } satisfies ViewStyle,
  btnText: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 14 * 0.18,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  btnGlowText: { color: rgb('kids-world-name') } satisfies TextStyle,
  btnLineText: { color: fill('discover') } satisfies TextStyle,
  link: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 14 * 0.2,
    textTransform: 'uppercase',
    color: rgb('kids-subtle'),
  } satisfies TextStyle,
};

/** `.kids-report-card`: a card on Grow's report (the prototype's report rows, dark navy with a
 * thin gold edge). */
export const reportCard: ViewStyle = {
  borderRadius: 22,
  paddingHorizontal: 20,
  paddingVertical: 16,
  borderWidth: 1,
  borderColor: rgb('kids-gold', 0.35),
  backgroundColor: rgb('kids-world-deep', 0.7),
};

/** A game's dot: done gold, the current one cyan (both glowing), the rest faint. */
export function stepDot(state: 'done' | 'now' | 'next'): ViewStyle {
  const lit =
    state === 'done'
      ? rgb('kids-gold')
      : state === 'now'
      ? fill('discover')
      : null;
  return {
    width: 36,
    height: 8,
    borderRadius: 999,
    backgroundColor: lit ?? fill('discover', 0.14),
    boxShadow: lit
      ? `0 0 12px ${
          state === 'done' ? rgb('kids-gold', 0.6) : fill('discover', 0.6)
        }`
      : undefined,
  };
}

/** The round Play (pressed: a little smaller). */
export function playOrb(pressed = false): ViewStyle {
  return {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: fill('discover'),
    experimental_backgroundImage: `radial-gradient(circle at 40% 35%, ${rgb(
      'kids-orb-sky',
    )}, ${rgb('kids-orb-cyan-lo')})`,
    boxShadow: `0 0 18px ${fill('discover', 0.5)}`,
    transform: [{ scale: pressed ? 0.95 : 1 }],
  };
}

/** `.kids-btn-glow`: Grow's lit button, a cyan gradient with a glow. */
export function buttonGlow(pressed = false): ViewStyle {
  return {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover'),
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-orb-sky',
    )}, ${rgb('kids-orb-cyan-lo')})`,
    boxShadow: `0 0 26px ${fill('discover', 0.35)}`,
    transform: [{ scale: pressed ? 0.96 : 1 }],
  };
}

/** `.kids-btn-line`: outlined cyan. */
export function buttonLine(pressed = false): ViewStyle {
  return {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: fill('discover', 0.4),
    backgroundColor: pressed ? rgb('kids-orb-sky', 0.12) : undefined,
    transform: [{ scale: pressed ? 0.96 : 1 }],
  };
}

/** `.kids-world`: a world's card (pressed: a little smaller). */
export function worldCard(pressed = false): ViewStyle {
  return {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 24,
    paddingBottom: 20,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: fill('discover', 0.28),
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-world-card',
      0.55,
    )}, ${rgb('kids-world-deep', 0.85)})`,
    boxShadow: `0 14px 34px ${rgb('kids-world-shadow', 0.45)}`,
    transform: [{ scale: pressed ? 0.96 : 1 }],
  };
}

/** `.kids-world-orb` in one of the three gradients. */
export function worldOrb(orb: WorldOrb): ViewStyle {
  const glow = orb === 'gold' ? 0.45 : 0.5;
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: `radial-gradient(circle at 35% 30%, ${rgb(
      `kids-orb-${orb}-hi`,
    )}, ${rgb(`kids-orb-${orb}`)} 40%, ${rgb(`kids-orb-${orb}-lo`)})`,
    boxShadow: `0 0 30px ${rgb(
      `kids-orb-${orb}`,
      glow,
    )}, inset -10px -12px 24px ${rgb(
      'kids-world-shadow',
      0.35,
    )}, inset 8px 8px 18px ${rgb('kids-world-name', 0.25)}`,
  };
}

/** The sort card (web .kids-game-card, -right, -wrong): gold when right, red and glowing
 * when wrong. */
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
        ? rgb('kids-gold')
        : state === 'wrong'
        ? rgb('kids-wrong')
        : fill('discover', 0.5),
    experimental_backgroundImage: `linear-gradient(180deg, ${rgb(
      'kids-world-card',
      0.95,
    )}, ${rgb('kids-world-deep', 0.98)})`,
    boxShadow:
      state === 'wrong'
        ? `0 0 34px ${rgb('kids-wrong', 0.4)}`
        : `0 0 34px ${fill('discover', 0.25)}`,
  };
}

/** A sort side's button (web .kids-game-side, -cyan): the left gold, the right cyan. */
export function sortSide(side: 'left' | 'right', pressed = false): ViewStyle {
  const left = side === 'left';
  return {
    flex: 1,
    minHeight: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: left ? rgb('kids-gold', 0.7) : fill('discover'),
    experimental_backgroundImage: left
      ? `linear-gradient(180deg, ${rgb('kids-gold', 0.25)}, ${rgb(
          'kids-gold-shade',
          0.45,
        )})`
      : `linear-gradient(180deg, ${rgb('kids-orb-sky', 0.45)}, ${rgb(
          'kids-orb-cyan-lo',
          0.7,
        )})`,
    transform: [{ scale: pressed ? 0.97 : 1 }],
  };
}

/** A memory pad in `c`, lit or not (web .kids-game-pad, -lit). */
export function memoryPad(c: KidsPair, lit: boolean): ViewStyle {
  return {
    width: '42%',
    aspectRatio: 1,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: lit ? rgb('kids-white') : fill(c, 0.6),
    experimental_backgroundImage: lit
      ? `radial-gradient(circle at 40% 35%, ${rgb('kids-white')}, ${fill(
          c,
        )} 55%)`
      : `radial-gradient(circle at 40% 35%, ${fill(c, 0.35)}, ${rgb(
          'kids-world-deep',
          0.9,
        )} 75%)`,
    boxShadow: lit ? `0 0 50px ${fill(c)}` : `0 0 14px ${fill(c, 0.2)}`,
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
    borderColor: near ? rgb('kids-white') : rgb('kids-gold'),
    backgroundColor: rgb('kids-gold', 0.15),
    boxShadow: near
      ? `0 0 40px ${rgb('kids-gold', 0.8)}`
      : `0 0 20px ${rgb('kids-gold', 0.3)}`,
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: found ? rgb('kids-gold') : fill('discover', 0.4),
    experimental_backgroundImage: found
      ? `radial-gradient(circle, ${rgb('kids-gold', 0.25)}, ${rgb(
          'kids-world-deep',
          0.9,
        )})`
      : open
      ? undefined
      : `linear-gradient(160deg, ${rgb('kids-orb-sky', 0.35)}, ${rgb(
          'kids-orb-cyan-lo',
          0.5,
        )})`,
    backgroundColor: open && !found ? rgb('kids-world-deep', 0.7) : undefined,
    boxShadow: found ? `0 0 26px ${rgb('kids-gold', 0.45)}` : undefined,
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
        ? rgb('kids-gold')
        : state === 'next'
        ? fill('discover')
        : state === 'wrong'
        ? fill('connect')
        : fill('discover', 0.35),
    experimental_backgroundImage:
      state === 'done'
        ? `radial-gradient(circle, ${rgb('kids-gold')}, ${shade('transform')})`
        : undefined,
    backgroundColor:
      state === 'done' ? undefined : rgb('kids-world-deep', 0.85),
  };
}

/** Voice's mic (web .kids-game-mic, -full): a dark-cyan circle, gold-edged once the voice is
 * nearly full, its glow growing with the voice (20 → 70 px). */
export function voiceMic(level: number): ViewStyle {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: level > 0.9 ? rgb('kids-gold') : fill('discover'),
    experimental_backgroundImage: `radial-gradient(circle at 50% 35%, ${rgb(
      'kids-orb-sky',
    )}, ${rgb('kids-orb-cyan-lo')})`,
    boxShadow: `0 0 ${20 + level * 50}px ${fill('discover', 0.8)}`,
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
    | 'off'
    | 'gold'
    | 'wrong'
    | 'white'
    | 'world-name'
    | 'world-deep',
) => rgb(`kids-${c}`);

/** Text styles (web Orbitron/Rajdhani; sizes are set where used, on the parent pages' scale). */
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
