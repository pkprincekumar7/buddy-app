/**
 * gradientColors — central registry for categorical gradient and color values.
 *
 * These are fixed semantic colors tied to specific categories (growth areas,
 * personality types, chart bands, etc.) that don't vary with dark/light theme.
 * All hardcoded hex values must live here — never inline in components.
 */

/** Area key → single line/dot color for recharts strokes and SVG fills. */
export const AREA_LINE_COLORS: Record<string, string> = {
  life_ambition: '#8b5cf6',
  self_care: '#ec4899',
  critical_thinking: '#3b82f6',
  creativity: '#f59e0b',
  physical_wellness: '#10b981',
  social_skills: '#7c3aed',
};

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
