import { useEffect, Component } from 'react';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import NavigationTracker from '@/lib/NavigationTracker';
import { pagesConfig } from './pages.config';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from './pages/Login';
import Register from './pages/Register';
import { Button } from '@/components/ui/button';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6">
          <p className="max-w-lg text-center text-slate-300">
            Something went wrong. Please refresh the page.
          </p>
          <Button
            type="button"
            className="bg-teal-600 hover:bg-teal-700"
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

const PUBLIC_PATHS = ['/Login', '/Register'];

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : null;

const LayoutWrapper = ({ children, currentPageName }) =>
  Layout ? <Layout currentPageName={currentPageName}>{children}</Layout> : <>{children}</>;

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
        <div className="border-c-md h-8 w-8 animate-spin rounded-full border-2 border-t-white"></div>
      </div>
    );
  }

  if (authError?.type === 'unknown') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6">
        <p className="max-w-lg text-center text-slate-300">{authError.message}</p>
        <Button
          type="button"
          className="bg-teal-600 hover:bg-teal-700"
          onClick={() => checkAppState()}
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
