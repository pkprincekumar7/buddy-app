/**
 * Shared theme helpers.
 *
 * Single source of truth for reading/writing the theme preference
 * so localStorage, the inline script in index.html, AuthContext,
 * and Layout.tsx all stay in sync.
 *
 * Key: 'buddy360_theme'  Values: 'dark' | 'light'
 */

export const THEME_KEY = 'buddy360_theme';

/** Read the stored preference; fall back to OS preference, then dark. */
export function readStoredDarkMode(): boolean {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) return stored !== 'light';
  } catch {
    /* localStorage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

/** Persist the preference to localStorage and apply the class to <html>. */
export function applyTheme(isDark: boolean): void {
  try {
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
  if (isDark) {
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.add('light');
  }
}
