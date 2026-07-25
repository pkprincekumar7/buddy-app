import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { unlockIOSSpeechSynthesis } from '@/lib/tts';
import { getInitials } from '@/lib/avatarUtils';
import { Home, LogOut, VolumeX, Volume2, Mail, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatePresence } from 'framer-motion';
import { ConfirmModal } from '@/components/shared/StartOverButton';
import { useStartOver } from '@/hooks/useStartOver';

interface LayoutProps {
  children: ReactNode;
  currentPageName?: string;
}

// Extract childId from paths like /PageName/:childId or /PageName/:childId/...
function useNavChildId() {
  const { pathname } = useLocation();
  const match = /^\/[^/]+\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export default function Layout({ children, currentPageName }: LayoutProps) {
  const { user, isAuthenticated, childProfiles: _childProfiles, logout } = useAuth();
  const navChildId = useNavChildId();
  const { doStartOver, isStartingOver } = useStartOver(navChildId ?? undefined);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);

  // Global TTS control and cleanup on load
  useEffect(() => {
    if (typeof window !== 'undefined') window.speechSynthesis.cancel();
  }, []);

  // iOS Safari blocks speechSynthesis unless it's first triggered from a user gesture.
  // Speak a silent utterance on the very first tap/click to unlock it for async use.
  useEffect(() => {
    const unlock = () => unlockIOSSpeechSynthesis();
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, []);

  // Stop TTS when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && typeof window !== 'undefined') window.speechSynthesis.cancel();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
    if (!ttsEnabled && typeof window !== 'undefined') window.speechSynthesis.cancel();
  }, [ttsEnabled]);

  /** After login, load saved voice + theme preferences from DB. */
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const prefs = (await api.preferences.get()) as {
          tts_enabled?: boolean;
        };
        if (!cancelled) {
          if (typeof prefs.tts_enabled === 'boolean') setTtsEnabled(prefs.tts_enabled);
        }
      } catch (err) {
        console.warn('[Layout] Could not load preferences:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  /** Close profile panel on Escape. */
  useEffect(() => {
    if (!profileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [profileOpen]);

  /** Close profile panel on click outside. */
  useEffect(() => {
    if (!profileOpen) return;
    const handleOutside = (e: globalThis.MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [profileOpen]);

  /** Speaker click: optimistic UI + persist so next session matches. */
  const handleToggleTts = useCallback(async () => {
    const next = !ttsEnabledRef.current;
    setTtsEnabled(next);
    try {
      await api.preferences.patch({ tts_enabled: next });
    } catch (err) {
      console.warn('[Layout] Could not persist TTS toggle:', err);
    }
  }, []);

  const handleLogout = useCallback(() => {
    void logout(true);
  }, [logout]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center gap-2.5">
              <div className="glow-teal-sm flex h-8 w-8 items-center justify-center rounded-full bg-primary">
                <svg viewBox="0 0 20 22" className="h-5 w-5">
                  <line
                    x1="10"
                    y1="21"
                    x2="10"
                    y2="14"
                    stroke="#0d3d2e"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z"
                    fill="#0d3d2e"
                  />
                  <path
                    d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z"
                    fill="#0d3d2e"
                  />
                </svg>
              </div>
              <div className="hidden flex-col sm:flex">
                <span className="text-lg font-bold leading-tight tracking-tight text-sidebar-foreground">
                  Buddy<span className="text-primary">360</span>
                </span>
                <span className="text-[9px] font-semibold uppercase leading-tight tracking-[0.18em] text-muted-foreground/60">
                  Children's Development
                </span>
              </div>
            </Link>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* TTS Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  void handleToggleTts();
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
                title={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
                aria-label={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
                aria-pressed={ttsEnabled}
              >
                {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>

              {/* Start Over — shown on child-specific pages only */}
              {isAuthenticated && navChildId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmingStartOver(true)}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Start Over"
                  aria-label="Start Over"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}

              {/* Profile Avatar — authenticated */}
              {isAuthenticated && (
                <div className="relative" ref={profileRef}>
                  <button
                    onClick={() => setProfileOpen((prev) => !prev)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-medium to-success text-xs font-bold text-white ring-2 ring-transparent transition-all hover:scale-105 hover:ring-primary/40"
                    title="Your profile"
                    aria-label="Your profile"
                    aria-expanded={profileOpen}
                    aria-haspopup="true"
                  >
                    {getInitials(user?.full_name ?? user?.email ?? '?')}
                  </button>

                  {profileOpen && (
                    <div
                      role="dialog"
                      aria-label="User profile"
                      className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl"
                    >
                      {/* Header gradient strip */}
                      <div className="bg-gradient-to-r from-primary-dark/30 to-success-strong/20 px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-medium to-success text-lg font-bold text-white shadow-lg">
                            {getInitials(user?.full_name ?? user?.email ?? '?')}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-card-foreground">
                              {user?.full_name ?? 'User'}
                            </p>
                            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0" />
                              {user?.email ?? ''}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="border-t border-border" />

                      {/* Navigation + actions */}
                      <div className="p-2">
                        <Link
                          to={createPageUrl('Home')}
                          onClick={() => setProfileOpen(false)}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-accent ${
                            currentPageName === 'Home' ? 'text-primary' : 'text-muted-foreground'
                          }`}
                        >
                          <Home className="h-4 w-4" />
                          Home
                        </Link>
                        <button
                          onClick={() => {
                            setProfileOpen(false);
                            handleLogout();
                          }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-error-medium/10 hover:text-error"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sign In — unauthenticated only */}
              {!isAuthenticated && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void api.auth.redirectToLogin();
                  }}
                  className="border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Sign In
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      {children}

      <AnimatePresence>
        {confirmingStartOver && (
          <ConfirmModal
            onCancel={() => setConfirmingStartOver(false)}
            onConfirm={() => {
              setConfirmingStartOver(false);
              void doStartOver();
            }}
            isStartingOver={isStartingOver}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
