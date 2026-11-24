import { useEffect, useRef } from 'react';

/**
 * A ref to an AbortSignal that aborts when the component unmounts, for stopping
 * generation polls. Made on mount, so a remount (StrictMode, a fast refresh) gets a
 * live one again.
 */
export function useUnmountSignal() {
  const controllerRef = useRef<AbortController>(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);
  return controllerRef;
}
