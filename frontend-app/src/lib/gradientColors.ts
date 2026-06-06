/**
 * gradientColors — central registry for categorical gradient and color values.
 *
 * These are fixed semantic colors (growth areas, personality types, etc.)
 * that don't vary with dark/light theme. All hardcoded hex values that are
 * tied to a specific category live here — never inline in components.
 */

export const GRADIENT_FALLBACK = { from: '#14b8a6', to: '#0d9488' };

/** Maps Tailwind growth-area `.color` strings to hex gradient pairs. */
export const AREA_GRADIENT_COLORS: Record<
  string,
  { from: string; to: string }
> = {
  'from-purple-500 to-indigo-600': { from: '#a855f7', to: '#4f46e5' },
  'from-rose-500 to-pink-600': { from: '#f43f5e', to: '#db2777' },
  'from-blue-500 to-cyan-600': { from: '#3b82f6', to: '#0891b2' },
  'from-amber-500 to-orange-600': { from: '#f59e0b', to: '#ea580c' },
  'from-emerald-500 to-teal-600': { from: '#10b981', to: '#0d9488' },
  'from-violet-500 to-purple-600': { from: '#8b5cf6', to: '#9333ea' },
};

/** Lighter tile palette used in GrowthAreasActivityGame. */
export const TILE_GRADIENT_COLORS: Record<
  string,
  { from: string; to: string }
> = {
  'from-purple-400 to-indigo-500': { from: '#c084fc', to: '#6366f1' },
  'from-rose-400 to-pink-500': { from: '#fb7185', to: '#ec4899' },
  'from-amber-400 to-orange-500': { from: '#fbbf24', to: '#f97316' },
  'from-emerald-400 to-teal-500': { from: '#34d399', to: '#14b8a6' },
  'from-blue-400 to-cyan-500': { from: '#60a5fa', to: '#06b6d4' },
  'from-violet-400 to-purple-500': { from: '#a78bfa', to: '#a855f7' },
};

/** Personality type → gradient pair (matches web personalityTypes .color fields). */
export const TYPE_GRADIENT: Record<string, { from: string; to: string }> = {
  Ambitious: { from: '#ef4444', to: '#db2777' },
  Determined: { from: '#f97316', to: '#dc2626' },
  Outgoing: { from: '#facc15', to: '#f97316' },
  Creative: { from: '#c084fc', to: '#ec4899' },
  Enthusiastic: { from: '#34d399', to: '#eab308' },
  Restless: { from: '#fb923c', to: '#ef4444' },
  'Highly Energetic': { from: '#ef4444', to: '#eab308' },
  Thinker: { from: '#60a5fa', to: '#6366f1' },
  Playful: { from: '#f472b6', to: '#a855f7' },
};

/** Area key → single line/dot color for the life pathway chart. */
export const AREA_LINE_COLORS: Record<string, string> = {
  life_ambition: '#8b5cf6',
  self_care: '#ec4899',
  critical_thinking: '#3b82f6',
  creativity: '#f59e0b',
  physical_wellness: '#10b981',
  social_skills: '#7c3aed',
};

/** Purple gradient for the growth-areas CTA in PersonalityJourneyScreen. */
export const PERSONALITY_JOURNEY_GRADIENT = { from: '#a855f7', to: '#4f46e5' };

/**
 * Goal dashboard month gradients (index 0 uses theme primary colors, provided
 * here for months 1 and 2 which have their own fixed brand colors).
 */
export const MONTH_GRADIENTS: Array<{ from: string; to: string } | null> = [
  null,
  { from: '#2563eb', to: '#3b82f6' },
  { from: '#9333ea', to: '#a855f7' },
];

/** Chart background band fill colors (decorative, category-specific). */
export const CHART_BAND_COLORS = [
  'rgba(20,255,160,0.04)',
  'rgba(60,120,255,0.04)',
  'rgba(160,60,255,0.04)',
];

/** Default text color rendered on top of colored avatar backgrounds. */
export const AVATAR_TEXT_COLOR = '#ffffff';
