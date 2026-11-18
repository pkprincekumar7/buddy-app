import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import { account } from '@/api/account';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { COUNTRIES } from '@/lib/countries';
import { httpErrorMessage } from '@/lib/apiError';

export default function Register() {
  const { checkAppState } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address, setAddress] = useState(['', '', '']);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError('');
    if (!firstName.trim()) {
      setError('Please enter your first name.');
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
    // The server's limit: bcrypt reads 72 bytes of UTF-8, so more would be ignored.
    if (new TextEncoder().encode(password).length > 72) {
      setError('Password must be at most 72 characters (fewer with accents or emoji).');
      return;
    }
    setBusy(true);
    try {
      const optional = (value: string) => value.trim() || null;
      await account.register(email.trim(), password, countryCode, {
        first_name: firstName.trim(),
        middle_name: optional(middleName),
        last_name: optional(lastName),
        address_line_one: optional(address[0] ?? ''),
        address_line_two: optional(address[1] ?? ''),
        address_line_three: optional(address[2] ?? ''),
      });
      await checkAppState({ withLoading: false });
    } catch (e) {
      setError(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Registration failed.',
          codeMessages: {
            email_taken: 'This email is already registered.',
            registration_closed:
              'This email address is not authorized to register. Please contact support.',
            registration_unavailable: 'Registration is briefly unavailable. Please try again.',
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
            Choose an email and password for Superpower
          </p>
        </div>

        <form
          onSubmit={(ev) => {
            void onSubmit(ev);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="reg-first-name" className="mb-1 block text-foreground">
              First name
            </Label>
            <input
              id="reg-first-name"
              type="text"
              autoComplete="given-name"
              placeholder="e.g. Sarah"
              required
              maxLength={100}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reg-middle-name" className="mb-1 block text-foreground">
                Middle name <span className="text-muted-foreground">(optional)</span>
              </Label>
              <input
                id="reg-middle-name"
                type="text"
                autoComplete="additional-name"
                maxLength={100}
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                className="form-input"
              />
            </div>
            <div>
              <Label htmlFor="reg-last-name" className="mb-1 block text-foreground">
                Last name <span className="text-muted-foreground">(optional)</span>
              </Label>
              <input
                id="reg-last-name"
                type="text"
                autoComplete="family-name"
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="form-input"
              />
            </div>
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
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm text-foreground">
              Address <span className="text-muted-foreground">(optional)</span>
            </legend>
            {address.map((line, index) => (
              <input
                key={index}
                aria-label={`Address line ${index + 1}`}
                type="text"
                autoComplete={`address-line${index + 1}`}
                maxLength={200}
                value={line}
                onChange={(e) =>
                  setAddress((lines) => lines.map((l, i) => (i === index ? e.target.value : l)))
                }
                className="form-input"
              />
            ))}
          </fieldset>
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
