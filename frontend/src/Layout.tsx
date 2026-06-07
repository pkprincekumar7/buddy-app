import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { unlockIOSSpeechSynthesis } from '@/lib/tts';
import { getInitials } from '@/lib/avatarUtils';
import { readStoredDarkMode, applyTheme } from '@/lib/theme';
import { Home, LogOut, VolumeX, Volume2, Mail, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LayoutProps {
  children: ReactNode;
  currentPageName?: string;
}

export default function Layout({ children, currentPageName }: LayoutProps) {
  const { user, isAuthenticated, childProfiles: _childProfiles, logout } = useAuth();
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  const [darkMode, setDarkMode] = useState(readStoredDarkMode);
  // Initialise ref in sync with state so handleToggleDarkMode is correct before first useEffect.
  const darkModeRef = useRef(readStoredDarkMode());
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

  /** Sync dark/light class on <html> + localStorage whenever darkMode changes. */
  useEffect(() => {
    darkModeRef.current = darkMode;
    applyTheme(darkMode);
  }, [darkMode]);

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
          dark_mode?: boolean;
        };
        if (!cancelled) {
          if (typeof prefs.tts_enabled === 'boolean') setTtsEnabled(prefs.tts_enabled);
          if (typeof prefs.dark_mode === 'boolean') setDarkMode(prefs.dark_mode);
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

  /** Theme toggle: optimistic UI + persist so next session matches. */
  const handleToggleDarkMode = useCallback(async () => {
    const next = !darkModeRef.current;
    setDarkMode(next);
    try {
      await api.preferences.patch({ dark_mode: next });
    } catch (err) {
      console.warn('[Layout] Could not persist theme toggle:', err);
    }
  }, []);

  const handleLogout = useCallback(() => {
    void logout(true);
  }, [logout]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center gap-2.5">
              <div className="glow-teal-sm flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-dark">
                <span className="text-sm font-bold text-white">B</span>
              </div>
              <span className="hidden text-lg font-bold tracking-tight text-sidebar-foreground sm:block">
                Buddy360
              </span>
            </Link>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* Dark / Light mode toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  void handleToggleDarkMode();
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-pressed={darkMode}
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

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
    </div>
  );
}
