import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { COUNTRIES } from '@/lib/countries';
import { httpErrorMessage } from '@/lib/apiError';
import { MODAL_BACKDROP } from '@/lib/animations';

export default function Login() {
  const { checkAppState } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  // Google new-user flow: when the backend returns country_code_required,
  // we hold the id_token and show a country selector before retrying.
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null);
  const [googleCountry, setGoogleCountry] = useState('');
  const [googleCountryBusy, setGoogleCountryBusy] = useState(false);

  const onGoogleCountrySubmit = async () => {
    if (!googleCountry || !pendingGoogleToken) return;
    setError('');
    setLoadingMessage('Completing sign-in…');
    setGoogleCountryBusy(true);
    try {
      await api.auth.google(pendingGoogleToken, googleCountry);
      await checkAppState({ withLoading: false });
    } catch (e) {
      setError(httpErrorMessage(e as Error | undefined, { fallback: 'Google sign-in failed.' }));
      setPendingGoogleToken(null);
      setGoogleCountry('');
    } finally {
      setGoogleCountryBusy(false);
    }
  };

  useEffect(() => {
    if (!googleClientId) return;

    const onCredential = async (response: { credential?: string }) => {
      const idToken = response?.credential;
      if (!idToken) return;
      setError('');
      setPendingGoogleToken(null);
      setGoogleCountry('');
      setLoadingMessage('Signing in with Google…');
      setBusy(true);
      try {
        await api.auth.google(idToken);
        await checkAppState({ withLoading: false });
      } catch (e) {
        const apiErr = e as { status?: number; detail?: unknown } | null;
        const detailCode =
          apiErr?.detail !== null && typeof apiErr?.detail === 'object'
            ? (apiErr.detail as Record<string, unknown>)['code']
            : undefined;
        if (apiErr?.status === 422 && detailCode === 'country_code_required') {
          setPendingGoogleToken(idToken);
        } else {
          const msg = httpErrorMessage(e as Error | undefined, {
            fallback: 'Google sign-in failed.',
          });
          setError(msg.includes('503') ? 'Google sign-in is not configured on the server.' : msg);
        }
      } finally {
        setBusy(false);
      }
    };

    const googleWindow = window as typeof window & {
      google?: {
        accounts?: {
          id?: {
            initialize: (o: Record<string, unknown>) => void;
            renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
          };
        };
      };
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-buddy-google-gsi]');
    const script: HTMLScriptElement = existing ?? document.createElement('script');
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset['buddyGoogleGsi'] = 'true';
      document.body.appendChild(script);
    }

    const init = () => {
      if (!googleWindow.google?.accounts?.id) return;
      const el = googleBtnRef.current;
      if (!el) return;
      el.replaceChildren();
      googleWindow.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: onCredential,
        auto_select: false,
      });
      googleWindow.google.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
      });
    };

    const run = () => requestAnimationFrame(init);

    if (googleWindow.google?.accounts?.id) {
      run();
    } else {
      script.addEventListener('load', run, { once: true });
    }
  }, [googleClientId, checkAppState, pendingGoogleToken]);

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError('');
    setLoadingMessage('Signing you in…');
    setBusy(true);
    try {
      await api.auth.login(email.trim(), password);
      await checkAppState({ withLoading: false });
    } catch (e) {
      setError(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Sign-in failed.',
          statusMessages: { 401: 'Invalid email or password.' },
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="border-edge w-full max-w-md rounded-2xl bg-card p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-medium to-success">
            <span className="text-lg font-bold text-white">LP</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Buddy360 — continue to your pathway</p>
        </div>

        {!pendingGoogleToken && (
          <>
            <form
              onSubmit={(ev) => {
                void onSubmit(ev);
              }}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="login-email"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
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
                <label
                  htmlFor="login-password"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
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
              {error ? <p className="text-sm text-error-strong">{error}</p> : null}
              <Button
                type="submit"
                className="w-full bg-primary-action hover:bg-primary-action/80"
                disabled={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            {googleClientId ? (
              <div className="mt-6 flex flex-col items-center gap-2">
                <p className="text-xs text-muted-foreground">or</p>
                <div ref={googleBtnRef} className="flex min-h-[40px] justify-center" />
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Google sign-in: set{' '}
                <code className="bg-ghost-strong rounded px-1">VITE_GOOGLE_CLIENT_ID</code> and{' '}
                <code className="bg-ghost-strong rounded px-1">GOOGLE_CLIENT_ID</code> on the API.
              </p>
            )}
          </>
        )}

        {pendingGoogleToken ? (
          <div className="bg-brand-sub mt-6 rounded-xl border border-primary/25 p-4">
            <p className="mb-3 text-sm font-medium text-foreground">One more step</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Select your country so we can store your data in the right region.
            </p>
            {error ? <p className="mb-3 text-sm text-error">{error}</p> : null}
            <select
              value={googleCountry}
              onChange={(e) => setGoogleCountry(e.target.value)}
              className="form-input mb-3 text-sm"
            >
              <option value="" disabled>
                Select your country…
              </option>
              {COUNTRIES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  void onGoogleCountrySubmit();
                }}
                disabled={!googleCountry || googleCountryBusy}
                className="flex-1 bg-primary-action text-sm hover:bg-primary-action/80"
              >
                {googleCountryBusy ? 'Signing in…' : 'Continue'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPendingGoogleToken(null);
                  setGoogleCountry('');
                  setError('');
                }}
                disabled={googleCountryBusy}
                className="text-sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <p className="mt-8 text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link to="/Register" className="font-medium text-primary hover:text-primary">
            Create an account
          </Link>
        </p>
      </div>

      {/* Full-screen loading overlay — fades in over the whole page during sign-in */}
      <AnimatePresence>
        {(busy || googleCountryBusy) && (
          <motion.div
            {...MODAL_BACKDROP}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background/95 backdrop-blur-sm"
          >
            {/* Dual-ring spinner */}
            <div className="relative h-20 w-20">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary-medium" />
              <div
                className="absolute inset-2 animate-spin rounded-full border-4 border-transparent border-t-success-bright"
                style={{ animationDuration: '0.75s', animationDirection: 'reverse' }}
              />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4, ease: 'easeOut' }}
              className="space-y-1 text-center"
            >
              <p className="text-base font-semibold text-foreground">{loadingMessage}</p>
              <p className="text-sm text-muted-foreground">Please wait a moment…</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
