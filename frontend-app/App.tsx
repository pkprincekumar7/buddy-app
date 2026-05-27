// react-native-gesture-handler MUST be the very first import so it can
// monkey-patch the native gesture responder before anything else loads.
import 'react-native-gesture-handler';

import React from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { env } from './src/lib/env';

// Configure Google Sign-In once at app startup using the Web OAuth Client ID.
// The web client ID is required so the resulting idToken can be verified
// server-side by the backend's /auth/google endpoint.
GoogleSignin.configure({ webClientId: env.GOOGLE_CLIENT_ID });
import { StatusBar, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from './src/lib/query-client';
import { AuthProvider } from './src/lib/AuthContext';
import { Toaster } from './src/components/ui/Toaster';
import Navigation from './src/navigation';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    // GestureHandlerRootView must wrap everything — without it scroll and
    // swipe gestures are unreliable on Android (React Navigation requirement).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClientInstance}>
        <AuthProvider>
          <SafeAreaProvider>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <Navigation />
            <Toaster />
          </SafeAreaProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default App;
