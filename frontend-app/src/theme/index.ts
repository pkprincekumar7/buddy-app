/**
 * Theme — the mobile app's single entry point for every color, font, glow and
 * gradient. Mirrors the web app's centralized tokens (frontend/src/index.css)
 * one-for-one; the values themselves live in `tokens.generated.js`, which is
 * regenerated from the web CSS by `yarn theme:sync`.
 *
 * Never hardcode a hex/rgba value in a component. Use, in order of preference:
 *
 *   1. A NativeWind className — the Tailwind config exposes the same names as
 *      the web (`bg-background`, `text-muted-foreground`, `bg-primary-action`,
 *      `border-border`, `bg-surface-elevated`, …) plus the palettes the web
 *      reaches through `rgb(var(--x-rgb))` (`text-constellation-cyan`,
 *      `bg-whatsapp-bright/20`, …) and the edge/ghost tints (`border-edge`).
 *   2. `color.x` (semantic hsl token as hex) for props that take a color
 *      (icon `color`, `placeholderTextColor`, SVG `fill`/`stroke`).
 *   3. `rgb('constellation-cyan', 0.7)` / `hsl('primary', 0.2)` for a token at
 *      a given alpha — the RN equivalent of the web's
 *      `rgb(var(--constellation-cyan-rgb) / .7)` / `hsl(var(--primary) / .2)`.
 *   4. `css('…')` to port a web gradient/shadow string verbatim: every
 *      `rgb(var(--x-rgb) / a)` and `hsl(var(--x) / a)` inside it is resolved
 *      to a concrete rgba, so `css('0 0 16px rgb(var(--constellation-cyan-rgb) / .7)')`
 *      can go straight into `boxShadow`, and a `linear-gradient(...)` /
 *      `radial-gradient(...)` straight into `experimental_backgroundImage`.
 *
 * The app is dark-only, exactly like the web (`forcedTheme="dark"`). There is
 * no light palette yet, so there is no toggle — see web src/lib/theme.tsx.
 */
import type { TextStyle, ViewStyle } from 'react-native';

type Tokens = {
  hsl: Record<string, string>;
  rgb: Record<string, [number, number, number]>;
  raw: Record<string, string>;
};
// CommonJS token files (tailwind.config.js require()s the same files at build time).
const web = require('./tokens.generated') as Tokens;
const mobile = require('./tokens.mobile') as Pick<Tokens, 'rgb'>;
const t: Tokens = { ...web, rgb: { ...mobile.rgb, ...web.rgb } };

/** Semantic tokens (web `hsl(var(--name))`) resolved to hex — `color.primary`, `color['muted-foreground']`. */
export const color = t.hsl as Readonly<Record<HslToken, string>>;
/** RGB channel tokens (web `--name-rgb`) — `channels['constellation-cyan']` → [75, 233, 255]. */
export const channels = t.rgb as Readonly<
  Record<RgbToken, readonly [number, number, number]>
>;
/** Raw (non-HSL) tokens: avatar art colors, deep-navy stops, radius. */
export const raw = t.raw as Readonly<Record<RawToken, string>>;

export type HslToken =
  | 'background'
  | 'foreground'
  | 'card'
  | 'card-foreground'
  | 'popover'
  | 'popover-foreground'
  | 'primary'
  | 'primary-action'
  | 'primary-foreground'
  | 'secondary'
  | 'secondary-foreground'
  | 'muted'
  | 'muted-foreground'
  | 'accent'
  | 'accent-foreground'
  | 'destructive'
  | 'destructive-foreground'
  | 'border'
  | 'input'
  | 'ring'
  | 'sidebar-background'
  | 'sidebar-foreground'
  | 'surface-elevated'
  | 'surface-input'
  | 'section-alt'
  | 'section-dark'
  | 'primary-light'
  | 'primary-medium'
  | 'primary-dark'
  | 'primary-stronger'
  | 'primary-xstrong'
  | 'primary-bg-light'
  | 'success'
  | 'success-bright'
  | 'success-light'
  | 'success-strong'
  | 'success-xstrong'
  | 'success-muted'
  | 'warning-light'
  | 'warning'
  | 'warning-medium'
  | 'warning-strong'
  | 'warning-orange'
  | 'warning-orange-medium'
  | 'error'
  | 'error-xlight'
  | 'error-light'
  | 'error-medium'
  | 'error-strong'
  | 'error-muted'
  | 'info'
  | 'info-medium'
  | 'info-strong'
  | 'info-muted'
  | 'personality-light'
  | 'personality'
  | 'personality-alt'
  | 'personality-alt-strong'
  | 'personality-lighter'
  | 'accent-pink'
  | 'dim-foreground'
  | 'subtle-foreground'
  | 'faint-foreground'
  | 'xfaint-foreground'
  | 'surface-muted-bg'
  | 'surface-dark'
  | 'overlay'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | `avatar-circle-${1 | 2 | 3 | 4 | 5 | 6}`
  | `badge-${1 | 2 | 3 | 4 | 5 | 6}-color`
  | (string & {});

export type RgbToken = string;
export type RawToken = string;

function hexToChannels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map(c => c + c)
          .join('')
      : h;
  const n = parseInt(full, 16);
  // eslint-disable-next-line no-bitwise -- unpacking hex channels
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(
  [r, g, b]: readonly [number, number, number],
  alpha?: number,
): string {
  return alpha === undefined
    ? `rgb(${r},${g},${b})`
    : `rgba(${r},${g},${b},${alpha})`;
}

/** Web `rgb(var(--name-rgb) / alpha)`. `name` omits the `-rgb` suffix. */
export function rgb(name: RgbToken, alpha?: number): string {
  const c = channels[name];
  if (!c) {
    if (__DEV__) console.warn(`[theme] unknown rgb token "${name}"`);
    return 'transparent';
  }
  return rgba(c, alpha);
}

/** Web `hsl(var(--name) / alpha)` — a semantic token at the given alpha. */
export function hsl(name: HslToken, alpha?: number): string {
  const v = color[name];
  if (!v) {
    if (__DEV__) console.warn(`[theme] unknown hsl token "${name}"`);
    return 'transparent';
  }
  if (alpha === undefined || !v.startsWith('#')) return v;
  return rgba(hexToChannels(v), alpha);
}

/** Any hex (e.g. a data-driven `hue` from lib data) at the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  return rgba(hexToChannels(hex), alpha);
}

/** White (dark theme) tint at `alpha` — web `rgb(var(--edge-rgb) / alpha)`. */
export function edge(alpha: number): string {
  return rgb('edge', alpha);
}

const VAR_RE =
  /(rgb|hsl)a?\(\s*var\(--([a-z0-9-]+?)(-rgb)?\)\s*(?:\/\s*([\d.]+%?))?\s*\)|var\(--([a-z0-9-]+)\)/gi;

/**
 * Resolves a web CSS value that references theme variables into a concrete
 * React Native style string. Handles `rgb(var(--x-rgb) / a)`, `hsl(var(--x) / a)`
 * and bare `var(--bg-deep-1)`-style raw tokens. Use for gradients
 * (`experimental_backgroundImage`) and shadows (`boxShadow`) ported from web.
 */
export function css(value: string): string {
  return value.replace(VAR_RE, (_m, fn, name, rgbSuffix, alphaStr, bare) => {
    if (bare) return raw[bare] ?? color[bare] ?? 'transparent';
    const a =
      alphaStr === undefined
        ? undefined
        : alphaStr.endsWith('%')
        ? parseFloat(alphaStr) / 100
        : parseFloat(alphaStr);
    if (String(fn).toLowerCase() === 'rgb' && rgbSuffix) return rgb(name, a);
    return hsl(name, a);
  });
}

// ─── Typography ──────────────────────────────────────────────────────────────
// React Native resolves a custom font by its exact per-weight family name, so
// each web `font-family + font-weight` pair maps to one family here. Never
// combine these with `fontWeight` — Android would synthesise a fake bold.
// Barlow has no @font-face on the web either (it falls back to the system
// sans), so it is intentionally absent here.
export const fonts = {
  orbitron: 'Orbitron-Bold', // font-orbitron / fontWeight 700-800
  orbitronBlack: 'Orbitron-Black', // font-orbitron + font-black / fontWeight 900
  rajdhani: 'Rajdhani-Medium', // font-rajdhani / fontWeight 500
  rajdhaniSemibold: 'Rajdhani-SemiBold', // fontWeight 600
  rajdhaniBold: 'Rajdhani-Bold', // fontWeight 700+
} as const;

/** Picks the right font family for a web `fontFamily` + `fontWeight` pair. */
export function font(
  family: 'orbitron' | 'rajdhani',
  weight: number = 700,
): TextStyle {
  if (family === 'orbitron') {
    return { fontFamily: weight >= 900 ? fonts.orbitronBlack : fonts.orbitron };
  }
  if (weight >= 700) return { fontFamily: fonts.rajdhaniBold };
  if (weight >= 600) return { fontFamily: fonts.rajdhaniSemibold };
  return { fontFamily: fonts.rajdhani };
}

/** Web `--radius` (0.75rem) and its Tailwind lg/md/sm derivatives, in px. */
export const radius = { lg: 12, md: 10, sm: 8 } as const;

// ─── Glows (web @layer utilities .glow-*) ────────────────────────────────────
export const glow = {
  teal: css(
    '0 0 20px rgb(var(--glow-primary-rgb) / 0.15), 0 0 40px rgb(var(--glow-primary-rgb) / 0.05)',
  ),
  tealSm: css('0 0 12px rgb(var(--glow-primary-rgb) / 0.2)'),
  tealMd: css('0 0 28px rgb(var(--glow-primary-rgb) / 0.2)'),
  tealLg: css('0 0 48px rgb(var(--glow-primary-rgb) / 0.3)'),
  tealBtn: css('0 0 16px rgb(var(--glow-primary-rgb) / 0.3)'),
  tealIcon: css('0 0 32px rgb(var(--glow-primary-rgb) / 0.4)'),
  amber: css('0 0 20px rgb(var(--glow-warning-rgb) / 0.15)'),
  personality: css('0 0 28px rgb(var(--glow-personality-rgb) / 0.2)'),
  personalityLg: css('0 0 40px rgb(var(--glow-personality-rgb) / 0.3)'),
  /** `.glow-pillar` — pass the element's own glow color. */
  pillar: (c: string) => `0 0 20px ${c}`,
} as const;

// ─── Gradients (web @layer components) ───────────────────────────────────────
// Each is a ready `experimental_backgroundImage` value.
export const gradient = {
  orbCyan: css(
    'radial-gradient(circle at 35% 30%, rgb(var(--constellation-cyan-pale-rgb)), rgb(var(--constellation-cyan-rgb)) 45%, rgb(var(--constellation-cyan-deep-rgb)) 100%)',
  ),
  btnPrimary: css(
    'linear-gradient(to right, hsl(var(--primary-medium)), hsl(var(--primary)))',
  ),
  deepNavy: css(
    'linear-gradient(to bottom right, var(--bg-deep-1), var(--bg-deep-2), var(--bg-deep-3))',
  ),
  imageScrim: css(
    'linear-gradient(to top, rgb(var(--image-scrim-rgb) / 0.6), transparent)',
  ),
  chatBarPanel: css(
    'linear-gradient(to top, rgb(var(--chatbar-glow-rgb) / 0.65), rgb(var(--chatbar-glow-rgb) / 0.18), transparent)',
  ),
  onboardingIntroVeil: css(
    'linear-gradient(180deg, rgb(var(--onboarding-veil-rgb) / 0.1) 0%, rgb(var(--onboarding-veil-rgb) / 0.3) 55%, rgb(var(--onboarding-veil-rgb) / 0.88) 100%)',
  ),
  onboardingBgGlow: css(
    'radial-gradient(ellipse 80% 60% at 50% 100%, rgb(var(--chatbar-glow-rgb) / 0.18), transparent)',
  ),
  orbAmbient: css(
    'radial-gradient(circle, rgb(var(--chatbar-glow-rgb) / 0.22) 0%, transparent 70%)',
  ),
  orbMain: css(
    'radial-gradient(circle at 75% 30%, rgb(var(--orb-cyan-rgb)) 0%, rgb(var(--orb-blue-rgb)) 18%, transparent 35%), radial-gradient(circle at 35% 70%, rgb(var(--orb-purple-rgb)) 0%, transparent 35%), radial-gradient(circle at center, rgb(var(--orb-dark-rgb)) 35%, var(--bg-deep-3) 100%)',
  ),
} as const;

// ─── Shared surface recipes (web @layer components classes) ──────────────────
// Prefer the NativeWind className equivalents where noted; these style objects
// exist for components that can't take className (Animated/SVG wrappers) and
// for the few recipes with a shadow or gradient that className can't express.
export const recipe = {
  /** `.card-surface` → className `rounded-2xl border border-edge bg-card p-6`. */
  cardSurface: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: edge(0.08),
    backgroundColor: color.card,
    padding: 24,
  } satisfies ViewStyle,
  /** `.form-input` → className `w-full rounded-lg border border-edge-md bg-surface-input px-3 py-2 text-foreground`. */
  formInput: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: edge(0.1),
    backgroundColor: color['surface-input'],
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: color.foreground,
  } satisfies TextStyle,
  /** `.btn-primary` — gradient teal CTA with the teal glow. */
  btnPrimary: {
    experimental_backgroundImage: gradient.btnPrimary,
    boxShadow: glow.teal,
  } satisfies ViewStyle,
  /** `.btn-secondary` → className `border border-edge-strong bg-transparent`. */
  btnSecondary: {
    borderWidth: 1,
    borderColor: edge(0.12),
    backgroundColor: 'transparent',
  } satisfies ViewStyle,
  /** `.btn-start-over` → className `border border-warning-medium/30 bg-transparent`. */
  btnStartOver: {
    borderWidth: 1,
    borderColor: hsl('warning-medium', 0.3),
    backgroundColor: 'transparent',
  } satisfies ViewStyle,
  /** `.chat-input-bar` — glass pill (no backdrop-filter on RN; tint is raised to compensate). */
  chatInputBar: {
    backgroundColor: edge(0.12),
    borderWidth: 1,
    borderColor: edge(0.15),
    boxShadow: css(
      'inset 0 1px 1px rgb(var(--edge-rgb) / 0.14), 0 15px 50px rgb(var(--chatbar-glow-rgb) / 0.18)',
    ),
  } satisfies ViewStyle,
  /** `.onboarding-input-pill`. */
  onboardingInputPill: {
    backgroundColor: rgb('onboarding-pill', 0.88),
    boxShadow: css(
      '0 0 40px rgb(var(--chatbar-glow-rgb) / 0.1), inset 0 1px 0 rgb(var(--edge-rgb) / 0.05)',
    ),
  } satisfies ViewStyle,
  /** `.onboarding-intro-text-shadow`. */
  onboardingIntroTextShadow: {
    textShadowColor: rgb('image-scrim', 0.6),
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 18,
  } satisfies TextStyle,
  /** `.orb-ring`. */
  orbRing: {
    borderWidth: 2,
    borderColor: rgb('orb-ring', 0.5),
    borderRadius: 9999,
  } satisfies ViewStyle,
} as const;

/**
 * Room for a glowing text shadow — the RN stand-in for the web's unclipped
 * `text-shadow: 0 0 Npx`. iOS clips a Text's shadow at the Text's own frame,
 * so a large `textShadowRadius` shows as a faint rectangle at the text edges.
 * Spread this into the Text's style (block-level Text only, not a nested span):
 * the padding gives the blur room inside the frame, and the equal negative
 * margin keeps the layout exactly where it was.
 */
export function textGlowRoom(radius: number): TextStyle {
  return { padding: radius, margin: -radius };
}

/** Backdrop for modals/sheets — web `.bg-overlay` / `.modal-overlay`. */
export const overlay = color.overlay;
