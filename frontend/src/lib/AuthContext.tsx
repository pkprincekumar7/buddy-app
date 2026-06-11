import {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import { createPageUrl } from '@/utils';
import { pagesConfig } from '@/pages.config';
import { PUBLIC_AUTH_PATHS } from '@/lib/authPaths';
import { applyTheme } from '@/lib/theme';
import type { UserRecord, ChildRecord } from '@/types/api';

type UserData = UserRecord;
type ChildProfile = ChildRecord;

interface AuthErrorUnknown {
  type: 'unknown';
  message: string;
}

interface AuthErrorUserNotRegistered {
  type: 'user_not_registered';
}

type AuthErrorValue = AuthErrorUnknown | AuthErrorUserNotRegistered;

interface AuthContextValue {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  authError: AuthErrorValue | null;
  childProfiles: ChildProfile[];
  refreshChildren: () => Promise<void>;
  logout: (shouldRedirect?: boolean) => Promise<void>;
  navigateToLogin: () => void;
  checkAppState: (options?: { withLoading?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BLOCKED_REDIRECT_PATHS: readonly string[] = PUBLIC_AUTH_PATHS;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [authError, setAuthError] = useState<AuthErrorValue | null>(null);
  const [lastVisitedPath, setLastVisitedPath] = useState<string | null>(null);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAppState = useCallback(async (options: { withLoading?: boolean } = {}) => {
    const withLoading = options.withLoading !== false;
    setAuthError(null);
    if (withLoading) {
      setIsLoadingAuth(true);
    }
    try {
      const currentUser = await api.auth.me();
      const [children, prefs] = await Promise.all([
        api.entities.Child.list('-created_date'),
        api.preferences.get(),
      ]);
      setUser(currentUser);
      setChildProfiles(children);
      setLastVisitedPath(
        typeof prefs.last_visited_path === 'string' ? prefs.last_visited_path : null,
      );
      // Sync DB dark_mode → localStorage + <html> class so ALL pages (including
      // Login/Register) pick up the correct theme on next load via the inline script.
      if (typeof prefs.dark_mode === 'boolean') {
        applyTheme(prefs.dark_mode);
      }
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Auth check failed:', error);
      if (error instanceof ApiError && error.status === 401) {
        void api.auth.logout();
        setUser(null);
        setIsAuthenticated(false);
        setChildProfiles([]);
        setLastVisitedPath(null);
        setAuthError(null);
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setChildProfiles([]);
        setLastVisitedPath(null);
        const msg =
          (error as Error)?.message ?? 'Service temporarily unavailable. Please try again later.';
        setAuthError({ type: 'unknown', message: msg });
      }
    } finally {
      if (withLoading) {
        setIsLoadingAuth(false);
      }
    }
  }, []);

  useEffect(() => {
    void checkAppState();
  }, [checkAppState]);

  useEffect(() => {
    const onExpired = () => {
      void api.auth.logout().catch(() => {});
      setUser(null);
      setIsAuthenticated(false);
      setChildProfiles([]);
      setAuthError(null);
      navigate('/Login', { replace: true });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('buddy360:auth-expired', onExpired);
      return () => window.removeEventListener('buddy360:auth-expired', onExpired);
    }
    return undefined;
  }, [navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const ACCESS_LIFETIME_MS = 30 * 60 * 1000;
    const BUFFER_MS = 60 * 1000;

    const schedule = () => {
      silentRefreshTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            await api.auth.silentRefresh();
            schedule();
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
              window.dispatchEvent(new CustomEvent('buddy360:auth-expired'));
            } else {
              silentRefreshTimerRef.current = setTimeout(schedule, 30_000);
            }
          }
        })();
      }, ACCESS_LIFETIME_MS - BUFFER_MS);
    };

    schedule();

    return () => {
      if (silentRefreshTimerRef.current) clearTimeout(silentRefreshTimerRef.current);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setTimeout(() => {
      if (BLOCKED_REDIRECT_PATHS.includes(location.pathname)) return;
      api.preferences
        .patch({ last_visited_path: location.pathname + location.search })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [location.pathname, location.search, isAuthenticated]);

  const logout = useCallback(
    async (shouldRedirect = true) => {
      await api.auth.logout();
      setUser(null);
      setIsAuthenticated(false);
      setChildProfiles([]);
      setLastVisitedPath(null);
      setAuthError(null);
      if (shouldRedirect) {
        navigate('/Login', { replace: true });
      }
    },
    [navigate],
  );

  const navigateToLogin = useCallback(() => {
    void logout(true);
  }, [logout]);

  const refreshChildren = useCallback(async () => {
    try {
      const children = await api.entities.Child.list('-created_date');
      setChildProfiles(children);
    } catch (err) {
      console.warn('[AuthContext] Could not refresh children list:', err);
    }
  }, []);

  const mainPath = createPageUrl(pagesConfig.mainPage ?? 'Home');

  useEffect(() => {
    if (isLoadingAuth) return;
    const publicPaths = ['/Login', '/Register'];
    if (!publicPaths.includes(location.pathname)) return;
    if (isAuthenticated) {
      const destination =
        lastVisitedPath &&
        lastVisitedPath.startsWith('/') &&
        !BLOCKED_REDIRECT_PATHS.includes(lastVisitedPath)
          ? lastVisitedPath
          : mainPath;
      navigate(destination, { replace: true });
    }
  }, [isLoadingAuth, isAuthenticated, location.pathname, navigate, mainPath, lastVisitedPath]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      childProfiles,
      refreshChildren,
      logout,
      navigateToLogin,
      checkAppState,
    }),
    [
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      childProfiles,
      refreshChildren,
      logout,
      navigateToLogin,
      checkAppState,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
