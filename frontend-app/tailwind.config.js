/** @type {import('tailwindcss').Config} */

/**
 * Tailwind color tokens for NativeWind v4.
 *
 * NativeWind v4 on React Native cannot resolve CSS custom properties
 * (hsl(var(--x))) at runtime, so concrete hex values are used here.
 *
 * Values are derived from the web `frontend` app's CSS variables and match
 * the dark-mode palette in themeColors.ts (the app default).
 *
 * IMPORTANT — light-mode color switching:
 *   Tailwind className-based colors below are static (dark-mode defaults).
 *   For any color that must respond to the user's theme toggle, use
 *   `style={{ color: colors.xxx }}` via the `useTheme()` hook instead of a
 *   className token. Layout, spacing, and typography classes are unaffected.
 */

// Dark-mode hex values — keep in sync with darkColors in themeColors.ts
const dark = {
  // Surfaces
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
  foreground: '#fafafa',
  textMuted: '#94a3b8',
  dim: '#cbd5e1',
  subtle: '#65758b',
  faint: '#48566a',
  xfaint: '#344256',
  // Border
  border: '#262626',
  input: '#262626',
  inputBorder: '#262626',
  ring: '#3ee0cf',
  // Primary scale
  primaryBgLight: '#a5f3e1',
  primaryLight: '#73e2d4',
  primary: '#3ee0cf',
  primaryMedium: '#10b7a6',
  primaryAction: '#0d9688',
  primaryDark: '#0c887c',
  primaryStronger: '#0f756d',
  primaryXStrong: '#115f5a',
  primaryForeground: '#ffffff',
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
};

module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: dark.background,
        foreground: dark.foreground,

        card: {
          DEFAULT: dark.card,
          foreground: dark.foreground,
        },
        popover: {
          DEFAULT: dark.card,
          foreground: dark.foreground,
        },

        primary: {
          DEFAULT: dark.primary,
          foreground: dark.primaryForeground,
          'bg-light': dark.primaryBgLight,
          light: dark.primaryLight,
          medium: dark.primaryMedium,
          action: dark.primaryAction,
          dark: dark.primaryDark,
          stronger: dark.primaryStronger,
          xstrong: dark.primaryXStrong,
        },

        secondary: {
          DEFAULT: dark.surfaceInput,
          foreground: dark.foreground,
        },

        muted: {
          DEFAULT: dark.muted,
          foreground: dark.textMuted,
        },

        accent: {
          DEFAULT: dark.surfaceInput,
          foreground: dark.foreground,
        },

        destructive: {
          DEFAULT: dark.error,
          foreground: dark.foreground,
        },

        border: dark.border,
        input: dark.input,
        'input-border': dark.inputBorder,
        ring: dark.ring,

        surface: {
          elevated: dark.surfaceElevated,
          input: dark.surfaceInput,
          muted: dark.surfaceMuted,
          dark: dark.surfaceDark,
        },

        section: {
          alt: dark.sectionAlt,
          dark: dark.sectionDark,
        },

        // Text gradations
        dim: dark.dim,
        subtle: dark.subtle,
        faint: dark.faint,
        xfaint: dark.xfaint,

        // Semantic success scale
        success: {
          DEFAULT: dark.success,
          muted: dark.successMuted,
          light: dark.successLight,
          bright: dark.successBright,
          strong: dark.successStrong,
          xstrong: dark.successXStrong,
        },

        // Semantic warning scale
        warning: {
          DEFAULT: dark.warning,
          light: dark.warningLight,
          medium: dark.warningMedium,
          strong: dark.warningStrong,
          orange: dark.warningOrange,
          'orange-medium': dark.warningOrangeMedium,
        },

        // Semantic error scale
        error: {
          DEFAULT: dark.error,
          xlight: dark.errorXLight,
          light: dark.errorLight,
          medium: dark.errorMedium,
          strong: dark.errorStrong,
          muted: dark.errorMuted,
        },

        // Semantic info scale
        info: {
          DEFAULT: dark.info,
          muted: dark.infoMuted,
          medium: dark.infoMedium,
          strong: dark.infoStrong,
        },

        // Personality scale
        personality: {
          DEFAULT: dark.personality,
          light: dark.personalityLight,
          alt: dark.personalityAlt,
          'alt-strong': dark.personalityAltStrong,
        },

        // Accent
        'accent-pink': dark.accentPink,
      },
    },
  },
  plugins: [],
};
