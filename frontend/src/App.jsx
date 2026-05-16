import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import GoalsDashboard from './pages/GoalsDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import { Button } from '@/components/ui/button';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const ProtectedRoutes = () => (
  <Routes>
    <Route path="/" element={
      <LayoutWrapper currentPageName={mainPageKey}>
        <MainPage />
      </LayoutWrapper>
    } />
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
    <Route path="/GoalsDashboard" element={<LayoutWrapper currentPageName="GoalsDashboard"><GoalsDashboard /></LayoutWrapper>} />
    <Route path="*" element={<PageNotFound />} />
  </Routes>
);

function AppShell() {
  const location = useLocation();
  const {
    isLoadingAuth,
    authError,
    isAuthenticated,
    checkAppState,
  } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/[0.10] border-t-white rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'unknown') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0a] p-6">
        <p className="max-w-lg text-center text-slate-300">{authError.message}</p>
        <Button type="button" className="bg-teal-600 hover:bg-teal-700" onClick={() => checkAppState()}>
          Retry
        </Button>
      </div>
    );
  }

  const isPublic = location.pathname === '/Login' || location.pathname === '/Register';

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
        <AuthProvider>
          <NavigationTracker />
          <AppShell />
        </AuthProvider>
        <Toaster />
        <SonnerToaster position="bottom-center" />
      </Router>
    </QueryClientProvider>
  )
}

export default App
