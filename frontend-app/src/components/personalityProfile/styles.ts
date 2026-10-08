/**
 * Shared chrome for the Personality Profile ("Discover") page — the web's
 * CARD_BG / CARD_BORDER / SEC_LABEL / GOLD_PILL constants, as RN styles.
 */
import { type TextStyle, type ViewStyle } from 'react-native';
import { css, fonts, rgb } from '@/theme';
import { PP } from './palette';

/**
 * The web's `'Playfair Display', serif` — the same font files (static weight-700
 * instances, see `fonts.playfair`). Italic runs use SERIF_ITALIC: RN picks a
 * custom font by exact family, so `fontStyle: 'italic'` would only slant the
 * upright face.
 */
export const SERIF: TextStyle = { fontFamily: fonts.playfair };
export const SERIF_ITALIC: TextStyle = { fontFamily: fonts.playfairItalic };

/** CSS `clamp(min, vw * factor, max)` against the window width. */
export function clampVw(
  min: number,
  vwPercent: number,
  max: number,
  windowW: number,
): number {
  return Math.min(max, Math.max(min, (windowW * vwPercent) / 100));
}

export const CARD: ViewStyle = {
  borderWidth: 1,
  borderColor: rgb('constellation-blue-line', 0.16),
  borderRadius: 16,
  experimental_backgroundImage: css(
    `linear-gradient(180deg, ${PP.cardBgTop}, rgb(var(--constellation-navy-card-rgb) / .35))`,
  ),
};

export const SEC_LABEL: TextStyle = {
  fontSize: 13,
  letterSpacing: 13 * 0.34,
  textTransform: 'uppercase',
  color: PP.secLabel,
  textAlign: 'center',
  marginBottom: 18,
};

/** Shared "gold outline pill" chrome (share buttons, onward CTA). */
export const GOLD_PILL: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  borderRadius: 999,
  borderWidth: 1,
  borderColor: rgb('constellation-gold-light', 0.6),
  backgroundColor: rgb('constellation-blue-royal', 0.45),
  boxShadow: css('0 0 18px rgb(var(--constellation-gold-light-rgb) / .16)'),
};

/** GOLD_PILL's text half (color/letter-spacing/uppercase) at a given size. */
export function goldPillText(fontSize: number): TextStyle {
  return {
    color: rgb('constellation-gold-hazy'),
    fontSize,
    letterSpacing: fontSize * 0.16,
    textTransform: 'uppercase',
  };
}
