/**
 * Shared style constants for the Observations ("Release") screen — the RN
 * counterparts of the web page's SECTION_LABEL / CARD_SHELL objects and its
 * `obsFadeUp` / `obsSwap` / `obsShimmer` keyframes.
 *
 * Type scale: the web multiplies every size by `--obs-type-scale`, which is 1
 * below the 768px breakpoint, so phone sizes are the design pixels as written.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { Easing, Keyframe } from 'react-native-reanimated';
import { css, font, rgb } from '@/theme';

/** CSS `ease`. */
const cssEase = Easing.bezier(0.25, 0.1, 0.25, 1);

/** web `animation: obsFadeUp .7s ease <delay>s both`. */
export function fadeUp(delaySeconds = 0) {
  return {
    entering: new Keyframe({
      0: { opacity: 0, transform: [{ translateY: 16 }] },
      100: { opacity: 1, transform: [{ translateY: 0 }], easing: cssEase },
    })
      .duration(700)
      .delay(delaySeconds * 1000),
  };
}

/** web framer `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}` (.35s / .3s easeOut). */
export function swapIn(durationMs: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 8 }] },
    100: {
      opacity: 1,
      transform: [{ translateY: 0 }],
      easing: Easing.out(Easing.ease),
    },
  }).duration(durationMs);
}

/** web `obsShimmer 1.4s ease-in-out <delay>s infinite`. */
export function shimmer(delaySeconds = 0): ViewStyle {
  return {
    animationName: {
      '0%': { opacity: 0.45 },
      '50%': { opacity: 1 },
      '100%': { opacity: 0.45 },
    },
    animationDuration: '1.4s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDelay: `${delaySeconds}s`,
  } as ViewStyle;
}

/** `letter-spacing: <em>em` at `fontSize` px. */
export const em = (fontSize: number, value: number) => fontSize * value;

export const SECTION_LABEL: TextStyle = {
  ...font('orbitron', 700),
  fontSize: 14,
  letterSpacing: em(14, 0.1),
  textTransform: 'uppercase',
  color: rgb('constellation-cyan-pale'),
};

/** Small uppercase meta label (10.5–11px, .16em tracking, slate). */
export function metaLabel(fontSize: number, tracking = 0.16): TextStyle {
  return {
    ...font('rajdhani', 700),
    fontSize,
    letterSpacing: em(fontSize, tracking),
    textTransform: 'uppercase',
    color: rgb('constellation-slate'),
  };
}

/** Body copy at weight 600 with a CSS unitless line-height. */
export function bodyText(
  fontSize: number,
  lineHeight: number,
  colorToken: string,
): TextStyle {
  return {
    ...font('rajdhani', 600),
    fontSize,
    lineHeight: fontSize * lineHeight,
    color: rgb(colorToken),
  };
}

export const CARD_SHELL: ViewStyle = {
  borderRadius: 18,
  paddingVertical: 20,
  paddingHorizontal: 21,
  backgroundColor: rgb('constellation-card', 0.6),
  borderWidth: 1,
  borderColor: rgb('constellation-cyan', 0.12),
};

export const SELECTED_CARD_GRADIENT = css(
  'linear-gradient(150deg,rgb(var(--constellation-navy-soft2-rgb) / .85),rgb(var(--constellation-ink-navy-rgb) / .8))',
);

export const SELECTED_SPAN_GRADIENT = css(
  'linear-gradient(150deg,rgb(var(--constellation-navy-soft2-rgb) / .9),rgb(var(--constellation-ink-navy-rgb) / .85))',
);

export const PAGE_BACKGROUND = css(
  'radial-gradient(ellipse at 82% -5%,rgb(var(--constellation-cyan-rgb) / .12),rgb(var(--constellation-navy-deepest-rgb) / 0) 50%),radial-gradient(ellipse at 8% 60%,rgb(var(--constellation-gold-rgb) / .07),rgb(var(--constellation-navy-deepest-rgb) / 0) 45%)',
);
