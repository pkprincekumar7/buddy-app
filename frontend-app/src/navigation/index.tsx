import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
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
import { Home, Target, TrendingUp, Brain, Map } from 'lucide-react-native';

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

function MainTabNavigator() {
  return (
    <MainTab.Navigator
      screenOptions={{
        ...darkHeader,
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#1a1a1a',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#14b8a6',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <MainTab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      {/* Growth and Personality use nested stacks that manage their own headers.
          Setting headerShown: false here prevents a doubled header. */}
      <MainTab.Screen
        name="Personality"
        component={PersonalityNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Brain color={color} size={size} />,
        }}
      />
      <MainTab.Screen
        name="Growth"
        component={GrowthNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <TrendingUp color={color} size={size} />
          ),
        }}
      />
      <MainTab.Screen
        name="LifePathway"
        component={LifePathwayScreen}
        options={{
          tabBarLabel: 'Pathway',
          tabBarIcon: ({ color, size }) => <Map color={color} size={size} />,
        }}
      />
      <MainTab.Screen
        name="Goals"
        component={GoalsDashboardScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Target color={color} size={size} />,
        }}
      />
    </MainTab.Navigator>
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
  const { isAuthenticated, isLoading, activeChild } = useAuth();

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
