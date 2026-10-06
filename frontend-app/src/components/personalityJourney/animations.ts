/**
 * Reanimated CSS-animation ports of the web PersonalityJourney page's
 * `@keyframes` blocks. Each export is a style fragment for an Animated.View,
 * named after the web keyframe it mirrors (same durations, delays, easings).
 */
import {
  cubicBezier,
  type CSSAnimationKeyframes,
  type CSSAnimationProperties,
  type CSSAnimationTimingFunction,
} from 'react-native-reanimated';

// ─── Rotations (buddySpin / buddySpinRev) ───────────────────────────────────

const SPIN_CW: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '360deg' }] },
};
const SPIN_CCW: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '-360deg' }] },
};

/** `buddySpin {s}s linear infinite` / `buddySpinRev {s}s linear infinite`. */
export function spin(seconds: number, reverse = false): CSSAnimationProperties {
  return {
    animationName: reverse ? SPIN_CCW : SPIN_CW,
    animationDuration: `${seconds}s`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  };
}

function loop(
  name: CSSAnimationKeyframes,
  seconds: number,
  delay = 0,
  easing: CSSAnimationTimingFunction = 'ease-in-out',
) {
  return {
    animationName: name,
    animationDuration: `${seconds}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: easing,
    animationIterationCount: 'infinite',
  } satisfies CSSAnimationProperties;
}

// ─── Phase 1 orb (BuddyOrbScreen's own <style> block) ───────────────────────

/** `buddyGoldBreathe 3.2s ease-in-out infinite` — scale 1 → 1.04 (phase 1). */
export const ORB_BREATHE = loop(
  {
    '0%': { transform: [{ scale: 1 }] },
    '50%': { transform: [{ scale: 1.04 }] },
    '100%': { transform: [{ scale: 1 }] },
  },
  3.2,
);
/** `buddyGoldPulse 3.6s ease-in-out infinite` — scale 1 → 1.10 (phase 1). */
export const ORB_HALO_PULSE = loop(
  {
    '0%': { transform: [{ scale: 1 }] },
    '50%': { transform: [{ scale: 1.1 }] },
    '100%': { transform: [{ scale: 1 }] },
  },
  3.6,
);

/** Orb button entrance — framer `{opacity:0, scale:.7} → 1`, 0.8s ease [0.22,1,0.36,1]. */
export const ORB_ENTER: CSSAnimationProperties = {
  animationName: {
    from: { opacity: 0, transform: [{ scale: 0.7 }] },
    to: { opacity: 1, transform: [{ scale: 1 }] },
  },
  animationDuration: '0.8s',
  animationTimingFunction: cubicBezier(0.22, 1, 0.36, 1),
  animationFillMode: 'both',
};

/** Heading entrance — framer `{opacity:0, y:-16} → {opacity:1, y:0}`, 0.7s easeOut. */
export const HEADING_ENTER: CSSAnimationProperties = {
  animationName: {
    from: { opacity: 0, transform: [{ translateY: -16 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  animationDuration: '0.7s',
  animationTimingFunction: 'ease-out',
  animationFillMode: 'both',
};

/** framer `{opacity:0} → {opacity:1}` with a duration/delay (seconds). */
export function fadeIn(
  duration: number,
  delay = 0,
  easing: 'ease' | 'ease-out' = 'ease-out',
): CSSAnimationProperties {
  return {
    animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: easing,
    animationFillMode: 'both',
  };
}

/** Analyzing dots — framer `y: [0, -7, 0]`, 0.7s easeInOut, repeat ∞, staggered delay. */
export function dotBounce(delay: number): CSSAnimationProperties {
  return loop(
    {
      '0%': { transform: [{ translateY: 0 }] },
      '50%': { transform: [{ translateY: -7 }] },
      '100%': { transform: [{ translateY: 0 }] },
    },
    0.7,
    delay,
  );
}

/** `scopeDolly 3.4s cubic-bezier(.35,0,.3,1) forwards` (blur/saturate have no RN equivalent). */
export const SCOPE_DOLLY: CSSAnimationProperties = {
  animationName: {
    '0%': { transform: [{ scale: 1 }], opacity: 1 },
    '60%': { transform: [{ scale: 1.28 }], opacity: 1 },
    '100%': { transform: [{ scale: 1.55 }], opacity: 0 },
  },
  animationDuration: '3.4s',
  animationTimingFunction: cubicBezier(0.35, 0, 0.3, 1),
  animationFillMode: 'forwards',
};

// ─── Warp-enter overlays ─────────────────────────────────────────────────────

/** `voidVeil 5.6s ease forwards`. */
export const VOID_VEIL: CSSAnimationProperties = {
  animationName: {
    '0%': { opacity: 0 },
    '30%': { opacity: 1 },
    '72%': { opacity: 0.9 },
    '100%': { opacity: 0 },
  },
  animationDuration: '5.6s',
  animationTimingFunction: 'ease',
  animationFillMode: 'forwards',
};

/** `nebulaDrift 5.6s cubic-bezier(.4,0,.35,1) forwards` (the translate(-50%,-50%) is done by layout). */
export const NEBULA_DRIFT: CSSAnimationProperties = {
  animationName: {
    '0%': { opacity: 0, transform: [{ scale: 0.6 }, { rotate: '0deg' }] },
    '22%': { opacity: 0.85 },
    '70%': { opacity: 0.7 },
    '100%': { opacity: 0, transform: [{ scale: 2.6 }, { rotate: '26deg' }] },
  },
  animationDuration: '5.6s',
  animationTimingFunction: cubicBezier(0.4, 0, 0.35, 1),
  animationFillMode: 'forwards',
};

// ─── Phase 2 constellation (DimensionCirclesScreen's <style> block) ─────────

const EASE_OUT_EXPO = cubicBezier(0.16, 1, 0.3, 1);

/** Phase-2 wrapper — framer `{opacity:0, scale:1.06} → {opacity:1, scale:1}`, 0.5s. */
export const PHASE2_ENTER: CSSAnimationProperties = {
  animationName: {
    from: { opacity: 0, transform: [{ scale: 1.06 }] },
    to: { opacity: 1, transform: [{ scale: 1 }] },
  },
  animationDuration: '0.5s',
  animationTimingFunction: 'ease-out',
  animationFillMode: 'both',
};

/** `scopeFocus 2.4s cubic-bezier(.22,.9,.25,1) both` (the 9px blur has no RN equivalent). */
export const SCOPE_FOCUS: CSSAnimationProperties = {
  animationName: {
    '0%': { opacity: 0, transform: [{ scale: 1.14 }] },
    '45%': { opacity: 1 },
    '100%': { opacity: 1, transform: [{ scale: 1 }] },
  },
  animationDuration: '2.4s',
  animationTimingFunction: cubicBezier(0.22, 0.9, 0.25, 1),
  animationFillMode: 'both',
};

/** `hubIn .95s cubic-bezier(.16,1,.3,1) both`. */
export const HUB_IN: CSSAnimationProperties = {
  animationName: {
    '0%': { opacity: 0, transform: [{ scale: 0.1 }, { rotate: '-90deg' }] },
    '100%': { opacity: 1, transform: [{ scale: 1 }, { rotate: '0deg' }] },
  },
  animationDuration: '0.95s',
  animationTimingFunction: EASE_OUT_EXPO,
  animationFillMode: 'both',
};

/** `nodeIn .75s cubic-bezier(.16,1,.3,1) {delay}s both`. */
const NODE_IN_CACHE = new Map<number, CSSAnimationProperties>();
export function nodeIn(delay: number): CSSAnimationProperties {
  const hit = NODE_IN_CACHE.get(delay);
  if (hit) return hit;
  const anim: CSSAnimationProperties = {
    animationName: {
      '0%': { opacity: 0, transform: [{ scale: 0.2 }] },
      '100%': { opacity: 1, transform: [{ scale: 1 }] },
    },
    animationDuration: '0.75s',
    animationDelay: `${delay}s`,
    animationTimingFunction: EASE_OUT_EXPO,
    animationFillMode: 'both',
  };
  NODE_IN_CACHE.set(delay, anim);
  return anim;
}

const NODE_PULSE: CSSAnimationKeyframes = {
  '0%': { transform: [{ scale: 0.85 }], opacity: 0.7 },
  '100%': { transform: [{ scale: 1.35 }], opacity: 0 },
};
/** `nodePulse {s}s ease-out {delay}s infinite` (no fill mode, like the web). */
export function nodePulse(seconds: number, delay = 0): CSSAnimationProperties {
  return loop(NODE_PULSE, seconds, delay, 'ease-out');
}

/** Cross-fade 1 → 0 → 1 (for the "rest" layer of a two-layer glow animation). */
export function fadeOutIn(seconds: number): CSSAnimationProperties {
  return loop(
    { '0%': { opacity: 1 }, '50%': { opacity: 0 }, '100%': { opacity: 1 } },
    seconds,
  );
}
/** Cross-fade 0 → 1 → 0 (for the "peak" layer of a two-layer glow animation). */
export function fadeInOut(seconds: number): CSSAnimationProperties {
  return loop(
    { '0%': { opacity: 0 }, '50%': { opacity: 1 }, '100%': { opacity: 0 } },
    seconds,
  );
}

/** Phase-2 `buddyGoldPulse 3.6s ease-in-out infinite` — opacity .55 → 1. */
export const HUB_HALO_PULSE = loop(
  { '0%': { opacity: 0.55 }, '50%': { opacity: 1 }, '100%': { opacity: 0.55 } },
  3.6,
);

/** `tagBob 1.7s ease-in-out infinite` — the -118% lift is applied by the caller (it depends on the pill height). */
export function tagBob(liftPx: number): CSSAnimationProperties {
  return loop(
    {
      '0%': { transform: [{ translateY: -liftPx }] },
      '50%': { transform: [{ translateY: -liftPx - 4 }] },
      '100%': { transform: [{ translateY: -liftPx }] },
    },
    1.7,
  );
}
