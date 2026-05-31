import { useCallback, useState } from 'react';
import { useRoute } from '@react-navigation/native';

/**
 * Controls whether the StageSplash overlay is mounted.
 *
 * On FORWARD navigation (no fromBack param) showSplash starts as true and the
 * splash component handles its own fade-in → hold → fade-out lifecycle.  Once
 * its container has fully faded out it calls onReady (= dismiss here), which
 * sets showSplash to false and lets the parent unmount the overlay.
 *
 * On BACK navigation the route receives { fromBack: true }, so showSplash
 * starts as false — the splash is never mounted and the page entrance
 * animation fires immediately.
 *
 * Note: no setTimeout lives here; all timing is owned by StageSplash itself.
 */
export function useStageSplash() {
  const route = useRoute();
  const params = route.params as { fromBack?: boolean } | undefined;

  // Initialised once at mount time — forward nav ⟹ true, back nav ⟹ false.
  const [showSplash, setShowSplash] = useState<boolean>(
    () => !params?.fromBack,
  );

  // Passed to <StageSplash onReady={dismiss} /> — called after the fade-out.
  const dismiss = useCallback(() => setShowSplash(false), []);

  return [showSplash, dismiss] as [boolean, () => void];
}
