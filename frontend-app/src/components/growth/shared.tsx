/**
 * Small building blocks shared by the Growth Map screen and its sheet:
 * the inline-path icon, the pill buttons (web PILL/CTA styles), entrance
 * keyframes and a couple of geometry helpers.
 */
import React from 'react';
import {
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Svg, { Path } from 'react-native-svg';
import { Easing, Keyframe } from 'react-native-reanimated';
import { css, rgb } from '@/theme';

/** framer `ease: [0.16, 1, 0.3, 1]`. */
export const EASE_OUT_EXPO = Easing.bezierFn(0.16, 1, 0.3, 1);
/** framer `ease: 'easeOut'`. */
export const EASE_OUT = Easing.bezierFn(0, 0, 0.58, 1);

/** framer `initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }}`. */
export function fadeUp(y: number, durationMs: number, delayMs = 0) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: y }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
  })
    .duration(durationMs)
    .delay(delayMs);
}

/** A web area `hue` ("160,120,255") at the given alpha — the web's `rgba(${hue},a)`. */
export function hueAlpha(hue: string, alpha: number): string {
  return `rgba(${hue},${alpha})`;
}

/**
 * Rescales an absolute M/L/C/Q path (coordinate pairs only) from its viewBox
 * into pixels. Stands in for the web's `preserveAspectRatio="none"` +
 * `vector-effect: non-scaling-stroke`: the path stretches to its box while the
 * stroke (and dash pattern) stays in device pixels.
 */
export function scalePath(d: string, sx: number, sy: number): string {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, n => {
    const v = parseFloat(n) * (i++ % 2 === 0 ? sx : sy);
    return String(Math.round(v * 100) / 100);
  });
}

/** The web's inline `<svg viewBox="0 0 24 24" fill="none" stroke=…><path d=…/></svg>`. */
export function PathIcon({
  d,
  size,
  stroke,
  strokeWidth,
}: {
  d: string;
  size: number;
  stroke: string;
  strokeWidth: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={stroke} strokeWidth={strokeWidth} fill="none" />
    </Svg>
  );
}

// ─── Pills (web PILL / CTA) ─────────────────────────────────────────────────

/** web PILL text: 700 · 12.5px · .16em · uppercase. */
export const PILL_TEXT: TextStyle = {
  fontWeight: '700',
  fontSize: 12.5,
  letterSpacing: 12.5 * 0.16,
  textTransform: 'uppercase',
};

/** web PILL box. */
const PILL_BOX: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  alignSelf: 'center',
  gap: 8,
  borderRadius: 999,
};

/** web CTA — cyan gradient pill with a cyan glow. */
export const CTA: ViewStyle = {
  experimental_backgroundImage: css(
    'linear-gradient(135deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))',
  ),
  boxShadow: css('0 0 24px rgb(var(--constellation-cyan-rgb) / .45)'),
};
export const CTA_TEXT = rgb('constellation-navy');

interface PillProps {
  label: string;
  onPress: () => void;
  /** Box style — padding, background, border (merged over the PILL box). */
  style?: StyleProp<ViewStyle>;
  textColor: string;
  fontSize?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Icon path drawn before (`left`) or after (`right`) the label. */
  icon?: {
    d: string;
    side: 'left' | 'right';
    size: number;
    strokeWidth: number;
  };
}

/** A web `<button style={{...PILL, ...}}>`, with the global `button:active { scale(.97) }`. */
export function Pill({
  label,
  onPress,
  style,
  textColor,
  fontSize,
  disabled,
  accessibilityLabel,
  icon,
}: PillProps) {
  const glyph = icon ? (
    <PathIcon
      d={icon.d}
      size={icon.size}
      stroke={textColor}
      strokeWidth={icon.strokeWidth}
    />
  ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        PILL_BOX,
        style,
        pressed && !disabled ? { transform: [{ scale: 0.97 }] } : null,
      ]}
    >
      {icon?.side === 'left' ? glyph : null}
      <Text
        style={[
          PILL_TEXT,
          fontSize ? { fontSize, letterSpacing: fontSize * 0.16 } : null,
          { color: textColor },
        ]}
      >
        {label}
      </Text>
      {icon?.side === 'right' ? glyph : null}
    </Pressable>
  );
}
