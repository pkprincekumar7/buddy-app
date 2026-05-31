import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Navigate to a root-level screen (or a nested screen within it).
 * Pass `params` for nested navigation, e.g.:
 *   navigateTo('Main', { screen: 'Personality', params: { screen: 'PersonalityType', params: { childId } } })
 */
export function navigateTo(
  name: keyof RootStackParamList,
  params?: Record<string, unknown>,
) {
  if (navigationRef.isReady()) {
    (
      navigationRef as unknown as {
        navigate: (name: string, params?: Record<string, unknown>) => void;
      }
    ).navigate(name, params);
  }
}
