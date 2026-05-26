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
 * Strips `image` from every `profile.famous_people` entry before persisting
 * the view_model to the backend.
 *
 * SVG data-URI avatars (`data:image/svg+xml;…`) embedded in the JSON body
 * trigger the AWS WAF Core Rule Set's CrossSiteScripting_BODY rule (the rule
 * URL-decodes the body and sees `<svg>/<text>` tags). Stripping images before
 * the API call keeps the payload WAF-safe. On next load, `sanitizeViewModelAvatars`
 * regenerates the avatars from the person's name, so the UI is unaffected.
 */
export function stripViewModelImages(vm: Record<string, unknown>): Record<string, unknown> {
  const profile = vm?.profile;
  if (!profile || typeof profile !== 'object') return vm;
  const people = (profile as Record<string, unknown>).famous_people;
  if (!Array.isArray(people)) return vm;
  const stripped = people.map((person: unknown) => {
    if (!person || typeof person !== 'object') return person;
    const { image: _image, ...rest } = person as Record<string, unknown>;
    return rest;
  });
  return {
    ...vm,
    profile: { ...(profile as Record<string, unknown>), famous_people: stripped },
  };
}

export function sanitizeViewModelAvatars(vm: Record<string, unknown>): Record<string, unknown> {
  const profile = vm?.profile;
  if (!profile || typeof profile !== 'object') return vm;
  const people = (profile as Record<string, unknown>).famous_people;
  if (!Array.isArray(people)) return vm;

  const sanitizedPeople = people.map((person: unknown) => {
    if (!person || typeof person !== 'object') return person;
    const p = person as Record<string, unknown>;
    const img = p.image;
    const isSafe =
      (typeof img === 'string' && img.startsWith('data:image/')) ||
      (typeof img === 'string' && img.startsWith('https://upload.wikimedia.org/'));
    if (isSafe) return p;
    const name = typeof p.name === 'string' ? p.name : 'Guide';
    return { ...p, image: generateAvatarDataUri(name) };
  });

  return {
    ...vm,
    profile: { ...(profile as Record<string, unknown>), famous_people: sanitizedPeople },
  };
}

/**
 * Generates an initials avatar as an inline SVG data URI.
 * Safe for use in <img src> or CSS url() — no external requests.
 */
export function generateAvatarDataUri(
  name: string,
  opts?: { background?: string; color?: string; size?: number },
): string {
  const { background = 'random', color = '#ffffff', size = 128 } = opts ?? {};
  const initials = getInitials(name);
  const bg =
    background === 'random'
      ? nameToColor(name)
      : background.startsWith('#')
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
