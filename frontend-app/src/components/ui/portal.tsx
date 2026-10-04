import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

/**
 * Portal — renders full-screen overlays into a host at the app root (above the
 * navigator and its header), the RN stand-in for the web's `position: fixed`
 * overlays.
 *
 * Use this instead of `<Modal visible>` for any overlay whose parent shows it
 * by conditional rendering (`{open && <Overlay />}`). On iOS, unmounting a
 * React Native <Modal> while it is still presented leaves UIKit mid-dismissal
 * and swallows the next touch anywhere in the app — every splash, warp and
 * sheet close cost the user a dead tap. A Portal presents nothing natively,
 * so there is nothing to dismiss, and Reanimated `exiting` animations play.
 *
 * Content renders outside the screen that declared it, so it must not rely on
 * per-screen navigation context (`useRoute`/`useNavigation`); `@/lib/router`'s
 * hooks are fine (they fall back to the focused route).
 * Overlays that toggle visibility in place (`ui/dialog`) can keep using Modal.
 */
interface PortalApi {
  set: (key: string, node: ReactNode) => void;
  remove: (key: string) => void;
}

const PortalContext = createContext<PortalApi | null>(null);

interface Entry {
  key: string;
  node: ReactNode;
}

/** Mount once at the app root, inside every provider the overlays use. */
export function PortalHost({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const api = useMemo<PortalApi>(
    () => ({
      set: (key, node) =>
        setEntries(prev => {
          const i = prev.findIndex(e => e.key === key);
          if (i === -1) return [...prev, { key, node }];
          const next = prev.slice();
          next[i] = { key, node };
          return next;
        }),
      remove: key => setEntries(prev => prev.filter(e => e.key !== key)),
    }),
    [],
  );

  return (
    <PortalContext.Provider value={api}>
      {children}
      {entries.map(e => (
        <View
          key={e.key}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          accessibilityViewIsModal
        >
          {e.node}
        </View>
      ))}
    </PortalContext.Provider>
  );
}

interface PortalProps {
  children: ReactNode;
  /** Android hardware back while shown (Modal's `onRequestClose`). */
  onRequestClose?: () => void;
}

/** Renders `children` full-screen above the whole app while mounted. */
export function Portal({ children, onRequestClose }: PortalProps) {
  const api = useContext(PortalContext);
  if (!api) throw new Error('Portal must be rendered inside a PortalHost');
  const key = useId();

  // Push the latest children on every render so the overlay stays live.
  useLayoutEffect(() => {
    api.set(key, children);
  });
  useLayoutEffect(() => () => api.remove(key), [api, key]);

  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  useEffect(() => {
    // Like a native Modal, an overlay always captures back — one without a
    // handler (splash, warp) just blocks it rather than leaving the screen below.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current?.();
      return true;
    });
    return () => sub.remove();
  }, []);

  return null;
}
