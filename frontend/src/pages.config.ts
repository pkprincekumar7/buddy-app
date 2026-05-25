import type { ComponentType, ReactNode } from 'react';
import Home from './pages/Home';
import LifePathway from './pages/LifePathway';
import Onboarding from './pages/Onboarding';
import GoalsDashboard from './pages/GoalsDashboard';
import ConversationalOnboarding from './pages/ConversationalOnboarding';
import PersonalityType from './pages/PersonalityType';
import PersonalityJourney from './pages/PersonalityJourney';
import GrowthAreas from './pages/GrowthAreas';
import __Layout from './Layout';

export const PAGES = {
  Home,
  LifePathway,
  Onboarding,
  GoalsDashboard,
  ConversationalOnboarding,
  PersonalityType,
  PersonalityJourney,
  GrowthAreas,
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
