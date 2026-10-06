/**
 * Reanimated 4 CSS-animation ports of the web's `pp*` keyframes
 * (frontend/src/index.css) and the page's framer-motion entrances, with the
 * same durations, delays, easings and fill modes.
 *
 * `ppRiseIn` animates `filter: blur(8px → 0)` on the web. RN's `filter: blur()`
 * is Android-only and not interpolated by Reanimated's CSS animations, so the
 * blur is dropped — the rise + fade carry the effect.
 */
import {
  Easing,
  Keyframe,
  cubicBezier,
  type CSSAnimationKeyframes,
} from 'react-native-reanimated';

/** Width of the badge sweep band — translateX(-120%/220%) resolved against it. */
export const SWEEP_W = 70;

export const ppRingOut: CSSAnimationKeyframes = {
  '0%': { transform: [{ scale: 0.15 }], opacity: 0 },
  '15%': { opacity: 0.9 },
  '100%': { transform: [{ scale: 2.6 }], opacity: 0 },
};

export const ppSparkFall: CSSAnimationKeyframes = {
  '0%': { transform: [{ translateY: -40 }, { rotate: '45deg' }], opacity: 0 },
  '12%': { opacity: 1 },
  '100%': {
    transform: [{ translateY: 760 }, { rotate: '225deg' }],
    opacity: 0,
  },
};

export const ppRiseIn: CSSAnimationKeyframes = {
  '0%': { transform: [{ translateY: 26 }], opacity: 0 },
  '100%': { transform: [{ translateY: 0 }], opacity: 1 },
};

export const ppBadgeSweep: CSSAnimationKeyframes = {
  '0%': {
    transform: [{ translateX: -1.2 * SWEEP_W }, { skewX: '-18deg' }],
    opacity: 0,
  },
  '40%': { opacity: 0.8 },
  '100%': {
    transform: [{ translateX: 2.2 * SWEEP_W }, { skewX: '-18deg' }],
    opacity: 0,
  },
};

export const ppPageIn: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 20 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};

export const ppBadgePop: CSSAnimationKeyframes = {
  '0%': { transform: [{ scale: 0.6 }], opacity: 0 },
  '60%': { transform: [{ scale: 1.06 }], opacity: 1 },
  '100%': { transform: [{ scale: 1 }], opacity: 1 },
};

/** web `animation: ppRiseIn <dur>s ease-out <delay>s both`. */
export function riseIn(duration: number, delay = 0) {
  return {
    animationName: ppRiseIn,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  } as const;
}

/** web `animation: ppBadgePop .8s cubic-bezier(.2,.9,.2,1) .7s both`. */
export const BADGE_POP = {
  animationName: ppBadgePop,
  animationDuration: '0.8s',
  animationDelay: '0.7s',
  animationTimingFunction: cubicBezier(0.2, 0.9, 0.2, 1),
  animationFillMode: 'both',
} as const;

/** web `animation: ppBadgeSweep 2.4s ease-in-out 1.4s infinite`. */
export const BADGE_SWEEP = {
  animationName: ppBadgeSweep,
  animationDuration: '2.4s',
  animationDelay: '1.4s',
  animationTimingFunction: 'ease-in-out',
  animationIterationCount: 'infinite',
} as const;

/** web `animation: ppPageIn .7s ease-out both`. */
export const PAGE_IN = {
  animationName: ppPageIn,
  animationDuration: '0.7s',
  animationTimingFunction: 'ease-out',
  animationFillMode: 'both',
} as const;

/** web `animation: ppRingOut 2.6s ease-out <delay>s infinite`. */
export function ringOut(delay: number) {
  return {
    animationName: ppRingOut,
    animationDuration: '2.6s',
    animationDelay: `${delay}s`,
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
  } as const;
}

/** web `animation: ppSparkFall <dur> linear <delay> infinite`. */
export function sparkFall(duration: `${number}s`, delay: `${number}s`) {
  return {
    animationName: ppSparkFall,
    animationDuration: duration,
    animationDelay: delay,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  } as const;
}

/** Continuous 1s linear rotation (the loading spinner). */
export const SPIN_1S = {
  animationName: {
    from: { transform: [{ rotate: '0deg' }] },
    to: { transform: [{ rotate: '360deg' }] },
  },
  animationDuration: '1s',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'linear',
} as const;

// ─── framer-motion entrances ────────────────────────────────────────────────
// Framer's default transition for opacity is a 0.3s tween and for y/scale a
// spring; a 0.45s ease-out keyframe approximates the combined settle.
const easeOut = Easing.out(Easing.ease);
const ENTER_MS = 450;

/** `initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}`. */
export function enterUp(delay: number, y = 12) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: y }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
  })
    .duration(ENTER_MS)
    .delay(delay * 1000);
}

/** `initial={{ opacity: 0, scale }} animate={{ opacity: 1, scale: 1 }} transition={{ delay }}`. */
export function enterScale(delay: number, scale: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ scale }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: easeOut },
  })
    .duration(ENTER_MS)
    .delay(delay * 1000);
}

/** `initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay }}`. */
export function enterFade(delay: number) {
  return new Keyframe({ 0: { opacity: 0 }, 100: { opacity: 1 } })
    .duration(300)
    .delay(delay * 1000);
}

/** Score bar: width 0 → score% over .75s easeOut after `delay`s. */
export function barGrow(score: number, delay: number) {
  return {
    animationName: { from: { width: '0%' }, to: { width: `${score}%` } },
    animationDuration: '0.75s',
    animationDelay: `${delay}s`,
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  } as const;
}
