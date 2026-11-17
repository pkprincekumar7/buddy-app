import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { account, type Profile, type ProfilePatch } from '@/api/account';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import PageLoader from '@/components/shared/PageLoader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/AuthContext';
import { httpErrorMessage } from '@/lib/apiError';

// Account settings (build plan 7.2): the profile (names and address, GET / PATCH
// /users/me/profile) and "Sign out of all devices" (POST /auth/logout-all).

// The editable fields: the patch's.
type Field = keyof ProfilePatch;

const NAMES: { field: Field; label: string; autoComplete: string; required?: boolean }[] = [
  { field: 'first_name', label: 'First name', autoComplete: 'given-name', required: true },
  { field: 'middle_name', label: 'Middle name', autoComplete: 'additional-name' },
  { field: 'last_name', label: 'Last name', autoComplete: 'family-name' },
];
const ADDRESS: Field[] = ['address_line_one', 'address_line_two', 'address_line_three'];

type Draft = Record<Field, string>;

function draftOf(profile: Profile): Draft {
  return {
    first_name: profile.first_name,
    middle_name: profile.middle_name ?? '',
    last_name: profile.last_name ?? '',
    address_line_one: profile.address_line_one ?? '',
    address_line_two: profile.address_line_two ?? '',
    address_line_three: profile.address_line_three ?? '',
  };
}

/** Only what changed; an emptied optional field is cleared (null). */
function changesOf(draft: Draft, saved: Draft): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const field of Object.keys(draft) as Field[]) {
    const value = draft[field].trim();
    if (value === saved[field].trim()) continue;
    patch[field] = field === 'first_name' ? value : value || null;
  }
  return patch;
}

export default function AccountSettings() {
  const { user, logout, checkAppState } = useAuth();
  const queryClient = useQueryClient();
  const {
    data: profile,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['profile'],
    queryFn: () => account.profile.get(),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  // Deleting the account: the dialog, the email typed to confirm it, and the request.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile) setDraft(draftOf(profile));
  }, [profile]);

  if (isLoading) return <PageLoader />;
  if (error || !profile) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="text-error-strong">
          {httpErrorMessage(error, {
            fallback: 'Could not load your profile. Please try again.',
          })}
        </p>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </div>
    );
  }
  // The draft follows the profile in an effect: a render's gap, not an error.
  if (!draft) return <PageLoader />;

  const saved = draftOf(profile);
  const patch = changesOf(draft, saved);
  const changed = Object.keys(patch).length > 0;

  const onSave = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!draft.first_name.trim()) {
      toast.error('Please enter your first name.');
      return;
    }
    setSaving(true);
    try {
      const updated = await account.profile.update(patch);
      queryClient.setQueryData(['profile'], updated);
      await checkAppState({ withLoading: false }); // the header shows the new name
      toast.success('Profile saved.');
    } catch (e) {
      toast.error(httpErrorMessage(e as Error | undefined, { fallback: 'Could not save.' }));
    } finally {
      setSaving(false);
    }
  };

  const onSignOutAll = async () => {
    setSigningOutAll(true);
    try {
      await account.logoutAll();
      toast.success('Signed out on every device.');
      await logout(true);
    } catch (e) {
      setSigningOutAll(false);
      toast.error(httpErrorMessage(e as Error | undefined, { fallback: 'Could not sign out.' }));
    }
  };

  // The auth service checks the email too (400 confirmation_mismatch); this only keeps the
  // button off until it matches.
  const emailMatches =
    !!user?.email && confirmEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
  const onDeleteAccount = async () => {
    setDeleteError('');
    setDeleting(true);
    try {
      await account.deleteAccount(confirmEmail.trim());
      toast.success('Your account is being deleted.');
      await logout(true);
    } catch (e) {
      setDeleting(false);
      setDeleteError(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Could not delete the account. Please try again.',
          codeMessages: { confirmation_mismatch: "The email doesn't match your account." },
        }),
      );
    }
  };

  const set = (field: Field) => (value: string) =>
    setDraft((current) => (current ? { ...current, [field]: value } : current));

  return (
    <div className="mx-auto w-full max-w-xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Account settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </header>

      <form
        onSubmit={(ev) => {
          void onSave(ev);
        }}
        className="border-edge space-y-4 rounded-2xl bg-card p-6"
      >
        <h2 className="text-lg font-semibold text-foreground">Profile</h2>
        {NAMES.map(({ field, label, autoComplete, required }) => (
          <div key={field}>
            <Label htmlFor={`settings-${field}`} className="mb-1 block text-foreground">
              {label}
              {!required && <span className="text-muted-foreground"> (optional)</span>}
            </Label>
            <input
              id={`settings-${field}`}
              type="text"
              autoComplete={autoComplete}
              required={required}
              maxLength={100}
              value={draft[field]}
              onChange={(e) => set(field)(e.target.value)}
              className="form-input"
            />
          </div>
        ))}
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm text-foreground">
            Address <span className="text-muted-foreground">(optional)</span>
          </legend>
          {ADDRESS.map((field, index) => (
            <input
              key={field}
              aria-label={`Address line ${index + 1}`}
              type="text"
              autoComplete={`address-line${index + 1}`}
              maxLength={200}
              value={draft[field]}
              onChange={(e) => set(field)(e.target.value)}
              className="form-input"
            />
          ))}
        </fieldset>
        <Button type="submit" variant="action" disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>

      <section className="border-edge space-y-3 rounded-2xl bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Sign out of all devices</h2>
        <p className="text-sm text-muted-foreground">
          Ends every session of this account, on this device and any other. You'll sign in again
          here.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={signingOutAll}>
              {signingOutAll ? 'Signing out…' : 'Sign out of all devices'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of all devices?</AlertDialogTitle>
              <AlertDialogDescription>
                Every device signed in to this account, this one included, will need to sign in
                again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void onSignOutAll()}>
                Sign out everywhere
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      <section className="border-edge space-y-3 rounded-2xl bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          Deletes this account and everything in it: your children, their answers, plans and
          progress. It can&apos;t be undone.
        </p>
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (deleting) return;
            setDeleteOpen(open);
            setConfirmEmail('');
            setDeleteError('');
          }}
        >
          <AlertDialogTrigger asChild>
            <Button variant="outline">Delete account</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                Everything goes: your children, their answers, plans and progress. Type your email
                to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div>
              <Label htmlFor="settings-delete-email" className="mb-1 block text-foreground">
                Your email
              </Label>
              <input
                id="settings-delete-email"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(e) => {
                  setConfirmEmail(e.target.value);
                  setDeleteError('');
                }}
                className="form-input"
              />
              {deleteError && (
                <p role="alert" className="mt-2 text-sm text-error-strong">
                  {deleteError}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={!emailMatches || deleting}
                onClick={() => void onDeleteAccount()}
              >
                {deleting ? 'Deleting…' : 'Delete account'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
}
