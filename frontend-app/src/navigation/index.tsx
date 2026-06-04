import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  getStateFromPath as defaultGetStateFromPath,
} from '@react-navigation/native';
import type { LinkingOptions, Theme } from '@react-navigation/native';
import { navigationRef } from '../lib/navigationRef';
import { useAuth } from '../lib/AuthContext';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Home, Target, TrendingUp, Brain, Map } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

// AsyncStorage key for persisting unlocked tabs per child.
const tabStorageKey = (childId: string) => `unlockedTabs:${childId}`;

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
  const insets = useSafeAreaInsets();
  const focusedRouteName = state.routes[state.index]?.name;

  const visibleRoutes = state.routes.filter(r => unlockedTabs.has(r.name));

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0a0a0a',
        borderTopColor: '#1a1a1a',
        borderTopWidth: 1,
        paddingBottom: insets.bottom,
        paddingTop: 8,
      }}
    >
      {visibleRoutes.map(route => {
        const isFocused = route.name === focusedRouteName;
        const color = isFocused ? '#14b8a6' : '#6b7280';
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

/**
 * Custom dark theme matching the app's background (#0a0a0a) and teal accent (#14b8a6).
 * Applied to NavigationContainer so all headers and tab bars are dark by default.
 */
const AppTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0a0a0a',
    card: '#0a0a0a',
    text: '#ffffff',
    border: '#1a1a1a',
    primary: '#14b8a6',
    notification: '#14b8a6',
  },
};

function HeaderTitle({ children }: { children?: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0.6,
        color: '#ffffff',
        textShadowColor: 'rgba(45,212,191,0.45)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
      }}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/** Shared dark header options reused across all navigators. */
const darkHeader = {
  headerStyle: { backgroundColor: '#0a0a0a' },
  headerTintColor: '#ffffff' as const,
  headerTitleStyle: { color: '#ffffff' as const },
  headerTitle: (props: { children?: React.ReactNode }) => (
    <HeaderTitle {...props} />
  ),
  headerLeft: () => null,
  headerRight: () => <HeaderRight />,
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function OnboardingNavigator() {
  return (
    <OnboardingStack.Navigator screenOptions={darkHeader}>
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
  return (
    <GrowthStack.Navigator screenOptions={darkHeader}>
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
  return (
    <PersonalityStack.Navigator screenOptions={darkHeader}>
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
  const childId = activeChild?.id ?? 'guest';

  // Keep a ref so unlockTab always writes to the correct AsyncStorage key even
  // if it is called before activeChild finishes loading (childId still 'guest').
  const childIdRef = useRef(childId);
  useEffect(() => {
    childIdRef.current = childId;
  }, [childId]);

  const [unlockedTabs, setUnlockedTabs] = useState<Set<string>>(
    new Set(['Home']),
  );

  // Load persisted unlocked tabs whenever the real child ID becomes known.
  // Skip the 'guest' fallback — only read storage once we have an actual ID.
  useEffect(() => {
    if (childId === 'guest') return;
    void AsyncStorage.getItem(tabStorageKey(childId)).then(val => {
      setUnlockedTabs(new Set(val ? (JSON.parse(val) as string[]) : ['Home']));
    });
  }, [childId]);

  const unlockTab = useCallback((tabName: string) => {
    const id = childIdRef.current;
    if (id === 'guest') return; // child not loaded yet — skip to avoid saving under wrong key
    setUnlockedTabs(prev => {
      if (prev.has(tabName)) return prev;
      const next = new Set(prev);
      next.add(tabName);
      void AsyncStorage.setItem(tabStorageKey(id), JSON.stringify([...next]));
      return next;
    });
  }, []); // no dependencies — reads childId via ref

  return (
    <UnlockedTabsContext.Provider value={unlockedTabs}>
      <MainTab.Navigator tabBar={stableTabBar} screenOptions={darkHeader}>
        <MainTab.Screen
          name="Home"
          component={HomeScreen}
          listeners={{ focus: () => unlockTab('Home') }}
        />
        {/* Growth and Personality use nested stacks that manage their own headers.
            Setting headerShown: false here prevents a doubled header. */}
        <MainTab.Screen
          name="Personality"
          component={PersonalityNavigator}
          options={{ headerShown: false }}
          listeners={{ focus: () => unlockTab('Personality') }}
        />
        <MainTab.Screen
          name="Growth"
          component={GrowthNavigator}
          options={{ headerShown: false }}
          listeners={{ focus: () => unlockTab('Growth') }}
        />
        <MainTab.Screen
          name="LifePathway"
          component={LifePathwayScreen}
          listeners={{ focus: () => unlockTab('LifePathway') }}
        />
        <MainTab.Screen
          name="Goals"
          component={GoalsDashboardScreen}
          listeners={{ focus: () => unlockTab('Goals') }}
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

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0a0a0a',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color="#2dd4bf" />
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
          backgroundColor: '#0a0a0a',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 16,
        }}
      >
        <Text
          style={{
            color: '#cbd5e1',
            textAlign: 'center',
            maxWidth: 320,
            lineHeight: 22,
          }}
        >
          {authError.message}
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: '#0d9488',
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 12,
          }}
          onPress={() => void checkAppState()}
        >
          <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
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

export default function Navigation() {
  return (
    <NavigationContainer ref={navigationRef} linking={linking} theme={AppTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}
