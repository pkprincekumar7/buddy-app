/**
 * Shared style fragments and keyframes for the Life Pathway page — the RN
 * counterparts of the web page's inline `<style>` block and its `eyebrow` /
 * `orbitron()` helpers (frontend/src/pages/LifePathway.tsx).
 *
 * The web scales type by `--lp-type-scale`, which is 1 on phones, so every size
 * here is the web's design-time px value unchanged. Prose max-widths are wider
 * than a phone and are dropped.
 */
import type { TextStyle } from 'react-native';
import type {
  CSSAnimationKeyframes,
  CSSAnimationProperties,
} from 'react-native-reanimated';
import { css, font } from '@/theme';

export const GOLD = css('rgb(var(--constellation-gold-rgb))');
export const CYAN = css('rgb(var(--constellation-cyan-rgb))');

/** Phone-width equivalents of the web's `useIsMobile()` / `(max-width: 535px)` gates. */
export const IS_MOBILE = true;
export const IS_NARROW = true;

/** CSS `letter-spacing: Xem` → RN px at a given font size. */
export const em = (fontSize: number, ems: number) => fontSize * ems;

/** Rajdhani text at a web weight (the page root is `font-rajdhani`). */
export function rajdhani(
  size: number,
  weight: 600 | 700,
  lineHeight?: number,
): TextStyle {
  return {
    ...font('rajdhani', weight),
    fontSize: size,
    ...(lineHeight === undefined ? {} : { lineHeight: size * lineHeight }),
  };
}

/** Web `orbitron(size, weight)` helper — Orbitron at 900 (default) or 700. */
export function orbitron(size: number, weight: 700 | 900 = 900): TextStyle {
  return { ...font('orbitron', weight), fontSize: size };
}

/** Web `eyebrow`: 700 · .28em · 10.5px · uppercase · gold. */
export const EYEBROW: TextStyle = {
  ...rajdhani(10.5, 700),
  letterSpacing: em(10.5, 0.28),
  textTransform: 'uppercase',
  color: GOLD,
};

// ─── Keyframes (web <style> block) ───────────────────────────────────────────

const LP_FADE_UP: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 18 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const LP_FADE_IN: CSSAnimationKeyframes = {
  from: { opacity: 0 },
  to: { opacity: 1 },
};
const LP_POP_NODE: CSSAnimationKeyframes = {
  '0%': { opacity: 0, transform: [{ scale: 0.3 }] },
  '60%': { transform: [{ scale: 1.25 }] },
  '100%': { opacity: 1, transform: [{ scale: 1 }] },
};
const LP_SWAP: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 10 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const LP_SPIN: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '360deg' }] },
};
const LP_SHIMMER: CSSAnimationKeyframes = {
  '0%': { opacity: 0.45 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.45 },
};
/**
 * lpGlowText: text-shadow 26px → 44px blur at gold .35 → .7. RN's
 * textShadowRadius is a blur radius (≈ half a CSS blur length).
 */
const LP_GLOW_TEXT: CSSAnimationKeyframes = {
  '0%': {
    textShadowRadius: 13,
    textShadowColor: css('rgb(var(--constellation-gold-rgb) / .35)'),
  },
  '50%': {
    textShadowRadius: 22,
    textShadowColor: css('rgb(var(--constellation-gold-rgb) / .7)'),
  },
  '100%': {
    textShadowRadius: 13,
    textShadowColor: css('rgb(var(--constellation-gold-rgb) / .35)'),
  },
};

/** Entrance animations the web disables under `prefers-reduced-motion`. */
function once(
  name: CSSAnimationKeyframes,
  duration: number,
  delay: number,
  reduced: boolean,
): CSSAnimationProperties | null {
  if (reduced) return null;
  return {
    animationName: name,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: 'ease',
    animationFillMode: 'both',
  };
}

/** `lpFadeUp .7s ease {delay}s both`. */
export const fadeUp = (delay: number, reduced: boolean) =>
  once(LP_FADE_UP, 0.7, delay, reduced);
/** `lpFadeIn {duration}s ease {delay}s both`. */
export const fadeIn = (duration: number, delay: number, reduced: boolean) =>
  once(LP_FADE_IN, duration, delay, reduced);
/** `lpPopNode .5s ease {delay}s both`. */
export const popNode = (delay: number, reduced: boolean) =>
  once(LP_POP_NODE, 0.5, delay, reduced);
/** `lpSwap .4s ease both`. */
export const swap = (reduced: boolean) => once(LP_SWAP, 0.4, 0, reduced);

/** `lpSpin .8s linear infinite`. */
export const SPIN: CSSAnimationProperties = {
  animationName: LP_SPIN,
  animationDuration: '0.8s',
  animationTimingFunction: 'linear',
  animationIterationCount: 'infinite',
};

/** `lpShimmer 1.5s ease-in-out {delay}s infinite`. */
export const shimmer = (delay: number): CSSAnimationProperties => ({
  animationName: LP_SHIMMER,
  animationDuration: '1.5s',
  animationDelay: `${delay}s`,
  animationTimingFunction: 'ease-in-out',
  animationIterationCount: 'infinite',
});

/** `lpGlowText 4s ease-in-out infinite`. */
export const GLOW_TEXT: CSSAnimationProperties = {
  animationName: LP_GLOW_TEXT,
  animationDuration: '4s',
  animationTimingFunction: 'ease-in-out',
  animationIterationCount: 'infinite',
};
