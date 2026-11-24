import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { account, type Profile, type ProfilePatch } from '@/api/account';
import FormInput from '@/components/auth/FormInput';
import PageScroll from '@/components/layout/PageScroll';
import PageLoader from '@/components/shared/PageLoader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { httpErrorMessage } from '@/lib/apiError';
import { toast } from '@/lib/toast';

// Account settings (build plan 7.2): the profile (names and address, GET / PATCH
// /users/me/profile) and "Sign out of all devices" (POST /auth/logout-all). The same
// screen as the web's pages/AccountSettings.tsx.

// The editable fields: the patch's.
type Field = keyof ProfilePatch;

const NAMES: { field: Field; label: string; required?: boolean }[] = [
  { field: 'first_name', label: 'First name', required: true },
  { field: 'middle_name', label: 'Middle name (optional)' },
  { field: 'last_name', label: 'Last name (optional)' },
];
const ADDRESS: Field[] = [
  'address_line_one',
  'address_line_two',
  'address_line_three',
];

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
  const [confirming, setConfirming] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  // Deleting the account: the dialog, the email typed to confirm it, and the request.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile) setDraft(draftOf(profile));
  }, [profile]);

  if (isLoading) {
    return <PageLoader spinnerClassName="h-8 w-8" durationSeconds={1} />;
  }
  if (error || !profile) {
    return (
      <View className="items-center gap-4 p-6">
        <Text className="text-center text-error-strong">
          {httpErrorMessage(error, {
            fallback: 'Could not load your profile. Please try again.',
          })}
        </Text>
        <Button
          variant="outline"
          disabled={isFetching}
          accessibilityLabel="Try again"
          onPress={() => void refetch()}
        >
          {isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </View>
    );
  }
  // The draft follows the profile in an effect: a render's gap, not an error.
  if (!draft) {
    return <PageLoader spinnerClassName="h-8 w-8" durationSeconds={1} />;
  }

  const patch = changesOf(draft, draftOf(profile));
  const changed = Object.keys(patch).length > 0;

  const onSave = async () => {
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
      toast.error(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Could not save.',
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  // The auth service checks the email too (400 confirmation_mismatch); this only keeps the
  // button off until it matches.
  const emailMatches =
    !!user?.email &&
    confirmEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
  const closeDelete = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setConfirmEmail('');
    setDeleteError('');
  };
  const onDeleteAccount = async () => {
    setDeleteError('');
    setDeleting(true);
    try {
      await account.deleteAccount(confirmEmail.trim());
      setDeleteOpen(false);
      toast.success('Your account is being deleted.');
      await logout(true);
    } catch (e) {
      setDeleting(false);
      setDeleteError(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Could not delete the account. Please try again.',
          codeMessages: {
            confirmation_mismatch: "The email doesn't match your account.",
          },
        }),
      );
    }
  };

  const onSignOutAll = async () => {
    setSigningOutAll(true);
    try {
      await account.logoutAll();
      setConfirming(false);
      toast.success('Signed out on every device.');
      await logout(true);
    } catch (e) {
      setSigningOutAll(false);
      toast.error(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Could not sign out.',
        }),
      );
    }
  };

  const set = (field: Field) => (value: string) =>
    setDraft(current => (current ? { ...current, [field]: value } : current));

  return (
    <PageScroll contentContainerClassName="gap-6 p-6">
      <View>
        <Text
          accessibilityRole="header"
          className="text-2xl font-bold text-foreground"
        >
          Account settings
        </Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          {user?.email}
        </Text>
      </View>

      <View className="gap-4 rounded-2xl border border-edge bg-card p-6">
        <Text className="text-lg font-semibold text-foreground">Profile</Text>
        {NAMES.map(({ field, label, required }) => (
          <View key={field}>
            <Label
              nativeID={`settings-${field}`}
              className="mb-1 text-foreground"
            >
              {label}
            </Label>
            <FormInput
              accessibilityLabel={label}
              accessibilityLabelledBy={`settings-${field}`}
              autoCapitalize="words"
              maxLength={100}
              aria-required={required}
              value={draft[field]}
              onChangeText={set(field)}
            />
          </View>
        ))}
        <View className="gap-2">
          <Label nativeID="settings-address" className="mb-1 text-foreground">
            Address (optional)
          </Label>
          {ADDRESS.map((field, index) => (
            <FormInput
              key={field}
              accessibilityLabel={`Address line ${index + 1}`}
              accessibilityLabelledBy="settings-address"
              maxLength={200}
              value={draft[field]}
              onChangeText={set(field)}
            />
          ))}
        </View>
        <Button
          variant="action"
          disabled={!changed || saving}
          accessibilityLabel="Save profile"
          onPress={() => void onSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </View>

      <View className="gap-3 rounded-2xl border border-edge bg-card p-6">
        <Text className="text-lg font-semibold text-foreground">
          Sign out of all devices
        </Text>
        <Text className="text-sm text-muted-foreground">
          Ends every session of this account, on this device and any other.
          You'll sign in again here.
        </Text>
        <Button
          variant="outline"
          disabled={signingOutAll}
          accessibilityLabel="Sign out of all devices"
          onPress={() => setConfirming(true)}
        >
          Sign out of all devices
        </Button>
      </View>

      <Dialog
        open={confirming}
        onOpenChange={open => !open && setConfirming(false)}
      >
        <DialogContent
          hideClose
          accessibilityLabel="Confirm signing out of all devices"
          className="max-w-sm rounded-2xl border border-edge-strong bg-surface-elevated p-8"
        >
          <View className="mb-7 gap-2">
            <Text
              accessibilityRole="header"
              className="text-center text-lg font-bold text-foreground"
            >
              Sign out of all devices?
            </Text>
            <Text className="text-center text-sm leading-relaxed text-muted-foreground">
              Every device signed in to this account, this one included, will
              need to sign in again.
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="action"
              className="h-11 flex-1 rounded-xl"
              disabled={signingOutAll}
              onPress={() => void onSignOutAll()}
            >
              {signingOutAll ? 'Signing out…' : 'Sign out everywhere'}
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-1 rounded-xl"
              disabled={signingOutAll}
              onPress={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </View>
        </DialogContent>
      </Dialog>

      <View className="gap-3 rounded-2xl border border-edge bg-card p-6">
        <Text className="text-lg font-semibold text-foreground">
          Delete account
        </Text>
        <Text className="text-sm text-muted-foreground">
          Deletes this account and everything in it: your children, their
          answers, plans and progress. It can't be undone.
        </Text>
        <Button
          variant="outline"
          accessibilityLabel="Delete account"
          onPress={() => setDeleteOpen(true)}
        >
          Delete account
        </Button>
      </View>

      <Dialog open={deleteOpen} onOpenChange={open => !open && closeDelete()}>
        <DialogContent
          hideClose
          accessibilityLabel="Confirm deleting the account"
          className="max-w-sm rounded-2xl border border-edge-strong bg-surface-elevated p-8"
        >
          <View className="mb-5 gap-2">
            <Text
              accessibilityRole="header"
              className="text-center text-lg font-bold text-foreground"
            >
              Delete your account?
            </Text>
            <Text className="text-center text-sm leading-relaxed text-muted-foreground">
              Everything goes: your children, their answers, plans and progress.
              Type your email to confirm.
            </Text>
          </View>
          <Label
            nativeID="settings-delete-email"
            className="mb-1 text-foreground"
          >
            Your email
          </Label>
          <FormInput
            accessibilityLabel="Your email"
            accessibilityLabelledBy="settings-delete-email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={confirmEmail}
            onChangeText={value => {
              setConfirmEmail(value);
              setDeleteError('');
            }}
          />
          {deleteError ? (
            <Text
              accessibilityRole="alert"
              className="mt-2 text-sm text-error-strong"
            >
              {deleteError}
            </Text>
          ) : null}
          <View className="mt-6 flex-row gap-3">
            <Button
              variant="destructive"
              className="h-11 flex-1 rounded-xl"
              disabled={!emailMatches || deleting}
              onPress={() => void onDeleteAccount()}
            >
              {deleting ? 'Deleting…' : 'Delete account'}
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-1 rounded-xl"
              disabled={deleting}
              onPress={closeDelete}
            >
              Cancel
            </Button>
          </View>
        </DialogContent>
      </Dialog>
    </PageScroll>
  );
}
