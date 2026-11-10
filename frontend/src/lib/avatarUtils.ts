/**
 * Generates initials-based avatar images as inline SVG data URIs.
 *
 * Replaces external calls to ui-avatars.com:
 *   - No network request → no external dependency, no CORS headers
 *   - No personal data (names) sent to third parties
 *   - Works identically in local Docker Compose, dev, stg, and prod
 */

/**
 * Extracts up to two initials from a display name.
 *   "John Doe"  → "JD"
 *   "Alice"     → "A"
 *   ""          → "?"
 */
export function getInitials(name: string): string {
  if (!name?.trim()) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0]?.[0] ?? '?').toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[words.length - 1]?.[0] ?? '')).toUpperCase();
}

/**
 * Deterministically maps a string to an HSL colour so that the same name
 * always produces the same avatar colour without any external call.
 */
function nameToColor(name: string): string {
  const str = name || '?';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

/**
 * Generates an initials avatar as an inline SVG data URI.
 * Safe for use in <img src> or CSS url() — no external requests.
 */
import { AVATAR_TEXT_COLOR } from '@/lib/gradientColors';

export function generateAvatarDataUri(
  name: string,
  opts?: { background?: string; color?: string; size?: number },
): string {
  const { background = 'random', color = AVATAR_TEXT_COLOR, size = 128 } = opts ?? {};
  const initials = getInitials(name);
  const bg =
    background === 'random'
      ? nameToColor(name)
      : /^(#|hsl|rgb|oklch|color)/.test(background)
        ? background
        : `#${background}`;
  const fontSize = Math.round(size * 0.42);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <rect width="${size}" height="${size}" fill="${bg}"/>`,
    `  <text x="50%" y="50%"`,
    `    dominant-baseline="central" text-anchor="middle"`,
    `    font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif"`,
    `    font-size="${fontSize}" font-weight="600" fill="${color}">${initials}</text>`,
    `</svg>`,
  ].join('\n');

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
