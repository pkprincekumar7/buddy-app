import React, { useCallback, useEffect, type ComponentType } from 'react';
import { BackHandler, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import {
  buildPath,
  resetTo,
  type PageName,
  type RouteParams,
} from '@/lib/router';
import { useViewMode } from '@/lib/ViewModeContext';
import { allowedInChildView, childViewHome } from '@/lib/childView';
import { color } from '@/theme';

/**
 * Child view keeps to the child's hub and kids page (docs/child-view-build-plan.md,
 * 1.3; web App.tsx ChildViewRoutes). A stack keeps earlier screens mounted, so a
 * check in `navigate` alone isn't enough: every screen checks itself.
 *
 * - Any other screen, however it was reached, resets the stack to the child's
 *   circles alone (and renders a plain background meanwhile).
 * - Android's hardware Back does nothing at the bottom of the stack, so it can't
 *   leave the app to the parent's launcher state; above it, Back works as usual.
 */
export function withChildViewGuard(Screen: ComponentType) {
  function ChildViewGuard() {
    const route = useRoute();
    const navigation = useNavigation();
    const { view } = useViewMode();
    const childId = view.mode === 'child' ? view.childId : null;
    const path = buildPath(
      route.name as PageName,
      route.params as RouteParams | undefined,
    ).split('?')[0];
    const blocked =
      childId !== null && !allowedInChildView(path ?? '', childId);

    // On a cold start in child view this runs before the navigator is ready, when a
    // reset does nothing: keep trying until it takes (or the screen goes away).
    useEffect(() => {
      if (!blocked || !childId) return undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const attempt = () => {
        if (!resetTo(childViewHome(childId))) retry = setTimeout(attempt, 50);
      };
      attempt();
      return () => clearTimeout(retry);
    }, [blocked, childId]);

    useFocusEffect(
      useCallback(() => {
        if (!childId) return undefined;
        const sub = BackHandler.addEventListener(
          'hardwareBackPress',
          () => !navigation.canGoBack(),
        );
        return () => sub.remove();
      }, [childId, navigation]),
    );

    if (blocked) {
      return <View style={{ flex: 1, backgroundColor: color.background }} />;
    }
    return <Screen />;
  }
  ChildViewGuard.displayName = `ChildViewGuard(${
    Screen.displayName ?? Screen.name ?? 'Screen'
  })`;
  return ChildViewGuard;
}
