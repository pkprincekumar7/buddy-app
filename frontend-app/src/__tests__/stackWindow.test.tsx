import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  StackActions,
  useRoute,
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { withStackWindow } from '@/navigation/withStackWindow';

type Params = { A: undefined; B: undefined; C: undefined; D: undefined };

const mounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };

function Page() {
  const route = useRoute();
  useEffect(() => {
    mounts[route.name] = (mounts[route.name] ?? 0) + 1;
  }, [route.name]);
  const state = (route.params as { state?: { fromBack?: boolean } } | undefined)
    ?.state;
  return (
    <Text>
      page {route.name}
      {state?.fromBack ? ' fromBack' : ''}
    </Text>
  );
}

const Stack = createStackNavigator<Params>();
const Windowed = withStackWindow(Page);
const ref = createNavigationContainerRef<Params>();

function App() {
  return (
    <NavigationContainer ref={ref}>
      <Stack.Navigator
        screenOptions={{ animation: 'none', headerShown: false }}
      >
        <Stack.Screen name="A" component={Windowed} />
        <Stack.Screen name="B" component={Windowed} />
        <Stack.Screen name="C" component={Windowed} />
        <Stack.Screen name="D" component={Windowed} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

describe('withStackWindow', () => {
  it('renders only the top two pages and re-mounts a deep page with fromBack on return', () => {
    const { queryByText: q } = render(<App />);
    // Covered stack pages are hidden from accessibility — include them.
    const queryByText = (m: string | RegExp) =>
      q(m, { includeHiddenElements: true });
    act(() => ref.dispatch(StackActions.push('B')));
    act(() => ref.dispatch(StackActions.push('C')));

    // A fresh push mounts once and is not marked fromBack.
    expect(mounts.C).toBe(1);
    expect(queryByText('page C')).toBeTruthy();

    // A is two levels deep → unloaded; B (under C) and C stay rendered.
    expect(queryByText(/page A/)).toBeNull();
    expect(queryByText(/page B/)).toBeTruthy();
    expect(queryByText(/page C/)).toBeTruthy();

    act(() => ref.dispatch(StackActions.push('D')));
    expect(queryByText(/page B/)).toBeNull();

    // Back to C, then B: B re-mounts only once focused, marked fromBack.
    act(() => ref.goBack());
    expect(queryByText(/page B/)).toBeNull();
    act(() => ref.goBack());
    expect(queryByText('page B fromBack')).toBeTruthy();
    expect(mounts.B).toBe(2);

    // C was never unloaded, so it never re-mounted.
    expect(mounts.C).toBe(1);
  });
});
