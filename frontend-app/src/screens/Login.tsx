import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { httpErrorMessage } from '@/lib/apiError';
import { env } from '@/lib/env';
import { Link } from '@/lib/router';
import AuthScreen from '@/components/auth/AuthScreen';
import AuthCardHeader from '@/components/auth/AuthCardHeader';
import AuthLoadingOverlay from '@/components/auth/AuthLoadingOverlay';
import CountrySelect from '@/components/auth/CountrySelect';
import FormInput from '@/components/auth/FormInput';
import GoogleButton from '@/components/auth/GoogleButton';

// The old mobile app hid native Google sign-in on iOS (not yet supported there); keep that.
const GOOGLE_SUPPORTED = Platform.OS !== 'ios';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export default function Login() {
  const { checkAppState } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const googleClientId = env.GOOGLE_CLIENT_ID || '';

  // Google new-user flow: when the backend returns country_code_required,
  // we hold the id_token and show a country selector before retrying.
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(
    null,
  );
  const [googleCountry, setGoogleCountry] = useState('');
  const [googleCountryBusy, setGoogleCountryBusy] = useState(false);

  const onGoogleCountrySubmit = async () => {
    if (!googleCountry || !pendingGoogleToken) return;
    setError('');
    setLoadingMessage('Completing sign-in…');
    setGoogleCountryBusy(true);
    try {
      await api.auth.google(pendingGoogleToken, googleCountry);
      await checkAppState({ withLoading: false });
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

  // Web: the GIS credential callback. Here the native Google sheet supplies the id_token.
  const onCredential = async (idToken: string) => {
    setError('');
    setPendingGoogleToken(null);
    setGoogleCountry('');
    setLoadingMessage('Signing in with Google…');
    setBusy(true);
    try {
      await api.auth.google(idToken);
      await checkAppState({ withLoading: false });
    } catch (e) {
      const apiErr = e as { status?: number; detail?: unknown } | null;
      const detailCode =
        apiErr?.detail !== null && typeof apiErr?.detail === 'object'
          ? (apiErr.detail as Record<string, unknown>)['code']
          : undefined;
      if (apiErr?.status === 422 && detailCode === 'country_code_required') {
        setPendingGoogleToken(idToken);
      } else {
        const msg = httpErrorMessage(e as Error | undefined, {
          fallback: 'Google sign-in failed.',
        });
        setError(
          msg.includes('503')
            ? 'Google sign-in is not configured on the server.'
            : msg,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onGooglePress = async () => {
    setError('');
    let idToken: string | null | undefined;
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const response = await GoogleSignin.signIn();
      if (isCancelledResponse(response)) return;
      if (!isSuccessResponse(response)) {
        setError('Google sign-in failed. Please try again.');
        return;
      }
      idToken = response.data.idToken;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (
        code === statusCodes.SIGN_IN_CANCELLED ||
        code === statusCodes.IN_PROGRESS
      )
        return;
      setError(
        code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE
          ? 'Google Play Services is not available on this device.'
          : 'Google sign-in failed. Please try again.',
      );
      return;
    }
    if (!idToken) {
      setError('Google sign-in did not return a token. Please try again.');
      return;
    }
    await onCredential(idToken);
  };

  const onSubmit = async () => {
    // Web relies on the `required` attribute to block an empty submit.
    if (!email.trim() || !password) return;
    setError('');
    setLoadingMessage('Signing you in…');
    setBusy(true);
    try {
      await api.auth.login(email.trim(), password);
      await checkAppState({ withLoading: false });
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

  return (
    <AuthScreen
      overlay={
        busy || googleCountryBusy ? (
          <AuthLoadingOverlay message={loadingMessage} />
        ) : null
      }
    >
      <AuthCardHeader
        title="Sign in"
        subtitle="Buddy360 — continue to your pathway"
      />

      {!pendingGoogleToken && (
        <>
          <View className="gap-4">
            <View>
              <Label nativeID="login-email" className="mb-1 text-foreground">
                Username (email)
              </Label>
              <FormInput
                accessibilityLabel="Username (email)"
                accessibilityLabelledBy="login-email"
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
              <Label nativeID="login-password" className="mb-1 text-foreground">
                Password
              </Label>
              <FormInput
                accessibilityLabel="Password"
                accessibilityLabelledBy="login-password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => {
                  void onSubmit();
                }}
              />
            </View>
            {error ? (
              <Text className="text-sm text-error-strong">{error}</Text>
            ) : null}
            <Button
              variant="action"
              className="w-full"
              disabled={busy}
              accessibilityLabel="Sign in"
              onPress={() => {
                void onSubmit();
              }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </View>

          {GOOGLE_SUPPORTED ? (
            googleClientId ? (
              <View className="mt-6 items-center gap-2">
                <Text className="text-xs text-muted-foreground">or</Text>
                <View className="min-h-[40px] w-full items-center justify-center">
                  <GoogleButton
                    disabled={busy}
                    onPress={() => {
                      void onGooglePress();
                    }}
                  />
                </View>
              </View>
            ) : (
              <Text className="mt-4 text-center text-xs text-muted-foreground">
                Google sign-in: set{' '}
                <Text
                  className="rounded bg-ghost-strong"
                  style={{ fontFamily: MONO }}
                >
                  {' GOOGLE_CLIENT_ID '}
                </Text>{' '}
                in the app env and{' '}
                <Text
                  className="rounded bg-ghost-strong"
                  style={{ fontFamily: MONO }}
                >
                  {' GOOGLE_CLIENT_ID '}
                </Text>{' '}
                on the API.
              </Text>
            )
          ) : null}
        </>
      )}

      {pendingGoogleToken ? (
        <View className="mt-6 rounded-xl border border-primary/25 bg-primary-medium/10 p-4">
          <Text className="mb-3 text-sm font-medium text-foreground">
            One more step
          </Text>
          <Text className="mb-3 text-xs text-muted-foreground">
            Select your country so we can store your data in the right region.
          </Text>
          {error ? (
            <Text className="mb-3 text-sm text-error">{error}</Text>
          ) : null}
          <CountrySelect
            value={googleCountry}
            onChange={setGoogleCountry}
            className="mb-3 text-sm"
            disabled={googleCountryBusy}
          />
          <View className="flex-row gap-2">
            <Button
              onPress={() => {
                void onGoogleCountrySubmit();
              }}
              disabled={!googleCountry || googleCountryBusy}
              accessibilityLabel="Continue"
              className="flex-1 bg-primary-action text-sm"
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
              accessibilityLabel="Cancel"
              className="text-sm"
            >
              Cancel
            </Button>
          </View>
        </View>
      ) : null}

      <View className="mt-8 flex-row flex-wrap items-center justify-center">
        <Text className="text-sm text-muted-foreground">New here? </Text>
        <Link to="/Register" accessibilityLabel="Create an account">
          <Text className="text-sm font-medium text-primary">
            Create an account
          </Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
