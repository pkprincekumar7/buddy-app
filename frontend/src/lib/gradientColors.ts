/**
 * gradientColors — central registry for categorical gradient and color values.
 *
 * These are fixed semantic colors tied to specific categories (growth areas,
 * personality types, chart bands, etc.) that don't vary with dark/light theme.
 * All hardcoded hex values must live here — never inline in components.
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
  'rgba(20,255,160,0.03)',
  'rgba(60,120,255,0.03)',
  'rgba(160,60,255,0.03)',
];

/**
 * Per-pillar glow rgba values used with the `.glow-pillar` CSS utility
 * (`--pillar-glow` CSS custom property). Each value matches the pillar's
 * gradient color at 15% opacity.
 */
export const PILLAR_GLOW_COLORS = {
  mind: 'rgba(59,130,246,0.15)',
  heart: 'rgba(244,63,94,0.15)',
  body: 'rgba(16,185,129,0.15)',
  talents: 'rgba(168,85,247,0.15)',
  character: 'rgba(245,158,11,0.15)',
  future: 'rgba(20,184,166,0.15)',
} as const;

/** Default text color rendered on top of colored avatar backgrounds. */
export const AVATAR_TEXT_COLOR = '#ffffff';
