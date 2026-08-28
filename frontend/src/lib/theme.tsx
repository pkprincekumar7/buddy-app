import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Theme system — currently locked to dark only, on purpose.
 *
 * index.css only defines the dark palette right now (see the "CENTRALIZED
 * THEME TOKENS" block there); no `.light` variable-override block exists yet
 * because the light-mode colors haven't been finalised by design. This
 * provider exists so the plumbing for a future toggle is real and wired, but
 * `forcedTheme="dark"` keeps next-themes from ever switching away from dark,
 * and nothing in the app calls `setTheme()` — so no user can reach a light
 * mode that doesn't visually exist yet.
 *
 * next-themes applies the theme by putting its literal name in a class on
 * <html> (attribute="class", no custom `value` map — a `value` mapping any
 * theme to '' makes next-themes call `classList.remove('')` internally,
 * which throws `SyntaxError: The token provided must not be empty` in every
 * browser, so don't add one). `class="dark"` is therefore present but inert:
 * index.css's dark palette lives in the unclassed `:root` default, not a
 * `.dark` selector, so the class does nothing today. Turning theming on
 * later is a two-step change, not a rewrite:
 *   1. Add a `.light { ... }` override block to index.css (next-themes will
 *      apply `class="light"` for that theme, matching that selector as-is).
 *   2. Remove `forcedTheme="dark"` below and add a UI control that calls
 *      `setTheme('light' | 'dark')` from next-themes' own `useTheme()`
 *      (imported directly — not re-exported here, since a hook export next
 *      to a component export in the same file breaks React Fast Refresh).
 */
const THEME_STORAGE_KEY = 'buddy360-theme';

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
