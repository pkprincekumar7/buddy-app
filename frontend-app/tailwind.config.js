/** @type {import('tailwindcss').Config} */

/**
 * Tailwind (NativeWind v4) theme — generated from the same token files as
 * src/theme/index.ts, which are themselves generated from the web app's
 * frontend/src/index.css (`yarn theme:sync`). Nothing here is hand-typed:
 * change a color on the web, re-sync, and both platforms follow.
 *
 * Class names match the web's tailwind.config.ts one-for-one
 * (`bg-background`, `text-muted-foreground`, `bg-primary-action`,
 * `text-success-bright`, `bg-surface-elevated`, …) so web classNames port
 * verbatim. On top of that, every web `--x-rgb` channel token is exposed as a
 * plain color (`text-constellation-cyan`, `bg-whatsapp-bright/20`,
 * `border-pillar-mind`) — the RN stand-in for the web's
 * `text-[rgb(var(--constellation-cyan-rgb))]` arbitrary values, which
 * NativeWind cannot resolve. The web's `.border-edge*` / `.bg-ghost*` tint
 * utilities become `border-edge*` / `bg-ghost*` colors (pair the border ones
 * with a `border` width class).
 */
const web = require('./src/theme/tokens.generated.js');
const mobile = require('./src/theme/tokens.mobile.js');

const h = web.hsl;
const rgbTokens = { ...mobile.rgb, ...web.rgb };
const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;
const edge = a => `rgba(${rgbTokens.edge.join(',')},${a})`;

const channelColors = Object.fromEntries(
  Object.entries(rgbTokens)
    .filter(([name]) => name !== 'edge')
    .map(([name, c]) => [name, rgb(c)]),
);

module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        // Per-weight families — RN can't pick a weight inside a custom family.
        orbitron: ['Orbitron-Bold'],
        'orbitron-black': ['Orbitron-Black'],
        rajdhani: ['Rajdhani-Medium'],
        'rajdhani-semibold': ['Rajdhani-SemiBold'],
        'rajdhani-bold': ['Rajdhani-Bold'],
      },
      borderRadius: { lg: '12px', md: '10px', sm: '8px' },
      height: { 'btn-sm': '2.5rem', 'btn-md': '2.75rem', 'btn-lg': '3.25rem' },
      colors: {
        ...channelColors,
        background: h.background,
        foreground: h.foreground,
        card: { DEFAULT: h.card, foreground: h['card-foreground'] },
        popover: { DEFAULT: h.popover, foreground: h['popover-foreground'] },
        primary: {
          DEFAULT: h.primary,
          action: h['primary-action'],
          foreground: h['primary-foreground'],
          light: h['primary-light'],
          medium: h['primary-medium'],
          dark: h['primary-dark'],
          stronger: h['primary-stronger'],
          xstrong: h['primary-xstrong'],
          'bg-light': h['primary-bg-light'],
        },
        secondary: {
          DEFAULT: h.secondary,
          foreground: h['secondary-foreground'],
        },
        muted: { DEFAULT: h.muted, foreground: h['muted-foreground'] },
        accent: { DEFAULT: h.accent, foreground: h['accent-foreground'] },
        destructive: {
          DEFAULT: h.destructive,
          foreground: h['destructive-foreground'],
        },
        success: {
          DEFAULT: h.success,
          bright: h['success-bright'],
          light: h['success-light'],
          strong: h['success-strong'],
          xstrong: h['success-xstrong'],
          muted: h['success-muted'],
        },
        warning: {
          DEFAULT: h.warning,
          light: h['warning-light'],
          medium: h['warning-medium'],
          strong: h['warning-strong'],
          orange: h['warning-orange'],
          'orange-medium': h['warning-orange-medium'],
        },
        error: {
          DEFAULT: h.error,
          xlight: h['error-xlight'],
          light: h['error-light'],
          medium: h['error-medium'],
          strong: h['error-strong'],
          muted: h['error-muted'],
        },
        info: {
          DEFAULT: h.info,
          medium: h['info-medium'],
          strong: h['info-strong'],
          muted: h['info-muted'],
        },
        personality: {
          DEFAULT: h.personality,
          light: h['personality-light'],
          lighter: h['personality-lighter'],
          alt: h['personality-alt'],
          'alt-strong': h['personality-alt-strong'],
        },
        'accent-pink': h['accent-pink'],
        dim: h['dim-foreground'],
        subtle: h['subtle-foreground'],
        faint: h['faint-foreground'],
        xfaint: h['xfaint-foreground'],
        'surface-muted': h['surface-muted-bg'],
        'surface-dark': h['surface-dark'],
        border: h.border,
        input: h.input,
        ring: h.ring,
        overlay: h.overlay,
        chart: {
          1: h['chart-1'],
          2: h['chart-2'],
          3: h['chart-3'],
          4: h['chart-4'],
          5: h['chart-5'],
        },
        sidebar: {
          DEFAULT: h['sidebar-background'],
          foreground: h['sidebar-foreground'],
          primary: h['sidebar-primary'],
          'primary-foreground': h['sidebar-primary-foreground'],
          accent: h['sidebar-accent'],
          'accent-foreground': h['sidebar-accent-foreground'],
          border: h['sidebar-border'],
          ring: h['sidebar-ring'],
        },
        surface: { elevated: h['surface-elevated'], input: h['surface-input'] },
        section: { alt: h['section-alt'], dark: h['section-dark'] },
        'avatar-circle': {
          1: h['avatar-circle-1'],
          2: h['avatar-circle-2'],
          3: h['avatar-circle-3'],
          4: h['avatar-circle-4'],
          5: h['avatar-circle-5'],
          6: h['avatar-circle-6'],
        },
        badge: {
          1: h['badge-1-color'],
          2: h['badge-2-color'],
          3: h['badge-3-color'],
          4: h['badge-4-color'],
          5: h['badge-5-color'],
          6: h['badge-6-color'],
        },
        // Web .border-edge* (width 1px is NOT implied on RN — add `border`).
        edge: {
          DEFAULT: edge(0.08),
          xs: edge(0.04),
          faint: edge(0.06),
          md: edge(0.1),
          strong: edge(0.12),
          bright: edge(0.18),
        },
        // Web .bg-ghost* / .bg-subtle / .bg-na-dim tints.
        ghost: {
          DEFAULT: edge(0.02),
          md: edge(0.04),
          light: edge(0.06),
          strong: edge(0.08),
          hover: edge(0.12),
          xl: edge(0.2),
        },
        'subtle-tint': edge(0.05),
        'na-dim': edge(0.15),
      },
    },
  },
  plugins: [],
};
