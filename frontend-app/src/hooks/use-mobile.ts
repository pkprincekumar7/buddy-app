import { useState, useEffect } from 'react';
import { Dimensions } from 'react-native';

// In React Native every screen is always "mobile", but this hook preserves the
// web API so shared components that call useIsMobile() continue to work.
// It also responds to orientation changes via the Dimensions event listener.

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => Dimensions.get('window').width < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setIsMobile(window.width < MOBILE_BREAKPOINT);
    });
    return () => subscription.remove();
  }, []);

  return isMobile;
}
