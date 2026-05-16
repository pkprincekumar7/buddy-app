import { Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { unlockIOSSpeechSynthesis } from '@/lib/tts';
import { Home, LogOut, Menu, X, VolumeX, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Layout({ children, currentPageName }) {
  const { user, isAuthenticated, childProfiles, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);

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
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  /** Speaker click: optimistic UI + persist so next session matches. */
  const handleToggleTts = async () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    try {
      await api.preferences.patch({ tts_enabled: next });
    } catch {
      /* keep optimistic toggle */
    }
  };


  const navItems = [
    { label: 'Home', icon: Home, path: 'Home', show: true },
  ].filter(item => item.show);

  const handleLogout = () => {
    logout(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Top Navigation */}
      <nav className="bg-[#0f0f0f]/90 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal-sm">
                <span className="text-white font-bold text-sm">B</span>
              </div>
              <span className="font-bold text-white text-lg hidden sm:block tracking-tight">Buddy360</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={createPageUrl(item.path)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 ${
                    currentPageName === item.path
                      ? 'bg-teal-500/10 text-teal-400 font-medium'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
              {isAuthenticated && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 text-slate-400 hover:bg-white/[0.05] hover:text-red-400"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout</span>
                </button>
              )}
              {!isAuthenticated && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => api.auth.redirectToLogin()}
                  className="border-white/[0.12] text-slate-300 hover:bg-white/[0.05] hover:text-white"
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
                className="text-slate-400 hover:text-white hover:bg-white/[0.05]"
                title={ttsEnabled ? "Turn off voice" : "Turn on voice"}
              >
                {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </Button>

              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden text-slate-400 hover:text-white hover:bg-white/[0.05]"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile / Tablet Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-[#0f0f0f]">
            <div className="px-4 py-3 space-y-1">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={createPageUrl(item.path)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    currentPageName === item.path
                      ? 'bg-teal-500/10 text-teal-400 font-medium'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </Link>
              ))}
              {isAuthenticated ? (
                <button
                  onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-white/[0.05] hover:text-red-400 transition-all duration-200"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Logout</span>
                </button>
              ) : (
                <button
                  onClick={() => { setMobileMenuOpen(false); api.auth.redirectToLogin(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-white/[0.05] hover:text-white transition-all duration-200"
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