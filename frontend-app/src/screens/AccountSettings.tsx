import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { account, type Profile, type ProfilePatch } from '@/api/account';
import FormInput from '@/components/auth/FormInput';
import PageScroll from '@/components/layout/PageScroll';
import Spinner from '@/components/shared/Spinner';
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
  } = useQuery({
    queryKey: ['profile'],
    queryFn: () => account.profile.get(),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  useEffect(() => {
    if (profile) setDraft(draftOf(profile));
  }, [profile]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner className="h-8 w-8" durationSeconds={1} />
      </View>
    );
  }
  if (error || !profile || !draft) {
    return (
      <Text className="p-6 text-center text-error-strong">
        {httpErrorMessage(error, {
          fallback: 'Could not load your profile. Please try again.',
        })}
      </Text>
    );
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
    </PageScroll>
  );
}
