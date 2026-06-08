import React, { useState } from 'react';
import Animated from 'react-native-reanimated';
import { useFadeIn } from '@/lib/animations';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { COUNTRIES } from '@/lib/countries';
import { httpErrorMessage } from '@/lib/apiError';
import type { AuthStackParamList } from '@/navigation';

type RegisterNavProp = StackNavigationProp<AuthStackParamList, 'Register'>;

export default function RegisterScreen() {
  const navigation = useNavigation<RegisterNavProp>();
  const { refetchUser, refetchChildren } = useAuth();
  const { colors } = useTheme();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const cardFade = useFadeIn(0, 700);

  const selectedCountryLabel =
    COUNTRIES.find(c => c.code === countryCode)?.label ??
    'Select your country…';

  const onSubmit = async () => {
    setError('');
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!countryCode) {
      setError('Please select your country.');
      return;
    }
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
      await refetchUser();
      await refetchChildren();
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
    <SafeAreaView
      className="flex-1 bg-background"
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <KeyboardAvoidingView
        className="flex-1"
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerClassName="flex-grow items-center justify-center p-6"
          contentContainerStyle={{
            flexGrow: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Card */}
          <Animated.View
            style={[
              cardFade,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            className="w-full max-w-md rounded-2xl p-8 border"
          >
            {/* Header */}
            <View className="mb-8 items-center">
              <View
                className="mb-3 h-12 w-12 items-center justify-center rounded-xl"
                style={{ backgroundColor: colors.primaryAction }}
              >
                <Text
                  className="text-lg font-bold"
                  style={{ color: colors.primaryForeground }}
                >
                  LP
                </Text>
              </View>
              <Text
                className="text-2xl font-bold"
                style={{ color: colors.text }}
              >
                Create account
              </Text>
              <Text
                className="mt-1 text-sm"
                style={{ color: colors.textMuted }}
              >
                Choose an email and password for Buddy360
              </Text>
            </View>

            <View className="gap-4">
              {/* Full name */}
              <View>
                <Text
                  className="mb-1 text-sm font-medium"
                  style={{ color: colors.textMuted }}
                >
                  Full name
                </Text>
                <TextInput
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                  }}
                  autoComplete="name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholder="e.g. Sarah Johnson"
                  placeholderTextColor={colors.textMuted}
                  maxLength={255}
                  value={fullName}
                  onChangeText={setFullName}
                />
              </View>

              {/* Email */}
              <View>
                <Text
                  className="mb-1 text-sm font-medium"
                  style={{ color: colors.textMuted }}
                >
                  Username (email)
                </Text>
                <TextInput
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              {/* Country */}
              <View>
                <Text
                  className="mb-1 text-sm font-medium"
                  style={{ color: colors.textMuted }}
                >
                  Country
                </Text>
                <Button
                  variant="outline"
                  onPress={() => setShowCountryPicker(true)}
                  className="w-full justify-start"
                >
                  <Text className="text-sm" style={{ color: colors.text }}>
                    {selectedCountryLabel}
                  </Text>
                </Button>
                <Text
                  className="mt-1 text-xs"
                  style={{ color: colors.textMuted }}
                >
                  Determines where your data is stored to comply with local
                  privacy laws.
                </Text>
              </View>

              {/* Password */}
              <View>
                <Text
                  className="mb-1 text-sm font-medium"
                  style={{ color: colors.textMuted }}
                >
                  Password
                </Text>
                <TextInput
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                  }}
                  secureTextEntry
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                />
              </View>

              {/* Confirm password */}
              <View>
                <Text
                  className="mb-1 text-sm font-medium"
                  style={{ color: colors.textMuted }}
                >
                  Confirm password
                </Text>
                <TextInput
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                  }}
                  secureTextEntry
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  placeholderTextColor={colors.textMuted}
                  value={confirm}
                  onChangeText={setConfirm}
                />
              </View>

              {error ? (
                <Text className="text-sm" style={{ color: colors.error }}>
                  {error}
                </Text>
              ) : null}

              <Button
                onPress={() => {
                  void onSubmit();
                }}
                disabled={busy}
                className="w-full"
              >
                {busy ? 'Creating account…' : 'Register'}
              </Button>
            </View>

            {/* Navigate to Login */}
            <View className="mt-8 flex-row justify-center">
              <Text className="text-sm" style={{ color: colors.textMuted }}>
                Already have an account?{' '}
              </Text>
              <Button
                variant="link"
                size="sm"
                onPress={() => navigation.navigate('Login')}
                className="p-0"
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: colors.primary }}
                >
                  Sign in
                </Text>
              </Button>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker modal */}
      <Modal
        visible={showCountryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <SafeAreaView
          className="flex-1 bg-background"
          style={{ flex: 1, backgroundColor: colors.background }}
        >
          <View
            className="flex-row items-center justify-between border-b border-border px-4 py-3"
            style={{ borderBottomColor: colors.border }}
          >
            <Text
              className="text-base font-semibold"
              style={{ color: colors.text }}
            >
              Select Country
            </Text>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setShowCountryPicker(false)}
            >
              Done
            </Button>
          </View>
          <ScrollView>
            {COUNTRIES.map(({ code, label }) => (
              <Button
                key={code}
                variant="ghost"
                className="w-full justify-start rounded-none border-b px-4"
                style={{ borderBottomColor: colors.border + '4D' }}
                onPress={() => {
                  setCountryCode(code);
                  setShowCountryPicker(false);
                }}
              >
                <Text
                  className={`text-sm ${
                    countryCode === code ? 'font-semibold' : ''
                  }`}
                  style={{
                    color: countryCode === code ? colors.primary : colors.text,
                  }}
                >
                  {label}
                </Text>
              </Button>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
