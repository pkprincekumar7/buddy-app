import { Link, useLocation } from 'react-router';
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

// Maps a page's currentPageName to the seven-circle node label that leads to
// it, so the header shows the same text as the circle the user tapped.
const CIRCLE_LABELS: Record<string, string> = {
  Connect: 'Connect',
  PersonalityProfile: 'Discover',
  LifePathway: 'Transform',
  GrowthAreas: 'Grow',
  Observations: 'Release',
};

// Extract childId from paths like /PageName/:childId or /PageName/:childId/...
function useNavChildId() {
  const { pathname } = useLocation();
  const match = /^\/[^/]+\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export default function Layout({ children, currentPageName }: LayoutProps) {
  const {
    user,
    isAuthenticated,
    childProfiles: _childProfiles,
    logout,
    ttsEnabled,
    toggleTts,
  } = useAuth();
  const navChildId = useNavChildId();
  const { doStartOver, isStartingOver } = useStartOver(navChildId ?? undefined);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
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

  // Cancel any in-progress speech when TTS is disabled
  useEffect(() => {
    if (!ttsEnabled && typeof window !== 'undefined') window.speechSynthesis.cancel();
  }, [ttsEnabled]);

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

  const handleLogout = useCallback(() => {
    void logout(true);
  }, [logout]);

  const circleLabel = currentPageName ? CIRCLE_LABELS[currentPageName] : undefined;

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        {/*
          Full-bleed on purpose — a max-w cap here pinned the wordmark and the
          controls ~350px in from the edges on a 1920 display. Padding only, and
          responsive rather than the mockups' flat 40px, which would eat a quarter
          of a 375px header. Does not align with page content, which is centred at
          its own max-width; the design mockups do the same.
        */}
        <div className="px-4 sm:px-6 lg:px-10">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center gap-2.5">
              <div
                className="h-8 w-8 flex-shrink-0 rounded-full"
                style={{
                  background: 'radial-gradient(circle at 35% 30%,#eafdff,#4be9ff 45%,#0a5b74 100%)',
                  boxShadow: '0 0 16px rgba(75,233,255,.7)',
                }}
              />
              {/*
                Stacks below the sm breakpoint: the wordmark and the circle chip
                side by side don't fit next to the right-hand controls on a 375px
                header, so the chip drops onto a second line rather than the whole
                block being hidden.
              */}
              <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2.5">
                <span
                  className="whitespace-nowrap leading-none text-sidebar-foreground"
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 900,
                    fontSize: 14,
                    letterSpacing: '.06em',
                  }}
                >
                  SUPERPOWER
                </span>
                {circleLabel && (
                  <>
                    {/* Row-only separator — a vertical rule reads as noise once stacked. */}
                    <span
                      className="hidden h-4 w-px sm:block"
                      style={{ background: 'rgba(75,233,255,.25)' }}
                    />
                    <span
                      className="whitespace-nowrap leading-none"
                      style={{
                        // Explicit, not inherited: in the design mockups the page
                        // root sets Rajdhani and the header picks it up, but here
                        // the header sits outside each page's root element, so
                        // without this it falls back to the Tailwind sans stack
                        // and this chip alone renders in the wrong typeface.
                        fontFamily: 'Rajdhani, sans-serif',
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: '.22em',
                        textTransform: 'uppercase',
                        color: '#4be9ff',
                      }}
                    >
                      {circleLabel}
                    </span>
                  </>
                )}
              </div>
            </Link>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* TTS Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  toggleTts();
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
