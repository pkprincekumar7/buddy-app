import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { unlockIOSSpeechSynthesis } from '@/lib/tts';
import { Home, LogOut, Menu, X, VolumeX, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [{ label: 'Home', icon: Home, path: 'Home' }];

export default function Layout({ children, currentPageName }) {
  const { user, isAuthenticated, childProfiles, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);

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

            {/* Desktop Navigation */}
            <div className="hidden items-center gap-1 md:flex">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.path}
                  to={createPageUrl(item.path)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 transition-all duration-200 ${
                    currentPageName === item.path
                      ? 'bg-teal-500/10 font-medium text-teal-400'
                      : 'hover:bg-subtle text-slate-400 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
              {isAuthenticated && (
                <button
                  onClick={handleLogout}
                  className="hover:bg-subtle flex items-center gap-2 rounded-xl px-4 py-2 text-slate-400 transition-all duration-200 hover:text-red-400"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </button>
              )}
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

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* TTS Toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleTts}
                className="hover:bg-subtle text-slate-400 hover:text-white"
                title={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
              >
                {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>

              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="hover:bg-subtle text-slate-400 hover:text-white md:hidden"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile / Tablet Menu */}
        {mobileMenuOpen && (
          <div className="border-t-edge-faint bg-sidebar md:hidden">
            <div className="space-y-1 px-4 py-3">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.path}
                  to={createPageUrl(item.path)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 ${
                    currentPageName === item.path
                      ? 'bg-teal-500/10 font-medium text-teal-400'
                      : 'hover:bg-subtle text-slate-400 hover:text-white'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              ))}
              {isAuthenticated ? (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="hover:bg-subtle flex w-full items-center gap-3 rounded-xl px-4 py-3 text-slate-400 transition-all duration-200 hover:text-red-400"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Logout</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    api.auth.redirectToLogin();
                  }}
                  className="hover:bg-subtle flex w-full items-center gap-3 rounded-xl px-4 py-3 text-slate-400 transition-all duration-200 hover:text-white"
                >
                  <span>Sign In</span>
                </button>
              )}
            </div>
          </div>
        )}
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
