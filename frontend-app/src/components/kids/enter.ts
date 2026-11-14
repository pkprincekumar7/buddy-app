/**
 * The kids page's entrances (web index.css kids-up / kids-pop / kids-fade, the prototype's kUp
 * and kPop): sections rise in, the photo, powers and pills pop. Transform and opacity only, and
 * none when the device asks for reduced motion.
 */
import type {
  CSSAnimationKeyframes,
  CSSAnimationProperties,
  CSSAnimationTimingFunction,
} from 'react-native-reanimated';

const UP: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 22 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const POP: CSSAnimationKeyframes = {
  '0%': { opacity: 0, transform: [{ scale: 0.6 }] },
  '60%': { opacity: 1, transform: [{ scale: 1.08 }] },
  '100%': { opacity: 1, transform: [{ scale: 1 }] },
};
/** A power unfolding from small (the prototype's kUnfold, without the move from the centre). */
const UNFOLD: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ scale: 0.15 }] },
  to: { opacity: 1, transform: [{ scale: 1 }] },
};
const FADE: CSSAnimationKeyframes = {
  from: { opacity: 0 },
  to: { opacity: 1 },
};
/** A Grow world card rising and growing into place (web kids-unfold-y, the prototype's kUnfoldY). */
const UNFOLD_Y: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 30 }, { scale: 0.85 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};
const KINDS = {
  up: UP,
  pop: POP,
  unfold: UNFOLD,
  unfoldY: UNFOLD_Y,
  fade: FADE,
} as const;
const DURATION = {
  up: 0.5,
  pop: 0.7,
  unfold: 0.8,
  unfoldY: 0.6,
  fade: 0.5,
} as const;

/** `seconds` overrides the kind's usual length (Grow's views: a .4 s rise, a .45 s pop). */
export function enter(
  kind: keyof typeof KINDS,
  delay: number,
  reduced: boolean,
  seconds: number = DURATION[kind],
): CSSAnimationProperties | null {
  if (reduced) return null;
  return {
    animationName: KINDS[kind],
    animationDuration: `${seconds}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: 'ease',
    animationFillMode: 'both',
  };
}

// The web's looping animations (index.css kids-float, Tailwind's spin), only where motion is
// welcome.
export const FLOAT: CSSAnimationKeyframes = {
  '0%': { transform: [{ translateY: 0 }] },
  '50%': { transform: [{ translateY: -8 }] },
  '100%': { transform: [{ translateY: 0 }] },
};
export const SPIN: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '360deg' }] },
};

export function loop(
  name: CSSAnimationKeyframes,
  seconds: number,
  delay: number,
  timing: CSSAnimationTimingFunction,
  reduced: boolean,
): CSSAnimationProperties | null {
  if (reduced) return null;
  return {
    animationName: name,
    animationDuration: `${seconds}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: timing,
    animationIterationCount: 'infinite',
  };
}
