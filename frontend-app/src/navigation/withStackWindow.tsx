import React, { useEffect, useState, type ComponentType } from 'react';
import { View } from 'react-native';
import {
  CommonActions,
  useIsFocused,
  useNavigation,
  useNavigationState,
  useRoute,
} from '@react-navigation/native';
import type { RouteParams } from '@/lib/router';
import { color } from '@/theme';

/**
 * Keeps only the top two pages of the stack rendered. The web only ever has
 * one page mounted (react-router unmounts a page on navigate), but a stack
 * navigator keeps every visited page alive underneath, so each one's looping
 * animations, timers and re-renders pile up the deeper the user goes.
 *
 * - The focused page and the one directly under it stay rendered, so the push /
 *   pop slide and the iOS swipe-back show real content.
 * - Anything deeper is replaced by a plain background; its route stays in the
 *   history, so Back still lands on it.
 * - An unloaded page re-mounts only once it is focused again (never while
 *   hidden), so its mount-time logic — redirects, data loads, voice — runs in
 *   the foreground exactly as on a web Back navigation. It is re-entered with
 *   `state.fromBack`, which `useStageSplash` honours, so a long stage splash
 *   doesn't replay on the way back.
 */
export function withStackWindow(Screen: ComponentType) {
  function StackWindow() {
    const route = useRoute();
    const navigation = useNavigation();
    const focused = useIsFocused();
    // 0 = top of the stack, 1 = directly under it, … A just-pushed route can
    // render before it appears in this state; treat it as the top (depth 0).
    const depth = useNavigationState(s => {
      const i = s.routes.findIndex(r => r.key === route.key);
      return i === -1 ? 0 : s.index - i;
    });
    const [live, setLive] = useState(true);

    const prevState = ((route.params as RouteParams | undefined) ?? {}).state;
    const markedFromBack =
      !!prevState &&
      typeof prevState === 'object' &&
      (prevState as { fromBack?: unknown }).fromBack === true;

    useEffect(() => {
      if (live && depth >= 2) {
        setLive(false);
      } else if (!live && focused) {
        if (markedFromBack) {
          // Params already carry fromBack — safe to mount (the splash hook reads it on mount).
          setLive(true);
        } else {
          const state =
            prevState && typeof prevState === 'object'
              ? { ...prevState, fromBack: true }
              : { fromBack: true };
          navigation.dispatch({
            ...CommonActions.setParams({ state }),
            source: route.key,
          });
        }
      }
    }, [
      live,
      depth,
      focused,
      markedFromBack,
      prevState,
      navigation,
      route.key,
    ]);

    if (!live)
      return <View style={{ flex: 1, backgroundColor: color.background }} />;
    return <Screen />;
  }
  StackWindow.displayName = `StackWindow(${
    Screen.displayName ?? Screen.name ?? 'Screen'
  })`;
  return StackWindow;
}
