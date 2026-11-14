import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useChildren } from '@/hooks/useChildren';

/**
 * Parent view or child view (docs/child-view-build-plan.md, 1.1). Child view is
 * a mode of the parent's own session, kept on this device: a parent can be in
 * parent view on the laptop while the child uses the tablet.
 */
export type ViewMode = { mode: 'parent' } | { mode: 'child'; childId: string };

interface ViewModeContextValue {
  view: ViewMode;
  /** Switch this device to child view for one of the signed-in parent's children. */
  enterChildView: (childId: string) => void;
  /** Back to parent view. */
  exitChildView: () => void;
}

const PARENT: ViewMode = { mode: 'parent' };
const STORAGE_KEY = 'superpower.view';

/** What's kept: whose session chose child view, and for which child. */
interface Stored {
  userId: string;
  childId: string;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as Stored).userId === 'string' &&
      typeof (value as Stored).childId === 'string'
    ) {
      return value as Stored;
    }
  } catch {
    // Blocked or corrupt storage: parent view.
  }
  return null;
}

function writeStored(value: Stored | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the view lasts until the page reloads.
  }
}

const ViewModeContext = createContext<ViewModeContextValue>({
  view: PARENT,
  enterChildView: () => undefined,
  exitChildView: () => undefined,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const { user, isLoadingAuth, authError } = useAuth();
  const isParent = user?.role === 'parent';
  const [stored, setStored] = useState<Stored | null>(readStored);
  const kids = useChildren(isParent && stored !== null);

  const forget = useCallback(() => {
    writeStored(null);
    setStored(null);
  }, []);

  // Signed out, or another account signed in on this device: forget it. A failed check
  // (offline, a 5xx) is neither: the device stays in child view while it retries.
  useEffect(() => {
    if (isLoadingAuth || authError || !stored) return;
    if (user?.id !== stored.userId || !isParent) forget();
  }, [isLoadingAuth, authError, user, isParent, stored, forget]);

  // The child was deleted (or isn't this account's): back to parent view.
  useEffect(() => {
    if (!stored || kids.isLoading || kids.isLoadingError || !isParent) return;
    if (!kids.list.some((c) => c.id === stored.childId)) forget();
  }, [stored, kids.isLoading, kids.isLoadingError, kids.list, isParent, forget]);

  const enterChildView = useCallback(
    (childId: string) => {
      if (!user || !isParent) return;
      const value = { userId: user.id, childId };
      writeStored(value);
      setStored(value);
    },
    [user, isParent],
  );

  const view = useMemo<ViewMode>(
    () =>
      isParent && stored?.userId === user?.id && stored
        ? { mode: 'child', childId: stored.childId }
        : PARENT,
    [isParent, stored, user?.id],
  );

  const value = useMemo(
    () => ({ view, enterChildView, exitChildView: forget }),
    [view, enterChildView, forget],
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useViewMode = (): ViewModeContextValue => useContext(ViewModeContext);
