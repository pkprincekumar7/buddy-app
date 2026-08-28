/**
 * gradientColors — central registry for categorical gradient and color values.
 *
 * These are fixed semantic colors tied to specific categories (growth areas,
 * personality types, chart bands, etc.) that don't vary with dark/light theme.
 * The actual RGB values live in `src/index.css` (see "CATEGORICAL / CHART
 * COLORS") — this file only holds `rgb(var(--x))` references, so a palette
 * change is still a one-file (`index.css`) edit, never inline in components.
 */

/*
 * Per-growth-area chart colours used to live here as AREA_LINE_COLORS, for the
 * recharts LineChart the Life Pathway page used to draw. That page now derives
 * area colour from GROWTH_AREAS[].hue (see AREA_HEX in lifePathwayData), which
 * keeps a single source of truth, and nothing else consumed the map — so it was
 * removed rather than left as a second, drifting palette.
 */

/** Chart background band fill colors for the 3-month progress chart. */
export const CHART_BAND_COLORS = [
  'rgb(var(--chart-band-a-rgb) / 0.03)',
  'rgb(var(--chart-band-b-rgb) / 0.03)',
  'rgb(var(--chart-band-c-rgb) / 0.03)',
];

/**
 * Per-pillar glow rgba values used with the `.glow-pillar` CSS utility
 * (`--pillar-glow` CSS custom property). Each value matches the pillar's
 * gradient color at 15% opacity.
 */
export const PILLAR_GLOW_COLORS = {
  mind: 'rgb(var(--pillar-mind-rgb) / 0.15)',
  heart: 'rgb(var(--pillar-heart-rgb) / 0.15)',
  body: 'rgb(var(--pillar-body-rgb) / 0.15)',
  talents: 'rgb(var(--pillar-talents-rgb) / 0.15)',
  character: 'rgb(var(--pillar-character-rgb) / 0.15)',
  future: 'rgb(var(--pillar-future-rgb) / 0.15)',
} as const;

/**
 * Default text color rendered on top of colored avatar backgrounds.
 *
 * Deliberately a plain literal, not a `rgb(var(--x))` token: this feeds
 * `generateAvatarDataUri()`, which bakes it into a standalone
 * `data:image/svg+xml` document (see `lib/avatarUtils.ts`). A `data:` URI
 * image has no access to the parent page's CSS custom properties — `var()`
 * would fail to resolve there and the text would render in the browser's
 * fallback (black) instead of white.
 */
export const AVATAR_TEXT_COLOR = '#ffffff';
