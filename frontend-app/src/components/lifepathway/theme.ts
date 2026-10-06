/**
 * Style constants shared by every step of StartJourneyModal
 * (Ask/Plan/Payment/Done/Dashboard/Tracker) — kept in one place so the six
 * step views read as one consistent surface rather than six independently
 * styled screens.
 *
 * RN port of web `components/lifepathway/theme.ts`: the web's single
 * `React.CSSProperties` objects are split into a container `ViewStyle` and a
 * label `TextStyle` (RN has no style inheritance), shorthands are expanded,
 * and web-only props (boxSizing, outline, cursor) are dropped.
 */
import type { TextStyle, ViewStyle } from 'react-native';

import { color, css, font, rgb } from '@/theme';

export const GOLD = rgb('constellation-gold');
export const GOLD_PALE = rgb('constellation-gold-pale');
export const CYAN = rgb('constellation-cyan');
export const INK = rgb('constellation-navy');
export const BODY = rgb('constellation-slate-warm');
export const LABEL_CL = rgb('constellation-slate-mute');
export const FROST = rgb('constellation-text-frost');

// Other constellation tints the steps use repeatedly.
export const CYAN_PALE = rgb('constellation-cyan-pale');
export const SLATE_MUTE = rgb('constellation-slate-mute');
export const SLATE_LIGHT = rgb('constellation-slate-light');
export const SLATE_COOL = rgb('constellation-slate-cool');
export const SLATE_PALE = rgb('constellation-slate-pale');
export const SLATE_DEEP = rgb('constellation-slate-deep');
export const SLATE_WARM = rgb('constellation-slate-warm');
export const CAPTION = rgb('constellation-caption');
export const SUCCESS = color['success-bright'];
/** Placeholder text — the web inherits the browser's dimmed placeholder color. */
export const PLACEHOLDER = rgb('constellation-slate-mute');

/** `linear-gradient(135deg, cyan, gold)` — the primary CTA fill. */
export const GRAD_CYAN_GOLD_135 = `linear-gradient(135deg,${CYAN},${GOLD})`;
export const GRAD_CYAN_GOLD_150 = `linear-gradient(150deg,${CYAN},${GOLD})`;
export const GRAD_CYAN_GOLD_90 = `linear-gradient(90deg,${CYAN},${GOLD})`;

/** Rajdhani text at a web size/weight, with optional `em` letter-spacing. */
export function rj(
  fontSize: number,
  weight: number,
  c: string,
  em?: number,
): TextStyle {
  return {
    ...font('rajdhani', weight),
    fontSize,
    color: c,
    ...(em === undefined ? null : { letterSpacing: fontSize * em }),
  };
}

/** Orbitron text at a web size/weight, with optional `em` letter-spacing. */
export function orb(
  fontSize: number,
  weight: number,
  c: string,
  em?: number,
): TextStyle {
  return {
    ...font('orbitron', weight),
    fontSize,
    color: c,
    ...(em === undefined ? null : { letterSpacing: fontSize * em }),
  };
}

/** Uppercase small-caps label (web `textTransform: 'uppercase'` kicker). */
export function kicker(
  fontSize: number,
  em: number,
  c: string,
  weight = 700,
): TextStyle {
  return { ...rj(fontSize, weight, c, em), textTransform: 'uppercase' };
}

export const FIELD_STYLE: TextStyle = {
  width: '100%',
  marginTop: 7,
  paddingVertical: 12,
  paddingHorizontal: 14,
  borderRadius: 10,
  backgroundColor: css('rgb(var(--constellation-navy-deepest-rgb) / .85)'),
  borderWidth: 1,
  borderColor: css('rgb(var(--constellation-cyan-rgb) / .2)'),
  color: FROST,
  ...font('rajdhani', 700),
  fontSize: 15.5,
};

export const FIELD_LABEL_STYLE: TextStyle = {
  ...font('rajdhani', 700),
  fontSize: 10.5,
  letterSpacing: 10.5 * 0.18,
  textTransform: 'uppercase',
  color: LABEL_CL,
};

/** Primary CTA container — pair with PRIMARY_BTN_TEXT on the label. */
export const PRIMARY_BTN: ViewStyle = {
  paddingVertical: 14,
  paddingHorizontal: 32,
  borderRadius: 999,
  borderWidth: 0,
  experimental_backgroundImage: GRAD_CYAN_GOLD_135,
  boxShadow: css('0 0 30px rgb(var(--constellation-cyan-rgb) / .35)'),
};

/** Primary CTA label — web `PRIMARY_BTN`'s text half (Rajdhani 900, uppercase). */
export const PRIMARY_BTN_TEXT: TextStyle = {
  ...font('rajdhani', 900),
  fontSize: 12.5,
  letterSpacing: 12.5 * 0.14,
  textTransform: 'uppercase',
  color: INK,
};
