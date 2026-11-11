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
import { useNavigate, useLocation } from 'react-router';
import { toast } from 'sonner';
import { account, type CurrentUser } from '@/api/account';
import { api, dispatchAuthExpired, resolveAuthExpiry } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryClientInstance } from '@/lib/query-client';
import { createPageUrl } from '@/utils';
import { pagesConfig } from '@/pages.config';
type UserData = CurrentUser;

interface AuthErrorValue {
  type: 'unknown';
  message: string;
}

interface AuthContextValue {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  authError: AuthErrorValue | null;
  logout: (shouldRedirect?: boolean) => Promise<void>;
  checkAppState: (options?: { withLoading?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<AuthErrorValue | null>(null);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The account the query cache was filled for: keys like ['children'] aren't per-user,
  // so the cache is cleared whenever that account changes or signs out.
  const cachedUserIdRef = useRef<string | null>(null);

  const clearUserCache = useCallback(() => {
    cachedUserIdRef.current = null;
    queryClientInstance.clear();
  }, []);

  const checkAppState = useCallback(
    async (options: { withLoading?: boolean } = {}) => {
      const withLoading = options.withLoading !== false;
      setAuthError(null);
      if (withLoading) {
        setIsLoadingAuth(true);
      }
      try {
        const currentUser = await account.current();
        if (cachedUserIdRef.current !== null && cachedUserIdRef.current !== currentUser.id) {
          queryClientInstance.clear();
        }
        cachedUserIdRef.current = currentUser.id;
        setUser(currentUser);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Auth check failed:', error);
        if (error instanceof ApiError && error.status === 401) {
          void account.logout();
          clearUserCache();
          setUser(null);
          setIsAuthenticated(false);
          setAuthError(null);
        } else {
          setUser(null);
          setIsAuthenticated(false);
          const msg =
            (error as Error)?.message ?? 'Service temporarily unavailable. Please try again later.';
          setAuthError({ type: 'unknown', message: msg });
        }
      } finally {
        if (withLoading) {
          setIsLoadingAuth(false);
        }
      }
    },
    [clearUserCache],
  );

  useEffect(() => {
    void checkAppState();
  }, [checkAppState]);

  useEffect(() => {
    const onExpired = (event: Event) => {
      // Session expiry is silent (expected/routine); a locked account carries
      // a specific reason (see client.ts's request()) worth surfacing.
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      const rawMessage =
        detail && typeof detail === 'object'
          ? (detail as { message?: unknown }).message
          : undefined;
      const message = typeof rawMessage === 'string' ? rawMessage : null;
      if (message && message !== 'Session expired') {
        toast.error(message);
      }
      void account.logout();
      clearUserCache();
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(null);
      void navigate('/Login', { replace: true });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('superpower:auth-expired', onExpired);
      return () => window.removeEventListener('superpower:auth-expired', onExpired);
    }
    return undefined;
  }, [navigate, clearUserCache]);

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
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
              const { status, message } = resolveAuthExpiry(err);
              dispatchAuthExpired(status, message);
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

  const logout = useCallback(
    async (shouldRedirect = true) => {
      await account.logout();
      clearUserCache();
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(null);
      if (shouldRedirect) {
        void navigate('/Login', { replace: true });
      }
    },
    [navigate, clearUserCache],
  );

  const mainPath = createPageUrl(pagesConfig.mainPage ?? 'Home');

  useEffect(() => {
    if (isLoadingAuth) return;
    const publicPaths = ['/Login', '/Register'];
    if (!publicPaths.includes(location.pathname)) return;
    if (isAuthenticated) {
      if (user?.role === 'admin') {
        void navigate('/Admin', { replace: true });
        return;
      }
      void navigate(mainPath, { replace: true });
    }
  }, [isLoadingAuth, isAuthenticated, user?.role, location.pathname, navigate, mainPath]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      logout,
      checkAppState,
    }),
    [user, isAuthenticated, isLoadingAuth, authError, logout, checkAppState],
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
