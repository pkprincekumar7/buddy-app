/**
 * ThemeContext — global dark/light mode state for the React Native app.
 *
 * - Loads `dark_mode` from the /user/preferences API once the user is
 *   authenticated (mirrors the isAuthenticated gate in web Layout.tsx).
 * - Re-fetches whenever `isAuthenticated` changes so a fresh login always
 *   picks up the saved preference.
 * - Exposes `colors` (resolved AppColors) and `toggle()` — components never
 *   need to branch on `isDark` for styling; they just use `colors.xxx`.
 * - `isDark` is also exposed for the rare structural case that needs a boolean
 *   (e.g. selecting the NavigationContainer theme object).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { darkColors, lightColors, type AppColors } from './themeColors';

interface ThemeContextValue {
  isDark: boolean;
  colors: AppColors;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: true,
  colors: darkColors,
  toggle: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isDark, setIsDark] = useState(true); // default dark — matches backend default
  const isDarkRef = useRef(true);

  // Re-fetch whenever the user logs in (or switches accounts).
  // When not authenticated, skip the API call and stay on the default.
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    void (async () => {
      try {
        const prefs = (await api.preferences.get()) as { dark_mode?: boolean };
        if (!cancelled && typeof prefs?.dark_mode === 'boolean') {
          isDarkRef.current = prefs.dark_mode;
          setIsDark(prefs.dark_mode);
        }
      } catch {
        // ignore — keep current value
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const toggle = useCallback(() => {
    const next = !isDarkRef.current;
    isDarkRef.current = next;
    setIsDark(next);
    void api.preferences.patch({ dark_mode: next }).catch(err => {
      console.warn('[ThemeContext] Could not persist theme toggle:', err);
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{ isDark, colors: isDark ? darkColors : lightColors, toggle }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
