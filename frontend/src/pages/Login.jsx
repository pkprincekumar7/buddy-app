import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { COUNTRIES } from '@/lib/countries';
import { httpErrorMessage } from '@/lib/apiError';

export default function Login() {
  const { checkAppState } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const googleBtnRef = useRef(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  // Google new-user flow: when the backend returns country_code_required,
  // we hold the id_token and show a country selector before retrying.
  const [pendingGoogleToken, setPendingGoogleToken] = useState(null);
  const [googleCountry, setGoogleCountry] = useState('');
  const [googleCountryBusy, setGoogleCountryBusy] = useState(false);

  const onGoogleCountrySubmit = async () => {
    if (!googleCountry || !pendingGoogleToken) return;
    setError('');
    setGoogleCountryBusy(true);
    try {
      await api.auth.google(pendingGoogleToken, googleCountry);
      await checkAppState({ withLoading: false });
    } catch (e) {
      setError(httpErrorMessage(e, { fallback: 'Google sign-in failed.' }));
      setPendingGoogleToken(null);
      setGoogleCountry('');
    } finally {
      setGoogleCountryBusy(false);
    }
  };

  useEffect(() => {
    if (!googleClientId) return;

    const onCredential = async (response) => {
      const idToken = response?.credential;
      if (!idToken) return;
      setError('');
      setPendingGoogleToken(null);
      setGoogleCountry('');
      setBusy(true);
      try {
        await api.auth.google(idToken);
        await checkAppState({ withLoading: false });
      } catch (e) {
        if (e?.status === 422 && e?.detail?.code === 'country_code_required') {
          setPendingGoogleToken(idToken);
        } else {
          const msg = httpErrorMessage(e, { fallback: 'Google sign-in failed.' });
          setError(msg.includes('503') ? 'Google sign-in is not configured on the server.' : msg);
        }
      } finally {
        setBusy(false);
      }
    };

    const existing = document.querySelector('script[data-buddy-google-gsi]');
    const script = existing || document.createElement('script');
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.buddyGoogleGsi = 'true';
      document.body.appendChild(script);
    }

    const init = () => {
      if (!window.google?.accounts?.id) return;
      const el = googleBtnRef.current;
      if (!el) return;
      el.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: onCredential,
        auto_select: false,
      });
      window.google.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
      });
    };

    const run = () => requestAnimationFrame(init);

    if (window.google?.accounts?.id) {
      run();
    } else {
      script.addEventListener('load', run, { once: true });
    }
  }, [googleClientId, checkAppState, pendingGoogleToken]);

  const onSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.auth.login(email.trim(), password);
      await checkAppState({ withLoading: false });
    } catch (e) {
      setError(httpErrorMessage(e, { fallback: 'Sign-in failed.', statusMessages: { 401: 'Invalid email or password.' } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border-edge bg-card p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500">
            <span className="text-lg font-bold text-white">LP</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Sign in</h1>
          <p className="mt-1 text-sm text-slate-400">Buddy360 — continue to your pathway</p>
        </div>

        {!pendingGoogleToken && (
          <>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-slate-300">
                  Username (email)
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-slate-300">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input"
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            {googleClientId ? (
              <div className="mt-6 flex flex-col items-center gap-2">
                <p className="text-xs text-slate-500">or</p>
                <div ref={googleBtnRef} className="flex min-h-[40px] justify-center" />
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-slate-400">
                Google sign-in: set <code className="rounded bg-ghost-strong px-1">VITE_GOOGLE_CLIENT_ID</code> and{' '}
                <code className="rounded bg-ghost-strong px-1">GOOGLE_CLIENT_ID</code> on the API.
              </p>
            )}
          </>
        )}

        {pendingGoogleToken ? (
          <div className="mt-6 rounded-xl border border-teal-500/25 bg-brand-sub p-4">
            <p className="mb-3 text-sm font-medium text-white">One more step</p>
            <p className="mb-3 text-xs text-slate-400">
              Select your country so we can store your data in the right region.
            </p>
            {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
            <select
              value={googleCountry}
              onChange={(e) => setGoogleCountry(e.target.value)}
              className="form-input mb-3 text-sm"
            >
              <option value="" disabled>Select your country…</option>
              {COUNTRIES.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                onClick={onGoogleCountrySubmit}
                disabled={!googleCountry || googleCountryBusy}
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-sm"
              >
                {googleCountryBusy ? 'Signing in…' : 'Continue'}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setPendingGoogleToken(null); setGoogleCountry(''); setError(''); }}
                disabled={googleCountryBusy}
                className="text-sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <p className="mt-8 text-center text-sm text-slate-400">
          New here?{' '}
          <Link to="/Register" className="font-medium text-teal-700 hover:text-teal-800">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
