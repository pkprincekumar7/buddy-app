import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import type { UserRecord } from '@/types/api';

const USER_ROLES = { ADMIN: 'admin' };

interface AuthData {
  user: UserRecord | null;
  isAuthenticated: boolean;
}

export default function PageNotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const pageName = location.pathname.substring(1);

  const { data: authData, isFetched } = useQuery<AuthData>({
    queryKey: ['user'],
    queryFn: async () => {
      try {
        const user = await api.auth.me();
        return { user, isAuthenticated: true };
      } catch {
        return { user: null, isAuthenticated: false };
      }
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="space-y-6 text-center">
          {/* 404 Error Code */}
          <div className="space-y-2">
            <h1 className="text-7xl font-light text-slate-600">404</h1>
            <div className="border-edge mx-auto h-0.5 w-16" />
          </div>

          {/* Main Message */}
          <div className="space-y-3">
            <h2 className="text-2xl font-medium text-white">Page Not Found</h2>
            <p className="leading-relaxed text-slate-400">
              The page <span className="font-medium text-slate-300">"{pageName}"</span> could not be
              found in this application.
            </p>
          </div>

          {/* Admin Note */}
          {isFetched && authData?.isAuthenticated && authData.user?.role === USER_ROLES.ADMIN && (
            <div className="border-edge mt-8 rounded-lg bg-surface-elevated p-4">
              <div className="flex items-start space-x-3">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-500/10">
                  <div className="h-2 w-2 rounded-full bg-orange-400" />
                </div>
                <div className="space-y-1 text-left">
                  <p className="text-sm font-medium text-slate-300">Admin Note</p>
                  <p className="text-sm leading-relaxed text-slate-400">
                    This could mean that the AI hasn't implemented this page yet. Ask it to
                    implement it in the chat.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-6">
            <button
              onClick={() => navigate('/')}
              className="border-edge hover:bg-subtle hover:border-edge-strong inline-flex items-center rounded-lg bg-surface-elevated px-4 py-2 text-sm font-medium text-slate-300 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-white/[0.20] focus:ring-offset-2"
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Go Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
