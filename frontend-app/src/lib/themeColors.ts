/**
 * themeColors — single source of truth for dark/light palette tokens.
 *
 * All values are derived from the web `frontend` app's CSS variables
 * (index.css) converted to hex, ensuring visual parity across platforms.
 *
 * To change a color, edit it here once — nothing else needs touching.
 */

export interface AppColors {
  // ─── Surfaces ──────────────────────────────────────────────────────────────
  /** Near-black / near-white screen background. */
  background: string;
  /** Slightly raised surface — cards, modals, bottom sheets. */
  card: string;
  /** Elevated surface — nested panels, hover states, accordion content. */
  surfaceElevated: string;
  /** Input field background — slightly lighter than surfaceElevated. */
  surfaceInput: string;
  /** Subtle muted background — tag chips, inactive tabs, faint sections. */
  muted: string;
  /** Alternate section background — slightly off-background tint. */
  sectionAlt: string;
  /** Darker section background — section dividers, footers. */
  sectionDark: string;
  /** Muted surface tint — disabled overlays, chart backgrounds. */
  surfaceMuted: string;
  /** Darkest surface — deep nested surfaces, chart axes. */
  surfaceDark: string;

  // ─── Text ──────────────────────────────────────────────────────────────────
  /** Primary body text. */
  text: string;
  /** Secondary / helper text. */
  textMuted: string;
  /** Slightly dimmed foreground — slate-300 in dark, slate-600 in light. */
  dim: string;
  /** Subtle foreground — slate-500 in dark, slate-700 in light. */
  subtle: string;
  /** Faint foreground — slate-600 in dark, slate-800 in light. */
  faint: string;
  /** Very faint foreground — slate-700 in dark, slate-900 in light. */
  xfaint: string;

  // ─── Border ────────────────────────────────────────────────────────────────
  border: string;
  /** Higher-contrast border for input fields. */
  inputBorder: string;

  // ─── Primary (teal) scale ──────────────────────────────────────────────────
  /** Very light teal tint — backgrounds, highlights. */
  primaryBgLight: string;
  /** Light teal — gradient start stop, highlights. */
  primaryLight: string;
  /** Brand teal — default interactive color. */
  primary: string;
  /** Mid teal — icon fills, subtle accents. */
  primaryMedium: string;
  /** Action teal — CTA button background. */
  primaryAction: string;
  /** Dark teal — gradient end stop. */
  primaryDark: string;
  /** Stronger teal — hover states on dark surfaces. */
  primaryStronger: string;
  /** Strongest teal — borders on teal backgrounds. */
  primaryXStrong: string;
  /** Text color on top of a primary-colored background. */
  primaryForeground: string;

  // ─── Success (emerald) scale ───────────────────────────────────────────────
  successMuted: string;
  successLight: string;
  successBright: string;
  success: string;
  successStrong: string;
  successXStrong: string;

  // ─── Warning (amber/orange) scale ─────────────────────────────────────────
  warningLight: string;
  warning: string;
  warningMedium: string;
  warningStrong: string;
  warningOrange: string;
  warningOrangeMedium: string;

  // ─── Error (red) scale ─────────────────────────────────────────────────────
  errorXLight: string;
  errorLight: string;
  error: string;
  errorMedium: string;
  errorStrong: string;
  errorMuted: string;

  // ─── Info (blue) scale ─────────────────────────────────────────────────────
  infoMuted: string;
  info: string;
  infoMedium: string;
  infoStrong: string;

  // ─── Personality (purple/violet) scale ────────────────────────────────────
  personalityLight: string;
  personality: string;
  personalityAlt: string;
  personalityAltStrong: string;

  // ─── Accent ────────────────────────────────────────────────────────────────
  accentPink: string;

  // ─── UI behaviour ──────────────────────────────────────────────────────────
  tabInactive: string;
  iconColor: string;
  /** Semi-transparent backdrop behind modals and drawers. */
  overlayBackground: string;
  /** Press / ripple tint for touchable elements (= ghostStrong, 8 % tint). */
  pressedBackground: string;
  /** Android ripple color for touchable elements. */
  ripple: string;
  /** Shadow color for elevated surfaces (cards, dropdowns). */
  shadowColor: string;
  /** Header drop-shadow color (teal glow in dark, transparent in light). */
  headerShadowColor: string;
  /** Numeric shadow radius — kept here so components do one token lookup. */
  headerShadowRadius: number;

  // ─── Ghost / edge tints (edge-rgb pattern from web) ──────────────────────
  /** 4 % white/black tint — faintest surface overlay. */
  ghostMd: string;
  /** 6 % white/black tint. */
  ghostLight: string;
  /** 8 % white/black tint — pressed / active state. */
  ghostStrong: string;
  /** 12 % white/black tint — hover state. */
  ghostHover: string;
  /** 20 % white/black tint — icon containers on gradient headers. */
  ghostXL: string;

  // ─── Chart utilities ───────────────────────────────────────────────────────
  /** Subtle chart grid-line stroke. */
  subtleGridLine: string;
  /** Dashed cursor/crosshair line in charts. */
  cursorLine: string;
  /** Very faint surface tint for inactive/disabled items. */
  inactiveSurface: string;

  // ─── Image scrim ───────────────────────────────────────────────────────────
  /** Semi-transparent dark overlay for text legibility on photo/tile backgrounds.
   *  Always dark in both modes — photos always need a dark scrim. */
  imageScrimColor: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dark mode
// ─────────────────────────────────────────────────────────────────────────────
export const darkColors: AppColors = {
  // Surfaces — neutral achromatic palette matching web dark mode
  background: '#0a0a0a',
  card: '#141414',
  surfaceElevated: '#1a1a1a',
  surfaceInput: '#1e1e1e',
  muted: '#1f1f1f',
  sectionAlt: '#0d0d0d',
  sectionDark: '#111111',
  surfaceMuted: '#48566a',
  surfaceDark: '#1d283a',

  // Text
  text: '#fafafa',
  textMuted: '#94a3b8', // slate-400
  dim: '#cbd5e1', // slate-300
  subtle: '#65758b', // slate-500
  faint: '#48566a', // slate-600
  xfaint: '#344256', // slate-700

  // Border
  border: '#262626',
  inputBorder: '#262626',

  // Primary scale
  primaryBgLight: '#a5f3e1',
  primaryLight: '#73e2d4',
  primary: '#3ee0cf',
  primaryMedium: '#10b7a6',
  primaryAction: '#0d9688',
  primaryDark: '#0c887c',
  primaryStronger: '#0f756d',
  primaryXStrong: '#115f5a',
  primaryForeground: '#ffffff', // white text/icons on any primary-coloured surface

  // Success scale
  successMuted: '#a1f2cc',
  successLight: '#6ee7b7',
  successBright: '#19eba5',
  success: '#10b77f',
  successStrong: '#059467',
  successXStrong: '#047756',

  // Warning scale
  warningLight: '#fcd44f',
  warning: '#fbbd23',
  warningMedium: '#f59f0a',
  warningStrong: '#b35309',
  warningOrange: '#f97415',
  warningOrangeMedium: '#e9590c',

  // Error scale
  errorXLight: '#fef1f1',
  errorLight: '#fca6a6',
  error: '#f87272',
  errorMedium: '#ef4343',
  errorStrong: '#c52020',
  errorMuted: '#fca1a1',

  // Info scale
  infoMuted: '#8cb8f2',
  info: '#3c83f6',
  infoMedium: '#0b62ef',
  infoStrong: '#2463eb',

  // Personality scale
  personalityLight: '#7b24cc',
  personality: '#9234ea',
  personalityAlt: '#895af6',
  personalityAltStrong: '#6b26d9',

  // Accent
  accentPink: '#ec4699',

  // UI behaviour
  tabInactive: '#6b7280',
  iconColor: '#64748b',
  overlayBackground: 'rgba(0,0,0,0.75)',
  pressedBackground: 'rgba(255,255,255,0.08)', // = ghostStrong
  ripple: 'rgba(0,0,0,0.1)',
  shadowColor: '#000000',
  headerShadowColor: 'rgba(45,212,191,0.45)',
  headerShadowRadius: 10,

  // Ghost tints — white base in dark mode
  ghostMd: 'rgba(255,255,255,0.04)',
  ghostLight: 'rgba(255,255,255,0.06)',
  ghostStrong: 'rgba(255,255,255,0.08)',
  ghostHover: 'rgba(255,255,255,0.12)',
  ghostXL: 'rgba(255,255,255,0.20)',

  // Chart utilities
  subtleGridLine: 'rgba(255,255,255,0.05)',
  cursorLine: 'rgba(255,255,255,0.30)',
  inactiveSurface: 'rgba(255,255,255,0.04)',

  // Image scrim — always dark for photo legibility
  imageScrimColor: 'rgba(0,0,0,0.6)',
};

// ─────────────────────────────────────────────────────────────────────────────
// Light mode
// ─────────────────────────────────────────────────────────────────────────────
export const lightColors: AppColors = {
  // Surfaces
  background: '#fafafa',
  card: '#ffffff',
  surfaceElevated: '#ffffff',
  surfaceInput: '#f5f5f5',
  muted: '#f0f0f0',
  sectionAlt: '#f5f5f5',
  sectionDark: '#ededed',
  surfaceMuted: '#b3bdcc',
  surfaceDark: '#d1d7e0',

  // Text
  text: '#1a1a1a',
  textMuted: '#666666',
  dim: '#48566a',
  subtle: '#3c4553',
  faint: '#29313d',
  xfaint: '#1d2530',

  // Border
  border: '#d9d9d9',
  inputBorder: '#d9d9d9',

  // Primary scale
  primaryBgLight: '#d6f5f2',
  primaryLight: '#0f756d',
  primary: '#1dafa1',
  primaryMedium: '#0c887c',
  primaryAction: '#199a8d',
  primaryDark: '#09635a',
  primaryStronger: '#0d4945',
  primaryXStrong: '#0c413d',
  primaryForeground: '#ffffff',

  // Success scale
  successMuted: '#47d191',
  successLight: '#1daf75',
  successBright: '#0ea472',
  success: '#0c8d62',
  successStrong: '#047752',
  successXStrong: '#035941',

  // Warning scale
  warningLight: '#da7a0b',
  warning: '#b35309',
  warningMedium: '#a04a08',
  warningStrong: '#883f07',
  warningOrange: '#aa4109',
  warningOrangeMedium: '#913808',

  // Error scale
  errorXLight: '#fde7e7',
  errorLight: '#eb1414',
  error: '#dc2828',
  errorMedium: '#c52020',
  errorStrong: '#912121',
  errorMuted: '#f07575',

  // Info scale
  infoMuted: '#478eeb',
  info: '#1147bb',
  infoMedium: '#0f3ea3',
  infoStrong: '#0d358c',

  // Personality scale
  personalityLight: '#872fda',
  personality: '#6913b9',
  personalityAlt: '#4e0ce9',
  personalityAltStrong: '#511da5',

  // Accent
  accentPink: '#b91366',

  // UI behaviour
  tabInactive: '#6b7280',
  iconColor: '#475569',
  overlayBackground: 'rgba(0,0,0,0.60)',
  pressedBackground: 'rgba(0,0,0,0.08)', // = ghostStrong
  ripple: 'rgba(0,0,0,0.1)',
  shadowColor: '#000000',
  headerShadowColor: 'transparent',
  headerShadowRadius: 0,

  // Ghost tints — black base in light mode
  ghostMd: 'rgba(0,0,0,0.04)',
  ghostLight: 'rgba(0,0,0,0.06)',
  ghostStrong: 'rgba(0,0,0,0.08)',
  ghostHover: 'rgba(0,0,0,0.12)',
  ghostXL: 'rgba(0,0,0,0.20)',

  // Chart utilities
  subtleGridLine: 'rgba(0,0,0,0.05)',
  cursorLine: 'rgba(0,0,0,0.30)',
  inactiveSurface: 'rgba(0,0,0,0.04)',

  // Image scrim — always dark for photo legibility
  imageScrimColor: 'rgba(0,0,0,0.6)',
};
