import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/lib/AuthContext';
import { account } from '@/api/account';
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

  const onSubmit = async () => {
    setError('');
    if (!firstName.trim()) {
      setError('Please enter your first name.');
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
            registration_unavailable:
              'Registration is briefly unavailable. Please try again.',
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
        subtitle="Choose an email and password for Superpower"
      />

      <View className="gap-4">
        <View>
          <Label nativeID="reg-first-name" className="mb-1 text-foreground">
            First name
          </Label>
          <FormInput
            accessibilityLabel="First name"
            accessibilityLabelledBy="reg-first-name"
            autoComplete="given-name"
            textContentType="givenName"
            autoCapitalize="words"
            placeholder="e.g. Sarah"
            maxLength={100}
            returnKeyType="next"
            value={firstName}
            onChangeText={setFirstName}
          />
        </View>
        <View>
          <Label nativeID="reg-middle-name" className="mb-1 text-foreground">
            Middle name (optional)
          </Label>
          <FormInput
            accessibilityLabel="Middle name (optional)"
            accessibilityLabelledBy="reg-middle-name"
            autoComplete="name-middle"
            textContentType="middleName"
            autoCapitalize="words"
            maxLength={100}
            returnKeyType="next"
            value={middleName}
            onChangeText={setMiddleName}
          />
        </View>
        <View>
          <Label nativeID="reg-last-name" className="mb-1 text-foreground">
            Last name (optional)
          </Label>
          <FormInput
            accessibilityLabel="Last name (optional)"
            accessibilityLabelledBy="reg-last-name"
            autoComplete="family-name"
            textContentType="familyName"
            autoCapitalize="words"
            maxLength={100}
            returnKeyType="next"
            value={lastName}
            onChangeText={setLastName}
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
        <View className="gap-2">
          <Label nativeID="reg-address" className="mb-1 text-foreground">
            Address (optional)
          </Label>
          {address.map((line, index) => (
            <FormInput
              key={index}
              accessibilityLabel={`Address line ${index + 1}`}
              accessibilityLabelledBy="reg-address"
              autoComplete={index === 0 ? 'street-address' : 'off'}
              textContentType={
                index === 0 ? 'streetAddressLine1' : 'streetAddressLine2'
              }
              maxLength={200}
              returnKeyType="next"
              value={line}
              onChangeText={text =>
                setAddress(lines =>
                  lines.map((l, i) => (i === index ? text : l)),
                )
              }
            />
          ))}
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
