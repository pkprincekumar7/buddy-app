// react-native-gesture-handler MUST be the very first import so it can
// monkey-patch the native gesture responder before anything else loads.
import 'react-native-gesture-handler';
// NativeWind v4 requires the CSS entry-point to be imported so the Metro
// transformer injects the compiled stylesheet into the JS bundle.
import './global.css';

import React from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useFonts } from 'expo-font';
import { queryClientInstance } from './src/lib/query-client';
import { AuthProvider } from './src/lib/AuthContext';
import { TtsProvider } from './src/lib/TtsContext';
import { AmbientAudioProvider } from './src/lib/AmbientAudioContext';
import { Toaster } from './src/lib/toast';
import { ErrorBoundary } from './src/components/shared/ErrorBoundary';
import { PortalHost } from './src/components/ui/portal';
import Navigation from './src/navigation';
import { env } from './src/lib/env';
import { color, fonts } from './src/theme';

// Configure Google Sign-In once at app startup.
// On iOS, iosClientId is required by the native module even though the Sign-In
// button is hidden on iOS — without it the configure() call rejects and crashes.
GoogleSignin.configure({
  webClientId: env.GOOGLE_CLIENT_ID,
  ...(Platform.OS === 'ios' && {
    iosClientId:
      env.IOS_CLIENT_ID ||
      '491922250866-oj7n68jvo5faorv0aedoc6ps5inn4k93.apps.googleusercontent.com',
  }),
});

// The web's @font-face faces (frontend/public/fonts), converted to TTF.
const FONT_FILES = {
  [fonts.orbitron]: require('./assets/fonts/Orbitron-Bold.ttf'),
  [fonts.orbitronBlack]: require('./assets/fonts/Orbitron-Black.ttf'),
  [fonts.rajdhani]: require('./assets/fonts/Rajdhani-Medium.ttf'),
  [fonts.rajdhaniSemibold]: require('./assets/fonts/Rajdhani-SemiBold.ttf'),
  [fonts.rajdhaniBold]: require('./assets/fonts/Rajdhani-Bold.ttf'),
};

function App() {
  // Like the web's font-display: swap — render immediately; a font error falls
  // back to the system face rather than blocking the app.
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);

  return (
    // GestureHandlerRootView must wrap everything — without it scroll and
    // swipe gestures are unreliable on Android (React Navigation requirement).
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: color.background }}
    >
      <SafeAreaProvider>
        {/* The app is dark-only, like the web (forcedTheme="dark"). */}
        <StatusBar
          barStyle="light-content"
          backgroundColor={color['sidebar-background']}
        />
        <QueryClientProvider client={queryClientInstance}>
          <AuthProvider>
            <TtsProvider>
              <AmbientAudioProvider>
                <ErrorBoundary>
                  {/* Full-screen overlays (splashes, warp, sheets) render here, above the header. */}
                  <PortalHost>
                    {fontsLoaded || fontError ? (
                      <Navigation />
                    ) : (
                      <View style={{ flex: 1 }} />
                    )}
                  </PortalHost>
                </ErrorBoundary>
              </AmbientAudioProvider>
            </TtsProvider>
          </AuthProvider>
        </QueryClientProvider>
        <Toaster />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
