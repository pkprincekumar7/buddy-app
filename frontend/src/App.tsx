import { useEffect, Component, Suspense, lazy } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import NavigationTracker from '@/lib/NavigationTracker';
import { pagesConfig } from './pages.config';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { PUBLIC_AUTH_PATHS } from '@/lib/authPaths';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from './pages/Login';
import Register from './pages/Register';
import { Button } from '@/components/ui/button';
import { readStoredDarkMode, applyTheme } from '@/lib/theme';

const GrowthAreasActivity = lazy(() => import('./pages/GrowthAreasActivity'));
const GrowthAreasActivityGame = lazy(() => import('./pages/GrowthAreasActivityGame'));
const GrowthAreasActivityGreatInsights = lazy(
  () => import('./pages/GrowthAreasActivityGreatInsights'),
);

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6">
          <p className="max-w-lg text-center text-foreground">
            Something went wrong. Please refresh the page.
          </p>
          <Button
            type="button"
            className="bg-primary hover:bg-primary/80"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

const PUBLIC_PATHS: readonly string[] = PUBLIC_AUTH_PATHS;

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey
  ? ((Pages as Record<string, ComponentType<object>>)[mainPageKey] ?? null)
  : null;

interface LayoutWrapperProps {
  children: ReactNode;
  currentPageName?: string;
}

const PageFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

const LayoutWrapper = ({ children, currentPageName }: LayoutWrapperProps) => {
  const wrapped = <Suspense fallback={<PageFallback />}>{children}</Suspense>;
  return Layout ? <Layout currentPageName={currentPageName}>{wrapped}</Layout> : wrapped;
};

const ProtectedRoutes = () => (
  <Routes>
    <Route
      path="/"
      element={
        <LayoutWrapper currentPageName={mainPageKey}>
          {MainPage ? <MainPage /> : null}
        </LayoutWrapper>
      }
    />
    {/* Child-specific routes — must come before the generic /:pageName entries */}
    <Route
      path="/ConversationalOnboarding/:childId"
      element={
        <LayoutWrapper currentPageName="ConversationalOnboarding">
          <Pages.ConversationalOnboarding />
        </LayoutWrapper>
      }
    />
    <Route
      path="/PersonalityType/:childId"
      element={
        <LayoutWrapper currentPageName="PersonalityType">
          <Pages.PersonalityType />
        </LayoutWrapper>
      }
    />
    <Route
      path="/PersonalityJourney/:childId"
      element={
        <LayoutWrapper currentPageName="PersonalityJourney">
          <Pages.PersonalityJourney />
        </LayoutWrapper>
      }
    />
    <Route
      path="/LifePathway/:childId"
      element={
        <LayoutWrapper currentPageName="LifePathway">
          <Pages.LifePathway />
        </LayoutWrapper>
      }
    />
    <Route
      path="/GoalsDashboard/:childId"
      element={
        <LayoutWrapper currentPageName="GoalsDashboard">
          <Pages.GoalsDashboard />
        </LayoutWrapper>
      }
    />
    {/* GrowthAreas nested routes (most-specific first) */}
    <Route
      path="/GrowthAreas/:childId/Activity/:activity/GreatInsights"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <GrowthAreasActivityGreatInsights />
        </LayoutWrapper>
      }
    />
    <Route
      path="/GrowthAreas/:childId/Activity/:activity/Game"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <GrowthAreasActivityGame />
        </LayoutWrapper>
      }
    />
    <Route
      path="/GrowthAreas/:childId/Activity/:activity"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <GrowthAreasActivity />
        </LayoutWrapper>
      }
    />
    <Route
      path="/GrowthAreas/:childId"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <Pages.GrowthAreas />
        </LayoutWrapper>
      }
    />
    {/* Legacy routes without childId */}
    <Route
      path="/GrowthAreas/Activity/:activity/GreatInsights"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <GrowthAreasActivityGreatInsights />
        </LayoutWrapper>
      }
    />
    <Route
      path="/GrowthAreas/Activity/:activity/Game"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <GrowthAreasActivityGame />
        </LayoutWrapper>
      }
    />
    <Route
      path="/GrowthAreas/Activity/:activity"
      element={
        <LayoutWrapper currentPageName="GrowthAreas">
          <GrowthAreasActivity />
        </LayoutWrapper>
      }
    />
    {Object.entries(Pages).map(([path, Page]) => (
      <Route
        key={path}
        path={`/${path}`}
        element={
          <LayoutWrapper currentPageName={path}>
            <Page />
          </LayoutWrapper>
        }
      />
    ))}
    <Route path="*" element={<PageNotFound />} />
  </Routes>
);

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function AppShell() {
  const location = useLocation();
  const { isLoadingAuth, authError, isAuthenticated, checkAppState } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (authError?.type === 'unknown') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6">
        <p className="max-w-lg text-center text-foreground">{authError.message}</p>
        <Button
          type="button"
          className="bg-primary hover:bg-primary/80"
          onClick={() => {
            void checkAppState();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const isPublic = PUBLIC_PATHS.includes(location.pathname);

  if (isPublic) {
    return (
      <Routes>
        <Route path="/Login" element={<Login />} />
        <Route path="/Register" element={<Register />} />
        <Route path="*" element={<Navigate to="/Login" replace />} />
      </Routes>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/Login" replace state={{ from: location.pathname }} />;
  }

  return <ProtectedRoutes />;
}

function App() {
  // Apply theme from localStorage on every React mount (covers all routes, including
  // Login/Register where Layout doesn't render). The inline script in index.html
  // handles zero-flash on hard reload; this catches Vite HMR and in-app navigations.
  useEffect(() => {
    applyTheme(readStoredDarkMode());
  }, []);

  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ScrollToTop />
        <AuthProvider>
          <NavigationTracker />
          <ErrorBoundary>
            <AppShell />
          </ErrorBoundary>
        </AuthProvider>
        <SonnerToaster position="bottom-center" />
      </Router>
    </QueryClientProvider>
  );
}

export default App;
