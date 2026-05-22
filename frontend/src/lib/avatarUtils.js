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
 *
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  if (!name || !name.trim()) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Deterministically maps a string to an HSL colour so that the same name
 * always produces the same avatar colour without any external call.
 *
 * @param {string} name
 * @returns {string} CSS hsl() value
 */
function nameToColor(name) {
  const str = name || '?';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

/**
 * Sanitizes a personality view-model loaded from the database.
 *
 * Replaces any `profile.famous_people[].image` that is not already a data URI
 * or a trusted Wikipedia image URL with a locally-generated initials avatar.
 *
 * This handles legacy MongoDB documents that were saved when the code still
 * called ui-avatars.com for role-model images — on next load those stale URLs
 * are silently replaced with data URIs so no external request is ever made.
 *
 * Allow-list rationale:
 *   data:            — already a locally-generated SVG data URI (new code).
 *   upload.wikimedia.org — the static personalityTypes fallback images
 *                         (real photos, no personal data in the URL).
 *   everything else  — replace: may be ui-avatars.com (sends child-related
 *                       names to a third party) or any other unexpected source.
 *
 * @param {object} vm  The personality view_model as stored in MongoDB.
 * @returns {object}   A new view_model object with all famous_people images
 *                     replaced by safe data URIs where necessary.
 */
export function sanitizeViewModelAvatars(vm) {
  const people = vm?.profile?.famous_people;
  if (!Array.isArray(people)) return vm;

  const sanitizedPeople = people.map((person) => {
    const img = person.image;
    const isSafe =
      (typeof img === 'string' && img.startsWith('data:')) ||
      (typeof img === 'string' && img.startsWith('https://upload.wikimedia.org/'));
    if (isSafe) return person;
    return { ...person, image: generateAvatarDataUri(person.name || 'Guide') };
  });

  return {
    ...vm,
    profile: { ...vm.profile, famous_people: sanitizedPeople },
  };
}

/**
 * Generates an initials avatar as an inline SVG data URI.
 * Safe for use in <img src> or CSS url() — no external requests.
 *
 * @param {string} name             Display name to derive initials from.
 * @param {object} [opts]
 * @param {string} [opts.background='random']  '#rrggbb' hex (with or without
 *   leading '#') or 'random' for a deterministic colour derived from the name.
 * @param {string} [opts.color='#ffffff']       Foreground (text) colour.
 * @param {number} [opts.size=128]              Image width/height in px.
 * @returns {string} SVG data URI.
 */
export function generateAvatarDataUri(
  name,
  { background = 'random', color = '#ffffff', size = 128 } = {},
) {
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
