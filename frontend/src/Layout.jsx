import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { unlockIOSSpeechSynthesis } from '@/lib/tts';
import { Home, LogOut, VolumeX, Volume2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Extracts up to two initials from a display name or email. */
function getInitials(name) {
  if (!name?.trim()) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function Layout({ children, currentPageName }) {
  const { user, isAuthenticated, childProfiles: _childProfiles, logout } = useAuth();
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

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

  /** After login, load saved voice toggle from DB. */
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const prefs = await api.preferences.get();
        if (!cancelled && typeof prefs.tts_enabled === 'boolean') {
          setTtsEnabled(prefs.tts_enabled);
        }
      } catch (err) {
        console.warn('[Layout] Could not load TTS preference:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  /** Close profile panel on Escape. */
  useEffect(() => {
    if (!profileOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [profileOpen]);

  /** Close profile panel on click outside. */
  useEffect(() => {
    if (!profileOpen) return;
    const handleOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
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
    logout(true);
  }, [logout]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center gap-2.5">
              <div className="glow-teal-sm flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600">
                <span className="text-sm font-bold text-white">B</span>
              </div>
              <span className="hidden text-lg font-bold tracking-tight text-white sm:block">
                Buddy360
              </span>
            </Link>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* TTS Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleTts}
                className="hover:bg-subtle text-slate-400 hover:text-white"
                title={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
              >
                {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>

              {/* Profile Avatar — authenticated */}
              {isAuthenticated && (
                <div className="relative" ref={profileRef}>
                  <button
                    onClick={() => setProfileOpen((prev) => !prev)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-xs font-bold text-white ring-2 ring-transparent transition-all hover:scale-105 hover:ring-teal-500/40"
                    title="Your profile"
                    aria-label="Your profile"
                    aria-expanded={profileOpen}
                    aria-haspopup="true"
                  >
                    {getInitials(user?.full_name || user?.email || '?')}
                  </button>

                  {profileOpen && (
                    <div
                      role="dialog"
                      aria-label="User profile"
                      className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-surface-elevated shadow-2xl"
                    >
                      {/* Header gradient strip */}
                      <div className="bg-gradient-to-r from-teal-600/30 to-emerald-600/20 px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-lg font-bold text-white shadow-lg">
                            {getInitials(user?.full_name || user?.email || '?')}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-white">
                              {user?.full_name || 'User'}
                            </p>
                            <p className="flex items-center gap-1 truncate text-xs text-slate-400">
                              <Mail className="h-3 w-3 shrink-0" />
                              {user?.email || ''}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="border-t border-white/10" />

                      {/* Navigation + actions */}
                      <div className="p-2">
                        <Link
                          to={createPageUrl('Home')}
                          onClick={() => setProfileOpen(false)}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                            currentPageName === 'Home' ? 'text-teal-400' : 'text-slate-300'
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
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
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
                  onClick={() => api.auth.redirectToLogin()}
                  className="border-edge-strong hover:bg-subtle text-slate-300 hover:text-white"
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

Layout.propTypes = {
  children: PropTypes.node.isRequired,
  currentPageName: PropTypes.string,
};
