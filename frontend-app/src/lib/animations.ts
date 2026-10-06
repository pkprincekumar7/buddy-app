/**
 * Shared animation presets — the Reanimated counterparts of the web's
 * Framer Motion presets (frontend/src/lib/animations.ts), with the same
 * durations, offsets and easings. Spread onto an `Animated.View`:
 *
 *   <Animated.View {...slideUp(0.2)} />      // web: <motion.div {...slideUp(0.2)} />
 *   <Animated.View {...MODAL_SCALE} />        // entering + exiting
 *
 * Framer's `initial → animate` maps to Reanimated `entering`; `exit` maps to
 * `exiting` (Reanimated plays it when the view unmounts — no AnimatePresence
 * needed). For looping/continuous animations use Reanimated 4's CSS
 * animations (`animationName` / `animationDuration` / `animationIterationCount`),
 * e.g. the SPINNER style below.
 */
import { Easing, Keyframe } from 'react-native-reanimated';

const easeOut = Easing.out(Easing.ease);

/** Continuous 2s linear rotation — style for an Animated.View. */
export const SPINNER = {
  animationName: {
    from: { transform: [{ rotate: '0deg' }] },
    to: { transform: [{ rotate: '360deg' }] },
  },
  animationDuration: '2s',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'linear',
} as const;

export const FADE_IN = {
  entering: new Keyframe({
    0: { opacity: 0 },
    100: { opacity: 1, easing: easeOut },
  }).duration(600),
};

/** Horizontal slide used for wizard phase transitions. */
export const PAGE_SLIDE = {
  entering: new Keyframe({
    0: { opacity: 0, transform: [{ translateX: 50 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }] },
  }).duration(450),
  exiting: new Keyframe({
    0: { opacity: 1, transform: [{ translateX: 0 }] },
    100: { opacity: 0, transform: [{ translateX: -50 }] },
  }).duration(450),
};

export const MODAL_BACKDROP = {
  entering: new Keyframe({ 0: { opacity: 0 }, 100: { opacity: 1 } }).duration(
    300,
  ),
  exiting: new Keyframe({ 0: { opacity: 1 }, 100: { opacity: 0 } }).duration(
    300,
  ),
};

export const MODAL_SCALE = {
  entering: new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.95 }, { translateY: 16 }] },
    100: {
      opacity: 1,
      transform: [{ scale: 1 }, { translateY: 0 }],
      easing: easeOut,
    },
  }).duration(375),
  exiting: new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] },
    100: {
      opacity: 0,
      transform: [{ scale: 0.95 }, { translateY: 16 }],
      easing: easeOut,
    },
  }).duration(375),
};

/** Vertical slide-up entrance with an optional delay (seconds, like the web). */
export function slideUp(delay = 0, duration = 1.0) {
  return {
    entering: new Keyframe({
      0: { opacity: 0, transform: [{ translateY: 24 }] },
      100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
    })
      .duration(duration * 1000)
      .delay(delay * 1000),
  };
}
