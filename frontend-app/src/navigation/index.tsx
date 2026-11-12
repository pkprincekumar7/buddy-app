import React from 'react';
import { Text, View } from 'react-native';
import {
  DarkTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import {
  createStackNavigator,
  type StackNavigationOptions,
} from '@react-navigation/stack';
import { useAuth } from '@/lib/AuthContext';
import {
  navigationRef,
  syncCurrentRoute,
  type PageName,
  type RootStackParamList,
  type RouteParams,
} from '@/lib/router';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/shared/Spinner';
import AppHeader from '@/components/layout/AppHeader';
import { color } from '@/theme';

import Login from '@/screens/Login';
import Register from '@/screens/Register';
import Admin from '@/screens/Admin';
import Home from '@/screens/Home';
import Onboarding from '@/screens/Onboarding';
import ConversationalOnboarding from '@/screens/ConversationalOnboarding';
import PersonalityJourney from '@/screens/PersonalityJourney';
import PersonalityProfile from '@/screens/PersonalityProfile';
import LifePathway from '@/screens/LifePathway';
import GrowthAreas from '@/screens/GrowthAreas';
import Observations from '@/screens/Observations';
import Connect from '@/screens/Connect';
import KidsMode from '@/screens/KidsMode';
import AccountSettings from '@/screens/AccountSettings';
import PageNotFound from '@/screens/PageNotFound';
import { withStackWindow } from './withStackWindow';
import { withChildViewGuard } from './withChildViewGuard';
import { useViewMode } from '@/lib/ViewModeContext';

const Stack = createStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.primary,
    background: color.background,
    card: color['sidebar-background'],
    text: color.foreground,
    border: color.border,
    notification: color.primary,
  },
};

// Every page the web wraps in <Layout> gets the Layout header.
const withLayout: StackNavigationOptions = {
  header: ({ route }) => (
    <AppHeader
      currentPageName={route.name as PageName}
      childId={(route.params as RouteParams | undefined)?.childId}
    />
  ),
  cardStyle: { backgroundColor: color.background },
};
const bare: StackNavigationOptions = {
  headerShown: false,
  cardStyle: { backgroundColor: color.background },
};

// Pages that route by /:pageName/:childId on the web (App.tsx ProtectedRoutes).
// Each is wrapped so only the top two stack pages stay rendered — see withStackWindow —
// and so child view keeps to the child's hub and kids page — see withChildViewGuard.
const page = (Screen: React.ComponentType) =>
  withChildViewGuard(withStackWindow(Screen));
const PROTECTED_PAGES = {
  Home: page(Home),
  Onboarding: page(Onboarding),
  ConversationalOnboarding: page(ConversationalOnboarding),
  PersonalityJourney: page(PersonalityJourney),
  PersonalityProfile: page(PersonalityProfile),
  LifePathway: page(LifePathway),
  GrowthAreas: page(GrowthAreas),
  Observations: page(Observations),
  Connect: page(Connect),
  Kids: page(KidsMode),
  AccountSettings: page(AccountSettings),
} as const;

function FullScreenSpinner() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Spinner className="h-8 w-8" durationSeconds={1} />
    </View>
  );
}

/**
 * Root navigator — the RN counterpart of web App.tsx's AppShell. Each auth
 * state renders a different screen set (public / admin / protected), so a
 * login or logout swaps the whole stack exactly like the web re-rendering a
 * different <Routes> block.
 */
function RootNavigator() {
  const { isLoadingAuth, authError, isAuthenticated, checkAppState, user } =
    useAuth();
  // The stored view decides the first screen in child view: wait for it.
  const { ready: viewReady } = useViewMode();

  if (isLoadingAuth || !viewReady) return <FullScreenSpinner />;

  if (authError?.type === 'unknown') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="max-w-lg text-center text-foreground">
          {authError.message}
        </Text>
        <Button variant="action" onPress={() => void checkAppState()}>
          Retry
        </Button>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={withLayout}>
      {!isAuthenticated ? (
        <Stack.Group screenOptions={bare}>
          <Stack.Screen name="Login" component={Login} />
          <Stack.Screen name="Register" component={Register} />
        </Stack.Group>
      ) : user?.role === 'admin' ? (
        <>
          <Stack.Screen name="Admin" component={Admin} />
          <Stack.Screen name="AccountSettings" component={AccountSettings} />
        </>
      ) : (
        <>
          {(
            Object.keys(PROTECTED_PAGES) as (keyof typeof PROTECTED_PAGES)[]
          ).map(name => (
            <Stack.Screen
              key={name}
              name={name}
              component={PROTECTED_PAGES[name]}
            />
          ))}
          <Stack.Screen
            name="NotFound"
            component={PageNotFound}
            options={bare}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function Navigation() {
  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={syncCurrentRoute}
      onStateChange={syncCurrentRoute}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}
