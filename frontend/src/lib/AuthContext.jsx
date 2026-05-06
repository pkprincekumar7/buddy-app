import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';
import { pagesConfig } from '../pages.config';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [childProfiles, setChildProfiles] = useState([]);
  const [authError, setAuthError] = useState(null);

  const checkAppState = useCallback(async (options = {}) => {
    const withLoading = options.withLoading !== false;
    setAuthError(null);
    if (withLoading) {
      setIsLoadingAuth(true);
    }
    try {
      const hasSession = await api.auth.isAuthenticated();
      if (!hasSession) {
        setUser(null);
        setIsAuthenticated(false);
        return;
      }

      const currentUser = await api.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      const children = await api.entities.Child.list('-created_date');
      setChildProfiles(children);
    } catch (error) {
      console.error('Auth check failed:', error);
      const status = error?.status;
      if (status === 401) {
        api.auth.logout();
        setUser(null);
        setIsAuthenticated(false);
        setChildProfiles([]);
        setAuthError(null);
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setChildProfiles([]);
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

  const logout = useCallback(
    async (shouldRedirect = true) => {
      await api.auth.logout();
      setUser(null);
      setIsAuthenticated(false);
      setChildProfiles([]);
      setAuthError(null);
      if (shouldRedirect) {
        navigate('/Login', { replace: true });
      }
    },
    [navigate]
  );

  const navigateToLogin = useCallback(() => {
    logout(true);
  }, [logout]);

  const refreshChildren = useCallback(async () => {
    try {
      const children = await api.entities.Child.list('-created_date');
      setChildProfiles(children);
    } catch {
      /* keep current list */
    }
  }, []);

  const mainPath = createPageUrl(pagesConfig.mainPage || 'Home');

  useEffect(() => {
    if (isLoadingAuth) return;
    const publicPaths = ['/Login', '/Register'];
    if (!publicPaths.includes(location.pathname)) return;
    if (isAuthenticated) {
      navigate(mainPath, { replace: true });
    }
  }, [isLoadingAuth, isAuthenticated, location.pathname, navigate, mainPath]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        authError,
        childProfiles,
        refreshChildren,
        logout,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
