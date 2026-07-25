export const THEME_KEY = 'buddy360_theme';

export function readStoredDarkMode(): boolean {
  return true;
}

export function applyTheme(_isDark: boolean): void {
  document.documentElement.classList.remove('light');
}
