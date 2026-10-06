const RGBA_RE =
  /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+%?)\s*\)$/i;

/**
 * Props for a react-native-svg gradient <Stop> from any theme color string:
 * `<Stop offset="45%" {...stop(rgb('constellation-gold', 0.26))} />`.
 *
 * react-native-svg discards the alpha channel of `stopColor` (it keeps only
 * the RGB and takes alpha from `stopOpacity`), while browsers honour
 * `rgba(...)` stop colors. Every translucent web gradient stop therefore
 * rendered fully opaque until its alpha was moved into `stopOpacity` — which
 * is what this does. It has to be applied as props on the <Stop> element
 * itself: the gradient reads its children's props directly and never renders
 * them, so a wrapper component would be bypassed.
 */
export function stop(
  color: string,
  opacity = 1,
): { stopColor: string; stopOpacity: number } {
  const m = RGBA_RE.exec(color.trim());
  if (!m) return { stopColor: color, stopOpacity: opacity };
  const [, r, g, b, a = '1'] = m;
  const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  return { stopColor: `rgb(${r},${g},${b})`, stopOpacity: alpha * opacity };
}
