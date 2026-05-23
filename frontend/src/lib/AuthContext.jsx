import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';
import { pagesConfig } from '../pages.config';

const AuthContext = createContext(/** @type {any} */ (null));

const BLOCKED_REDIRECT_PATHS = ['/Login', '/Register'];

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [childProfiles, setChildProfiles] = useState([]);
  const [authError, setAuthError] = useState(null);
  const [lastVisitedPath, setLastVisitedPath] = useState(null);
  const silentRefreshTimerRef = useRef(null);

  const checkAppState = useCallback(async (options = {}) => {
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
      setLastVisitedPath(prefs?.last_visited_path || null);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Auth check failed:', error);
      const status = error?.status;
      if (status === 401) {
        api.auth.logout();
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
          error?.message ||
          'Backend unavailable. Run the API (backend) and ensure Vite proxies /api to it, or set VITE_API_URL.';
        setAuthError({ type: 'unknown', message: msg });
      }
    } finally {
      if (withLoading) {
        setIsLoadingAuth(false);
      }
    }
  }, []);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  useEffect(() => {
    const onExpired = () => {
      api.auth.logout().catch(() => {});
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

  // Proactive silent refresh: fires 60 s before the 30-min access token expires
  // so the session stays alive as long as the refresh token (24 h) is valid.
  useEffect(() => {
    if (!isAuthenticated) return;

    const ACCESS_LIFETIME_MS = 30 * 60 * 1000;
    const BUFFER_MS = 60 * 1000;

    const schedule = () => {
      silentRefreshTimerRef.current = setTimeout(async () => {
        try {
          await api.auth.silentRefresh();
          schedule();
        } catch (err) {
          if (err?.status === 401) {
            window.dispatchEvent(new CustomEvent('buddy360:auth-expired'));
          } else {
            // Network/server hiccup — retry in 30 s
            silentRefreshTimerRef.current = setTimeout(schedule, 30_000);
          }
        }
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
      api.preferences.patch({ last_visited_path: location.pathname + location.search }).catch(() => {});
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
    logout(true);
  }, [logout]);

  const refreshChildren = useCallback(async () => {
    try {
      const children = await api.entities.Child.list('-created_date');
      setChildProfiles(children);
    } catch (err) {
      console.warn('[AuthContext] Could not refresh children list:', err);
    }
  }, []);

  const mainPath = createPageUrl(pagesConfig.mainPage || 'Home');

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

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
