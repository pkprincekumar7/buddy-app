import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryClientInstance } from '@/lib/query-client';
import type { UserRecord, ChildRecord } from '@/types/api';

const ACTIVE_CHILD_KEY = 'buddy360:activeChildId';

interface AuthErrorUnknown {
  type: 'unknown';
  message: string;
}

interface AuthErrorUserNotRegistered {
  type: 'user_not_registered';
}

export type AuthErrorValue = AuthErrorUnknown | AuthErrorUserNotRegistered;

interface AuthContextValue {
  user: UserRecord | null;
  children: ChildRecord[];
  activeChild: ChildRecord | null;
  activeChildId: string | undefined;
  setActiveChildId: (id: string) => void;
  clearActiveChildId: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: AuthErrorValue | null;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
  refetchChildren: () => Promise<void>;
  checkAppState: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children: node }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [childList, setChildList] = useState<ChildRecord[]>([]);
  const [activeChildId, _setActiveChildId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<AuthErrorValue | null>(null);

  const setActiveChildId = useCallback((id: string) => {
    _setActiveChildId(id);
    AsyncStorage.setItem(ACTIVE_CHILD_KEY, id).catch(() => {});
  }, []);

  const clearActiveChildId = useCallback(async () => {
    _setActiveChildId(undefined);
    await AsyncStorage.removeItem(ACTIVE_CHILD_KEY).catch(() => {});
  }, []);

  const refetchUser = useCallback(async () => {
    try {
      const u = await api.auth.me();
      setUser(u);
    } catch (e) {
      setUser(null);
      throw e;
    }
  }, []);

  const refetchChildren = useCallback(async () => {
    try {
      const list = await api.entities.Child.list();
      setChildList(list);
      // Keep React Query cache in sync so screens using useQuery(['children'])
      // (e.g. HomeScreen) always see the same data without an extra network call.
      queryClientInstance.setQueryData(['children'], list);
      if (list.length > 0) {
        const stored = await AsyncStorage.getItem(ACTIVE_CHILD_KEY).catch(
          () => null,
        );
        const valid = stored && list.some(c => c.id === stored);
        if (!valid) setActiveChildId(list[0].id);
      } else {
        // No children — clear any stale activeChildId so screens don't try to fetch a deleted child.
        await AsyncStorage.removeItem(ACTIVE_CHILD_KEY).catch(() => {});
        _setActiveChildId(undefined);
      }
    } catch {
      setChildList([]);
    }
  }, [setActiveChildId]);

  // Bootstrap: fetch user then children before releasing the loading gate.
  // Keeping isLoading=true until BOTH complete prevents screens from rendering
  // with activeChildId=undefined and getting stuck in a permanent loading spinner.
  const checkAppState = useCallback(async () => {
    setAuthError(null);
    setIsLoading(true);
    try {
      await refetchUser();
      await refetchChildren();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // 401 → unauthenticated; no error to show, just redirect to login
        setAuthError(null);
      } else {
        const msg =
          (e as Error)?.message ??
          'Service temporarily unavailable. Please try again later.';
        setAuthError({ type: 'unknown', message: msg });
      }
    } finally {
      setIsLoading(false);
    }
  }, [refetchUser, refetchChildren]);

  // Bootstrap on mount
  useEffect(() => {
    void checkAppState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    await api.auth.logout();
    await AsyncStorage.removeItem(ACTIVE_CHILD_KEY).catch(() => {});
    // Clear cached Google session so the account picker shows on next sign-in
    await GoogleSignin.signOut().catch(() => {});
    setUser(null);
    setChildList([]);
    _setActiveChildId(undefined);
    setAuthError(null);
    // Clear all per-user React Query cache so a re-login never sees stale data.
    queryClientInstance.clear();
    setIsLoading(false);
  }, []);

  const activeChild = childList.find(c => c.id === activeChildId) ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        children: childList,
        activeChild,
        activeChildId,
        setActiveChildId,
        clearActiveChildId,
        isLoading,
        isAuthenticated: !!user,
        authError,
        logout,
        refetchUser,
        refetchChildren,
        checkAppState,
      }}
    >
      {node}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
