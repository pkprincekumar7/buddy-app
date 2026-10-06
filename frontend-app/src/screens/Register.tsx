import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { httpErrorMessage } from '@/lib/apiError';
import { Link } from '@/lib/router';
import AuthScreen from '@/components/auth/AuthScreen';
import AuthCardHeader from '@/components/auth/AuthCardHeader';
import CountrySelect from '@/components/auth/CountrySelect';
import FormInput from '@/components/auth/FormInput';

export default function Register() {
  const { checkAppState } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError('');
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    // Web: the `required` attribute blocks submitting an empty email/password.
    if (!email.trim()) return;
    if (!countryCode) {
      setError('Please select your country.');
      return;
    }
    if (!password || !confirm) return;
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
      await api.auth.register(
        email.trim(),
        password,
        fullName.trim(),
        countryCode,
      );
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

  const submit = () => {
    void onSubmit();
  };

  return (
    <AuthScreen>
      <AuthCardHeader
        title="Create account"
        subtitle="Choose an email and password for Buddy360"
      />

      <View className="gap-4">
        <View>
          <Label nativeID="reg-name" className="mb-1 text-foreground">
            Full name
          </Label>
          <FormInput
            accessibilityLabel="Full name"
            accessibilityLabelledBy="reg-name"
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            placeholder="e.g. Sarah Johnson"
            maxLength={255}
            returnKeyType="next"
            value={fullName}
            onChangeText={setFullName}
          />
        </View>
        <View>
          <Label nativeID="reg-email" className="mb-1 text-foreground">
            Username (email)
          </Label>
          <FormInput
            accessibilityLabel="Username (email)"
            accessibilityLabelledBy="reg-email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
          />
        </View>
        <View>
          <Label nativeID="reg-country" className="mb-1 text-foreground">
            Country
          </Label>
          <CountrySelect
            value={countryCode}
            onChange={setCountryCode}
            accessibilityLabel="Country"
          />
          <Text className="mt-1 text-xs text-muted-foreground">
            Determines where your data is stored to comply with local privacy
            laws.
          </Text>
        </View>
        <View>
          <Label nativeID="reg-password" className="mb-1 text-foreground">
            Password
          </Label>
          <FormInput
            accessibilityLabel="Password"
            accessibilityLabelledBy="reg-password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            value={password}
            onChangeText={setPassword}
          />
        </View>
        <View>
          <Label nativeID="reg-confirm" className="mb-1 text-foreground">
            Confirm password
          </Label>
          <FormInput
            accessibilityLabel="Confirm password"
            accessibilityLabelledBy="reg-confirm"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            value={confirm}
            onChangeText={setConfirm}
            onSubmitEditing={submit}
          />
        </View>
        {error ? (
          <Text className="text-sm text-error-strong">{error}</Text>
        ) : null}
        <Button
          variant="action"
          className="w-full"
          disabled={busy}
          accessibilityLabel="Register"
          onPress={submit}
        >
          {busy ? 'Creating account…' : 'Register'}
        </Button>
      </View>

      <View className="mt-8 flex-row flex-wrap items-center justify-center">
        <Text className="text-sm text-muted-foreground">
          Already have an account?{' '}
        </Text>
        <Link to="/Login" accessibilityLabel="Sign in">
          <Text className="text-sm font-medium text-primary">Sign in</Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
