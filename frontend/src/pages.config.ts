import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import __Layout from './Layout';

const Home = lazy(() => import('./pages/Home'));
const LifePathway = lazy(() => import('./pages/LifePathway'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const GoalsDashboard = lazy(() => import('./pages/GoalsDashboard'));
const ConversationalOnboarding = lazy(() => import('./pages/ConversationalOnboarding'));
const PersonalityJourney = lazy(() => import('./pages/PersonalityJourney'));
const GrowthAreas = lazy(() => import('./pages/GrowthAreas'));
const PersonalityProfile = lazy(() => import('./pages/PersonalityProfile'));
const Observations = lazy(() => import('./pages/Observations'));
const Connect = lazy(() => import('./pages/Connect'));

export const PAGES = {
  Home,
  LifePathway,
  Onboarding,
  GoalsDashboard,
  ConversationalOnboarding,
  PersonalityJourney,
  PersonalityProfile,
  GrowthAreas,
  Observations,
  Connect,
};

export const pagesConfig = {
  mainPage: 'Home',
  Pages: PAGES,
  Layout: __Layout,
} satisfies {
  mainPage: string;
  Pages: Record<string, ComponentType<object>>;
  Layout: ComponentType<{ children: ReactNode; currentPageName?: string }>;
};
