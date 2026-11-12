/**
 * The kids page's entrances (web index.css kids-up / kids-pop / kids-fade, the prototype's kUp
 * and kPop): sections rise in, the photo, powers and pills pop. Transform and opacity only, and
 * none when the device asks for reduced motion.
 */
import type {
  CSSAnimationKeyframes,
  CSSAnimationProperties,
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
const KINDS = { up: UP, pop: POP, unfold: UNFOLD, fade: FADE } as const;
const DURATION = { up: 0.5, pop: 0.7, unfold: 0.8, fade: 0.5 } as const;

export function enter(
  kind: keyof typeof KINDS,
  delay: number,
  reduced: boolean,
): CSSAnimationProperties | null {
  if (reduced) return null;
  return {
    animationName: KINDS[kind],
    animationDuration: `${DURATION[kind]}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: 'ease',
    animationFillMode: 'both',
  };
}
