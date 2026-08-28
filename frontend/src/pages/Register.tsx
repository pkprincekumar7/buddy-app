import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
          statusMessages: {
            409: 'This email is already registered.',
            403: 'This email address is not authorized to register. Please contact support.',
          },
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
          <h1 className="text-2xl font-bold text-foreground">Create account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose an email and password for Buddy360
          </p>
        </div>

        <form
          onSubmit={(ev) => {
            void onSubmit(ev);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="reg-name" className="mb-1 block text-foreground">
              Full name
            </Label>
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
            <Label htmlFor="reg-email" className="mb-1 block text-foreground">
              Username (email)
            </Label>
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
            <Label htmlFor="reg-country" className="mb-1 block text-foreground">
              Country
            </Label>
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
            <p className="mt-1 text-xs text-muted-foreground">
              Determines where your data is stored to comply with local privacy laws.
            </p>
          </div>
          <div>
            <Label htmlFor="reg-password" className="mb-1 block text-foreground">
              Password
            </Label>
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
            <Label htmlFor="reg-confirm" className="mb-1 block text-foreground">
              Confirm password
            </Label>
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
          {error ? <p className="text-sm text-error-strong">{error}</p> : null}
          <Button type="submit" variant="action" className="w-full" disabled={busy}>
            {busy ? 'Creating account…' : 'Register'}
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/Login" className="font-medium text-primary hover:text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
