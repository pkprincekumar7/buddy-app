import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { COUNTRIES } from '@/lib/countries';
import { httpErrorMessage } from '@/lib/apiError';

export default function Register() {
  const { checkAppState } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError('');
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!countryCode) {
      setError('Please select your country.');
      return;
    }
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirm) {
      setError('Password and confirmation do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.auth.register(email.trim(), password, fullName.trim(), countryCode);
      await checkAppState({ withLoading: false });
    } catch (e) {
      setError(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Registration failed.',
          statusMessages: { 409: 'That email is already registered.' },
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
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500">
            <span className="text-lg font-bold text-white">LP</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Create account</h1>
          <p className="mt-1 text-sm text-slate-400">Choose an email and password for Buddy360</p>
        </div>

        <form
          onSubmit={(ev) => {
            void onSubmit(ev);
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="reg-name" className="mb-1 block text-sm font-medium text-slate-300">
              Full name
            </label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              placeholder="e.g. Sarah Johnson"
              required
              maxLength={255}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="reg-email" className="mb-1 block text-sm font-medium text-slate-300">
              Username (email)
            </label>
            <input
              id="reg-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="reg-country" className="mb-1 block text-sm font-medium text-slate-300">
              Country
            </label>
            <select
              id="reg-country"
              required
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="form-input"
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
            <p className="mt-1 text-xs text-slate-400">
              Determines where your data is stored to comply with local privacy laws.
            </p>
          </div>
          <div>
            <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="reg-confirm" className="mb-1 block text-sm font-medium text-slate-300">
              Confirm password
            </label>
            <input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="form-input"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={busy}>
            {busy ? 'Creating account…' : 'Register'}
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/Login" className="font-medium text-teal-700 hover:text-teal-800">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
