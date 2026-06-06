/**
 * themeColors — single source of truth for dark/light palette tokens.
 *
 * Every component and navigation theme object references these values.
 * To change a color, edit it here once — nothing else needs touching.
 */

export interface AppColors {
  background: string;
  /** Slightly raised surface above background — cards, modals, bottom sheets. */
  card: string;
  /** Elevated surface — nested panels, hover states, accordion content. */
  surfaceElevated: string;
  /** Subtle muted background — tag chips, inactive tabs, faint sections. */
  muted: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  /** Lighter end of the primary teal gradient (e.g. GradientButton from= stop). */
  primaryLight: string;
  /** Darker end of the primary teal gradient (e.g. GradientButton to= stop). */
  primaryDark: string;
  /** Text color used on top of a primary-colored background (e.g. CTA buttons). */
  primaryForeground: string;
  tabInactive: string;
  iconColor: string;
  pressedBackground: string;
  headerShadowColor: string;
  /** Numeric shadow radius — kept here so components need only one token lookup. */
  headerShadowRadius: number;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Shadow color for elevated surfaces (e.g. cards, dropdowns). */
  shadowColor: string;
  /** Semi-transparent backdrop behind modals and drawers. */
  overlayBackground: string;
  /** Subtle chart grid-line stroke — low-opacity contrast vs background. */
  subtleGridLine: string;
  /** Dashed cursor/crosshair line in charts. */
  cursorLine: string;
  /** Very faint surface tint for inactive/disabled items. */
  inactiveSurface: string;
  /** Android ripple color for touchable elements. */
  ripple: string;
  /** Border color specifically for input fields — higher contrast than the general border token. */
  inputBorder: string;
}

export const darkColors: AppColors = {
  background: '#0a0a0a',
  card: '#141414',
  surfaceElevated: '#1a1a1a',
  muted: '#1f1f1f',
  text: '#ffffff',
  textMuted: '#cbd5e1',
  border: '#1a1a1a',
  primary: '#14b8a6',
  primaryLight: '#2dd4bf',
  primaryDark: '#0f766e',
  primaryForeground: '#ffffff',
  tabInactive: '#6b7280',
  iconColor: '#64748b',
  pressedBackground: 'rgba(255,255,255,0.08)',
  headerShadowColor: 'rgba(45,212,191,0.45)',
  headerShadowRadius: 10,
  success: '#34d399',
  warning: '#fb923c',
  error: '#f87171',
  info: '#60a5fa',
  shadowColor: '#000000',
  overlayBackground: 'rgba(0,0,0,0.35)',
  subtleGridLine: 'rgba(255,255,255,0.05)',
  cursorLine: 'rgba(255,255,255,0.30)',
  inactiveSurface: 'rgba(255,255,255,0.04)',
  ripple: 'rgba(0,0,0,0.1)',
  inputBorder: '#2d2d2d',
};

export const lightColors: AppColors = {
  background: '#f8fafc',
  card: '#ffffff',
  surfaceElevated: '#f1f5f9',
  muted: '#f1f5f9',
  text: '#0f172a',
  textMuted: '#334155',
  border: '#e2e8f0',
  primary: '#0d9488',
  primaryLight: '#2dd4bf',
  primaryDark: '#0f766e',
  primaryForeground: '#ffffff',
  tabInactive: '#6b7280',
  iconColor: '#475569',
  pressedBackground: 'rgba(0,0,0,0.06)',
  headerShadowColor: 'transparent',
  headerShadowRadius: 0,
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  info: '#2563eb',
  shadowColor: '#000000',
  overlayBackground: 'rgba(0,0,0,0.35)',
  subtleGridLine: 'rgba(0,0,0,0.05)',
  cursorLine: 'rgba(0,0,0,0.30)',
  inactiveSurface: 'rgba(0,0,0,0.04)',
  ripple: 'rgba(0,0,0,0.1)',
  inputBorder: '#94a3b8',
};
