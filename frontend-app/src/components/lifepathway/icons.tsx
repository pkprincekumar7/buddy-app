import Svg, { Path, Rect } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * The inline 24×24 stroke glyphs the StartJourneyModal steps draw (web inline
 * `<svg viewBox="0 0 24 24" fill="none" stroke=…>`), as react-native-svg.
 */
export const CHECK_PATH = 'M4 12.5l5 5L20 6.5';
export const PLUS_PATH = 'M12 5v14M5 12h14';
export const MINUS_PATH = 'M5 12h14';
export const CLOSE_PATH = 'M6 6l12 12M18 6L6 18';
export const BACK_ARROW_PATH = 'M19 12H5M11 6l-6 6 6 6';
export const FLAG_PATH = 'M5 21V4a1 1 0 011-1h11l-1.5 4L17 11H6';
export const APPLE_PATH =
  'M16.4 12.8c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.4 0-2.6.8-3.3 2-1.4 2.5-.4 6.1 1 8.1.7 1 1.5 2.1 2.5 2 1-.1 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .7-1.1 1-2.2 1-2.3-.1 0-2-.8-2-3.1zM14.3 6.3c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.3-.5.6-1 1.6-.8 2.5.9.1 1.9-.5 2.4-1.2z';

export function Glyph({
  d,
  size,
  stroke,
  strokeWidth = 2,
  viewBox = '0 0 24 24',
  style,
}: {
  d: string | readonly string[];
  size: number;
  stroke: string;
  strokeWidth?: number;
  viewBox?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const paths = typeof d === 'string' ? [d] : d;
  return (
    <Svg width={size} height={size} viewBox={viewBox} fill="none" style={style}>
      {paths.map(p => (
        <Path key={p} d={p} stroke={stroke} strokeWidth={strokeWidth} />
      ))}
    </Svg>
  );
}

/** Padlock used by the checkout's "$0 today" / "Powered by Stripe" rows. */
export function LockGlyph({ size, stroke }: { size: number; stroke: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x="5"
        y="11"
        width="14"
        height="9"
        rx="2"
        stroke={stroke}
        strokeWidth={2.2}
      />
      <Path d="M8 11V8a4 4 0 018 0v3" stroke={stroke} strokeWidth={2.2} />
    </Svg>
  );
}

/** Filled Apple mark on the express "Pay" button. */
export function AppleGlyph({ size, fill }: { size: number; fill: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={APPLE_PATH} fill={fill} />
    </Svg>
  );
}
