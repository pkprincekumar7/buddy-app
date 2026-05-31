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
  ActivityIndicator,
  Modal,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import {
  GoogleSignin,
  GoogleSigninButton,
  isSuccessResponse,
  isCancelledResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { COUNTRIES } from '@/lib/countries';
import { httpErrorMessage } from '@/lib/apiError';
import type { AuthStackParamList } from '@/navigation';

type LoginNavProp = StackNavigationProp<AuthStackParamList, 'Login'>;

export default function LoginScreen() {
  const navigation = useNavigation<LoginNavProp>();
  const { refetchUser, refetchChildren } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Google new-user flow: country selection step
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(
    null,
  );
  const [googleCountry, setGoogleCountry] = useState('');
  const [googleCountryBusy, setGoogleCountryBusy] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const cardFade = useFadeIn(0, 700);

  const onGoogleCountrySubmit = async () => {
    if (!googleCountry || !pendingGoogleToken) return;
    setError('');
    setLoadingMessage('Completing sign-in…');
    setGoogleCountryBusy(true);
    try {
      await api.auth.google(pendingGoogleToken, googleCountry);
      await refetchUser();
      await refetchChildren();
    } catch (e) {
      setError(
        httpErrorMessage(e as Error | undefined, {
          fallback: 'Google sign-in failed.',
        }),
      );
      setPendingGoogleToken(null);
      setGoogleCountry('');
    } finally {
      setGoogleCountryBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoadingMessage('Signing you in…');
    setBusy(true);
    try {
      await api.auth.login(email.trim(), password);
      await refetchUser();
      await refetchChildren();
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

  const onGoogleSignIn = async () => {
    setError('');
    setLoadingMessage('Signing in with Google…');
    setBusy(true);
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const response = await GoogleSignin.signIn();

      if (isCancelledResponse(response)) {
        setBusy(false);
        return;
      }
      if (!isSuccessResponse(response)) {
        setError('Google sign-in failed. Please try again.');
        setBusy(false);
        return;
      }

      const idToken = response.data?.idToken;
      if (!idToken) {
        setError('Google sign-in did not return a token. Please try again.');
        setBusy(false);
        return;
      }

      try {
        await api.auth.google(idToken);
        await refetchUser();
        await refetchChildren();
      } catch (e) {
        // Backend returns 422 + detail object when a new Google user needs to pick a country.
        // The mobile ApiError.detail is the raw JSON string when detail is an object.
        if (
          e instanceof ApiError &&
          e.status === 422 &&
          e.detail.includes('country_code_required')
        ) {
          setPendingGoogleToken(idToken);
          setBusy(false);
          return;
        }
        setError(
          httpErrorMessage(e as Error | undefined, {
            fallback: 'Google sign-in failed.',
          }),
        );
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === statusCodes.SIGN_IN_CANCELLED) {
        // user dismissed the sheet — no error shown
      } else if (code === statusCodes.IN_PROGRESS) {
        // sign-in already in progress — ignore
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services is not available on this device.');
      } else {
        setError('Google sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedCountryLabel =
    COUNTRIES.find(c => c.code === googleCountry)?.label ??
    'Select your country…';

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
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
            style={cardFade}
            className="w-full max-w-md rounded-2xl bg-card p-8 border border-border"
          >
            {/* Header */}
            <View className="mb-8 items-center">
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-xl bg-teal-500">
                <Text className="text-lg font-bold text-white">LP</Text>
              </View>
              <Text className="text-2xl font-bold text-white">Sign in</Text>
              <Text className="mt-1 text-sm text-slate-400">
                Buddy360 — continue to your pathway
              </Text>
            </View>

            {!pendingGoogleToken && (
              <View className="gap-4">
                {/* Email */}
                <View>
                  <Text className="mb-1 text-sm font-medium text-slate-300">
                    Username (email)
                  </Text>
                  <TextInput
                    className="form-input rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="#64748b"
                  />
                </View>

                {/* Password */}
                <View>
                  <Text className="mb-1 text-sm font-medium text-slate-300">
                    Password
                  </Text>
                  <TextInput
                    className="form-input rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    secureTextEntry
                    autoComplete="password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#64748b"
                  />
                </View>

                {error ? (
                  <Text className="text-sm text-red-500">{error}</Text>
                ) : null}

                <Button
                  onPress={() => {
                    void onSubmit();
                  }}
                  disabled={busy}
                  className="w-full bg-teal-600"
                >
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>

                {/* Google Sign-In — Android only (iOS sign-in not yet supported) */}
                {Platform.OS !== 'ios' && (
                  <View style={{ marginTop: 8, alignItems: 'center', gap: 12 }}>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>or</Text>
                    <GoogleSigninButton
                      size={GoogleSigninButton.Size.Wide}
                      color={GoogleSigninButton.Color.Light}
                      onPress={() => {
                        void onGoogleSignIn();
                      }}
                      disabled={busy}
                      style={{
                        width: '100%',
                        height: 48,
                        opacity: busy ? 0.6 : 1,
                      }}
                    />
                  </View>
                )}
              </View>
            )}

            {/* Google new-user: country selector step */}
            {pendingGoogleToken ? (
              <View className="mt-6 rounded-xl border border-teal-500/25 bg-card p-4">
                <Text className="mb-3 text-sm font-medium text-white">
                  One more step
                </Text>
                <Text className="mb-3 text-xs text-slate-400">
                  Select your country so we can store your data in the right
                  region.
                </Text>
                {error ? (
                  <Text className="mb-3 text-sm text-red-400">{error}</Text>
                ) : null}

                {/* Country picker trigger */}
                <Button
                  variant="outline"
                  onPress={() => setShowCountryPicker(true)}
                  className="mb-3 w-full justify-start"
                >
                  <Text className="text-sm text-foreground">
                    {selectedCountryLabel}
                  </Text>
                </Button>

                {/* Country picker modal */}
                <Modal
                  visible={showCountryPicker}
                  animationType="slide"
                  presentationStyle="pageSheet"
                  onRequestClose={() => setShowCountryPicker(false)}
                >
                  <SafeAreaView
                    className="flex-1 bg-background"
                    style={{ flex: 1, backgroundColor: '#0a0a0a' }}
                  >
                    <View
                      className="flex-row items-center justify-between border-b border-border px-4 py-3"
                      style={{ borderBottomColor: '#1e293b' }}
                    >
                      <Text className="text-base font-semibold text-white">
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
                          className="w-full justify-start rounded-none border-b border-border/30 px-4"
                          onPress={() => {
                            setGoogleCountry(code);
                            setShowCountryPicker(false);
                          }}
                        >
                          <Text
                            className={`text-sm ${
                              googleCountry === code
                                ? 'font-semibold text-teal-400'
                                : 'text-foreground'
                            }`}
                          >
                            {label}
                          </Text>
                        </Button>
                      ))}
                    </ScrollView>
                  </SafeAreaView>
                </Modal>

                <View className="flex-row gap-2">
                  <Button
                    onPress={() => {
                      void onGoogleCountrySubmit();
                    }}
                    disabled={!googleCountry || googleCountryBusy}
                    className="flex-1 bg-teal-600"
                  >
                    {googleCountryBusy ? 'Signing in…' : 'Continue'}
                  </Button>
                  <Button
                    variant="outline"
                    onPress={() => {
                      setPendingGoogleToken(null);
                      setGoogleCountry('');
                      setError('');
                    }}
                    disabled={googleCountryBusy}
                  >
                    Cancel
                  </Button>
                </View>
              </View>
            ) : null}

            {/* Navigate to Register */}
            <View className="mt-8 flex-row items-center justify-center">
              <Text className="text-sm text-slate-400">New here? </Text>
              <Pressable onPress={() => navigation.navigate('Register')}>
                <Text className="text-sm font-medium text-teal-500">
                  Create an account
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Full-screen loading overlay */}
      <Modal
        visible={busy || googleCountryBusy}
        transparent
        animationType="fade"
      >
        <View className="flex-1 items-center justify-center gap-8 bg-background/95">
          {/* Dual-ring spinner */}
          <View className="relative h-20 w-20 items-center justify-center">
            <View className="absolute inset-0 rounded-full border-4 border-teal-500/20" />
            <ActivityIndicator size="large" color="#14b8a6" />
          </View>
          <View className="items-center gap-1">
            <Text className="text-base font-semibold text-white">
              {loadingMessage}
            </Text>
            <Text className="text-sm text-slate-500">
              Please wait a moment…
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
