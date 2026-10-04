import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useLocation } from '@/lib/router';
import { toast } from '@/lib/toast';
import {
  api,
  AUTH_EXPIRED_EVENT,
  dispatchAuthExpired,
  resolveAuthExpiry,
} from '@/api/client';
import { ApiError } from '@/api/errors';
import { PUBLIC_AUTH_PATHS } from '@/lib/authPaths';
import type { UserRecord } from '@/types/api';

type UserData = UserRecord;

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
  logout: (shouldRedirect?: boolean) => Promise<void>;
  checkAppState: (options?: { withLoading?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BLOCKED_REDIRECT_PATHS: readonly string[] = PUBLIC_AUTH_PATHS;

/**
 * Same session logic as the web AuthContext. Navigation differs on purpose:
 * the web navigates to /Login or /Home when auth state changes; here the
 * root navigator renders a different screen set for each auth state (see
 * src/navigation/index.tsx), so flipping `isAuthenticated` IS the redirect.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<AuthErrorValue | null>(null);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const checkAppState = useCallback(
    async (options: { withLoading?: boolean } = {}) => {
      const withLoading = options.withLoading !== false;
      setAuthError(null);
      if (withLoading) {
        setIsLoadingAuth(true);
      }
      try {
        const currentUser = await api.auth.me();
        setUser(currentUser);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Auth check failed:', error);
        if (error instanceof ApiError && error.status === 401) {
          void api.auth.logout();
          setUser(null);
          setIsAuthenticated(false);
          setAuthError(null);
        } else {
          setUser(null);
          setIsAuthenticated(false);
          const msg =
            (error as Error)?.message ??
            'Service temporarily unavailable. Please try again later.';
          setAuthError({ type: 'unknown', message: msg });
        }
      } finally {
        if (withLoading) {
          setIsLoadingAuth(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void checkAppState();
  }, [checkAppState]);

  useEffect(() => {
    const onExpired = (detail: unknown) => {
      // Session expiry is silent (expected/routine); a locked account carries
      // a specific reason (see client.ts's request()) worth surfacing.
      const rawMessage =
        detail && typeof detail === 'object'
          ? (detail as { message?: unknown }).message
          : undefined;
      const message = typeof rawMessage === 'string' ? rawMessage : null;
      if (message && message !== 'Session expired') {
        toast.error(message);
      }
      void api.auth.logout().catch(() => {});
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(null);
    };
    const sub = DeviceEventEmitter.addListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => sub.remove();
  }, []);

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
            if (
              err instanceof ApiError &&
              (err.status === 401 || err.status === 403)
            ) {
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
      if (silentRefreshTimerRef.current)
        clearTimeout(silentRefreshTimerRef.current);
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

  // `shouldRedirect` is kept for API parity with the web; the redirect to
  // Login happens implicitly when isAuthenticated flips to false.
  const logout = useCallback(async (_shouldRedirect = true) => {
    await api.auth.logout();
    // Also drop the native Google session so the account picker shows next time.
    await GoogleSignin.signOut().catch(() => {});
    setUser(null);
    setIsAuthenticated(false);
    setAuthError(null);
  }, []);

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

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
