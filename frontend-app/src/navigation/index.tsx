import React, { useCallback, useContext, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  getStateFromPath as defaultGetStateFromPath,
} from '@react-navigation/native';
import type { LinkingOptions, Theme } from '@react-navigation/native';
import { ThemeProvider, useTheme } from '../lib/ThemeContext';
import { darkColors, lightColors } from '../lib/themeColors';
import { navigationRef } from '../lib/navigationRef';
import { useAuth } from '../lib/AuthContext';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Home, Target, TrendingUp, Brain, Map } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import ConversationalOnboardingScreen from '../screens/onboarding/ConversationalOnboardingScreen';
import HomeScreen from '../screens/home/HomeScreen';
import GoalsDashboardScreen from '../screens/goals/GoalsDashboardScreen';
import GrowthAreasScreen from '../screens/growth/GrowthAreasScreen';
import GrowthAreasActivityScreen from '../screens/growth/GrowthAreasActivityScreen';
import GrowthAreasActivityGameScreen from '../screens/growth/GrowthAreasActivityGameScreen';
import GrowthAreasGreatInsightsScreen from '../screens/growth/GrowthAreasGreatInsightsScreen';
import PersonalityTypeScreen from '../screens/personality/PersonalityTypeScreen';
import PersonalityJourneyScreen from '../screens/personality/PersonalityJourneyScreen';
import LifePathwayScreen from '../screens/personality/LifePathwayScreen';
import HeaderRight from '../components/shared/HeaderRight';
import UserNotRegisteredError from '../components/shared/UserNotRegisteredError';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type OnboardingStackParamList = {
  Onboarding: { fromBack?: boolean } | undefined;
  ConversationalOnboarding: { fromBack?: boolean } | undefined;
};

export type GrowthStackParamList = {
  GrowthAreas: { fromBack?: boolean } | undefined;
  GrowthAreasActivity: { activityId: string; fromReview?: boolean };
  GrowthAreasActivityGame: { activityId: string };
  GrowthAreasGreatInsights: { activityId: string };
};

export type PersonalityStackParamList = {
  PersonalityType: { childId?: string; fromBack?: boolean } | undefined;
  PersonalityJourney: { childId?: string; fromBack?: boolean } | undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Goals: undefined;
  Growth: undefined;
  Personality: undefined;
  LifePathway: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();
const AuthStack = createStackNavigator<AuthStackParamList>();
const OnboardingStack = createStackNavigator<OnboardingStackParamList>();
const GrowthStack = createStackNavigator<GrowthStackParamList>();
const PersonalityStack = createStackNavigator<PersonalityStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

const DEFAULT_UNLOCKED = new Set(['Home']);

// Context lets CenteredTabBar subscribe to unlockedTabs directly so it
// re-renders whenever the set changes, without relying on the tabBar prop
// reference changing (React Navigation doesn't guarantee that triggers a re-render).
const UnlockedTabsContext = React.createContext<Set<string>>(new Set(['Home']));

// Tab display labels — kept here so CenteredTabBar doesn't depend on route names.
const TAB_LABELS: Record<string, string> = {
  Home: 'Home',
  Personality: 'Personality',
  Growth: 'Growth',
  LifePathway: 'Pathway',
  Goals: 'Goals',
};

// Tab icons by route name.
const TAB_ICONS: Record<
  string,
  (color: string, size: number) => React.ReactNode
> = {
  Home: (c, s) => <Home color={c} size={s} />,
  Personality: (c, s) => <Brain color={c} size={s} />,
  Growth: (c, s) => <TrendingUp color={c} size={s} />,
  LifePathway: (c, s) => <Map color={c} size={s} />,
  Goals: (c, s) => <Target color={c} size={s} />,
};

function CenteredTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const unlockedTabs = useContext(UnlockedTabsContext);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const focusedRouteName = state.routes[state.index]?.name;

  const visibleRoutes = state.routes.filter(r => unlockedTabs.has(r.name));

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        paddingBottom: insets.bottom,
        paddingTop: 8,
      }}
    >
      {visibleRoutes.map(route => {
        const isFocused = route.name === focusedRouteName;
        const color = isFocused ? colors.primary : colors.tabInactive;
        const { options } = descriptors[route.key];

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
            style={{
              alignItems: 'center',
              paddingHorizontal: 20,
              paddingVertical: 4,
            }}
          >
            {TAB_ICONS[route.name]?.(color, 24)}
            <Text style={{ color, fontSize: 10, marginTop: 3 }}>
              {TAB_LABELS[route.name] ?? route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Dark navigation theme — built from darkColors token object. */
const DarkAppTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkColors.background,
    card: darkColors.card,
    text: darkColors.text,
    border: darkColors.border,
    primary: darkColors.primary,
    notification: darkColors.primary,
  },
};

/** Light navigation theme — built from lightColors token object. */
const LightAppTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightColors.background,
    card: lightColors.card,
    text: lightColors.text,
    border: lightColors.border,
    primary: lightColors.primary,
    notification: lightColors.primary,
  },
};

function HeaderTitle({ children }: { children?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0.6,
        color: colors.text,
        textShadowColor: colors.headerShadowColor,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: colors.headerShadowRadius,
      }}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/** Returns header options that match the current theme. */
function useHeaderOptions() {
  const { colors } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.card },
    headerTintColor: colors.text,
    headerTitleStyle: { color: colors.text },
    headerTitle: (props: { children?: React.ReactNode }) => (
      <HeaderTitle {...props} />
    ),
    headerLeft: () => null,
    headerRight: () => <HeaderRight />,
  };
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function OnboardingNavigator() {
  const headerOptions = useHeaderOptions();
  return (
    <OnboardingStack.Navigator screenOptions={headerOptions}>
      {/* headerLeft: null removes the back arrow on the root screen (nothing to go back to) */}
      <OnboardingStack.Screen
        name="Onboarding"
        component={OnboardingScreen}
        options={{ title: 'Welcome', headerLeft: () => null }}
      />
      <OnboardingStack.Screen
        name="ConversationalOnboarding"
        component={ConversationalOnboardingScreen}
        options={{ title: 'About Your Child' }}
      />
    </OnboardingStack.Navigator>
  );
}

function GrowthNavigator() {
  const headerOptions = useHeaderOptions();
  return (
    <GrowthStack.Navigator screenOptions={headerOptions}>
      <GrowthStack.Screen
        name="GrowthAreas"
        component={GrowthAreasScreen}
        options={{ title: 'Growth' }}
      />
      <GrowthStack.Screen
        name="GrowthAreasActivity"
        component={GrowthAreasActivityScreen}
        options={{ title: 'Activity' }}
      />
      <GrowthStack.Screen
        name="GrowthAreasActivityGame"
        component={GrowthAreasActivityGameScreen}
        options={{ title: 'Activity' }}
      />
      <GrowthStack.Screen
        name="GrowthAreasGreatInsights"
        component={GrowthAreasGreatInsightsScreen}
        options={{ title: 'Insights' }}
      />
    </GrowthStack.Navigator>
  );
}

function PersonalityNavigator() {
  const headerOptions = useHeaderOptions();
  return (
    <PersonalityStack.Navigator screenOptions={headerOptions}>
      <PersonalityStack.Screen
        name="PersonalityType"
        component={PersonalityTypeScreen}
        options={{ title: 'Personality' }}
      />
      <PersonalityStack.Screen
        name="PersonalityJourney"
        component={PersonalityJourneyScreen}
        options={{ title: 'Journey' }}
      />
    </PersonalityStack.Navigator>
  );
}

// Stable tabBar renderer — never changes reference so React Navigation doesn't
// remount the tab bar. CenteredTabBar reads unlockedTabs from context instead.
const stableTabBar = (props: BottomTabBarProps) => (
  <CenteredTabBar {...props} />
);

function MainTabNavigator() {
  const { activeChild } = useAuth();
  const headerOptions = useHeaderOptions();

  // Seed from the database — activeChild is kept fresh by AuthContext (React Query).
  const dbTabs = activeChild?.visited_tabs;
  const [unlockedTabs, setUnlockedTabs] = useState<Set<string>>(
    dbTabs && dbTabs.length > 0 ? new Set(dbTabs) : DEFAULT_UNLOCKED,
  );

  // Sync local state when the server value changes (login, background refresh,
  // or another device adding a tab).
  const prevChildIdRef = React.useRef<string | undefined>(undefined);
  const prevDbTabsRef = React.useRef<Set<string> | undefined>(undefined);
  // Tracks which tabs are already persisted or in-flight so we don't send
  // duplicate API calls when the same tab is re-focused.
  const persistedTabsRef = useRef<Set<string>>(
    new Set(activeChild?.visited_tabs ?? []),
  );

  React.useEffect(() => {
    const childId = activeChild?.id;
    if (!childId || !dbTabs) return;

    const incoming = new Set(dbTabs);
    const childChanged = prevChildIdRef.current !== childId;

    if (childChanged) {
      // Different child — reset completely so Child A's tabs never bleed into
      // Child B's tab bar. Also resets persistedTabsRef so Child B's tabs are
      // not skipped by the in-flight guard seeded from Child A (or from the
      // empty initial value when activeChild was still loading on first render).
      prevChildIdRef.current = childId;
      prevDbTabsRef.current = incoming;
      persistedTabsRef.current = new Set(dbTabs);
      setUnlockedTabs(new Set([...DEFAULT_UNLOCKED, ...incoming]));
      return;
    }

    // Same child — merge so any locally added tabs are never dropped on refresh.
    // Order-insensitive comparison: $addToSet may return tabs in any order.
    const prev = prevDbTabsRef.current;
    if (
      prev &&
      prev.size === incoming.size &&
      [...incoming].every(t => prev.has(t))
    )
      return;
    prevDbTabsRef.current = incoming;
    setUnlockedTabs(
      current => new Set([...DEFAULT_UNLOCKED, ...incoming, ...current]),
    );
  }, [dbTabs, activeChild?.id]);

  const unlockTab = useCallback(
    async (tabName: string) => {
      const childId = activeChild?.id;
      if (!childId) return;
      if (persistedTabsRef.current.has(tabName)) return;

      // Mark in-flight immediately to prevent duplicate calls on rapid re-focus.
      persistedTabsRef.current = new Set([
        ...persistedTabsRef.current,
        tabName,
      ]);

      try {
        await api.entities.Child.update(childId, { visited_tabs: [tabName] });
        // Reflect in UI only after the server confirms the write.
        setUnlockedTabs(prev => new Set([...prev, tabName]));
      } catch {
        // Remove the in-flight marker so the next focus event retries.
        persistedTabsRef.current = new Set(
          [...persistedTabsRef.current].filter(t => t !== tabName),
        );
      }
    },
    [activeChild?.id],
  );

  return (
    <UnlockedTabsContext.Provider value={unlockedTabs}>
      <MainTab.Navigator tabBar={stableTabBar} screenOptions={headerOptions}>
        <MainTab.Screen
          name="Home"
          component={HomeScreen}
          listeners={{ focus: () => void unlockTab('Home') }}
        />
        {/* Growth and Personality use nested stacks that manage their own headers.
            Setting headerShown: false here prevents a doubled header. */}
        <MainTab.Screen
          name="Personality"
          component={PersonalityNavigator}
          options={{ headerShown: false }}
          listeners={{ focus: () => void unlockTab('Personality') }}
        />
        <MainTab.Screen
          name="Growth"
          component={GrowthNavigator}
          options={{ headerShown: false }}
          listeners={{ focus: () => void unlockTab('Growth') }}
        />
        <MainTab.Screen
          name="LifePathway"
          component={LifePathwayScreen}
          listeners={{ focus: () => void unlockTab('LifePathway') }}
        />
        <MainTab.Screen
          name="Goals"
          component={GoalsDashboardScreen}
          listeners={{ focus: () => void unlockTab('Goals') }}
        />
      </MainTab.Navigator>
    </UnlockedTabsContext.Provider>
  );
}

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['buddy360://', 'https://buddy360.app'],
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          Register: 'register',
        },
      },
      Onboarding: {
        screens: {
          Onboarding: 'onboarding',
          ConversationalOnboarding: 'onboarding/chat',
        },
      },
      Main: {
        screens: {
          Home: 'home',
          Goals: 'goals',
          Growth: 'growth',
          Personality: 'personality',
          LifePathway: 'life-pathway',
        },
      },
    },
  },
  getStateFromPath(path, options) {
    // Redirect logout links to the Auth stack regardless of path structure
    if (path.includes('clear_access_token')) {
      return { routes: [{ name: 'Auth' as const }] };
    }
    return defaultGetStateFromPath(path, options);
  },
};

function RootNavigator() {
  const {
    isAuthenticated,
    isLoading,
    activeChild,
    authError,
    checkAppState,
    logout,
  } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError onLogout={logout} />;
  }

  if (authError?.type === 'unknown') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 16,
        }}
      >
        <Text
          style={{
            color: colors.textMuted,
            textAlign: 'center',
            maxWidth: 320,
            lineHeight: 22,
          }}
        >
          {authError.message}
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: colors.primaryAction,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 12,
          }}
          onPress={() => void checkAppState()}
        >
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        /* Unauthenticated — show login/register only */
        <RootStack.Screen name="Auth" component={AuthNavigator} />
      ) : (
        /*
         * Authenticated — always render Main first so it sits at the bottom of the
         * stack. When onboarding is not yet complete, Onboarding is pushed on top.
         * This lets the Back button on any onboarding screen pop back to the main
         * app (mirroring the web where /Home is always reachable).
         */
        <>
          <RootStack.Screen name="Main" component={MainTabNavigator} />
          {!activeChild?.onboarding_completed && (
            <RootStack.Screen
              name="Onboarding"
              component={OnboardingNavigator}
            />
          )}
        </>
      )}
    </RootStack.Navigator>
  );
}

function NavigationWithTheme() {
  const { isDark } = useTheme();
  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={isDark ? DarkAppTheme : LightAppTheme}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function Navigation() {
  return (
    <ThemeProvider>
      <NavigationWithTheme />
    </ThemeProvider>
  );
}
