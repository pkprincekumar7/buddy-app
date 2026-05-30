import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { api } from '@/api/client';
import type { UserRecord, ChildRecord } from '@/types/api';

const ACTIVE_CHILD_KEY = 'buddy360:activeChildId';

interface AuthContextValue {
  user: UserRecord | null;
  children: ChildRecord[];
  activeChild: ChildRecord | null;
  activeChildId: string | undefined;
  setActiveChildId: (id: string) => void;
  clearActiveChildId: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
  refetchChildren: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children: node }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [childList, setChildList] = useState<ChildRecord[]>([]);
  const [activeChildId, _setActiveChildId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Restore persisted activeChildId on mount
  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_CHILD_KEY).then((stored) => {
      if (stored) _setActiveChildId(stored);
    }).catch(() => {});
  }, []);

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
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refetchChildren = useCallback(async () => {
    try {
      const list = await api.entities.Child.list();
      setChildList(list);
      if (list.length > 0) {
        const stored = await AsyncStorage.getItem(ACTIVE_CHILD_KEY).catch(() => null);
        const valid = stored && list.some((c) => c.id === stored);
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

  // Bootstrap on mount
  useEffect(() => {
    refetchUser().then(() => refetchChildren()).catch(() => setIsLoading(false));
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
    setIsLoading(false);
  }, []);

  const activeChild = childList.find((c) => c.id === activeChildId) ?? null;

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
        logout,
        refetchUser,
        refetchChildren,
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
