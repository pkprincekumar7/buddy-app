// react-native-gesture-handler MUST be the very first import so it can
// monkey-patch the native gesture responder before anything else loads.
import 'react-native-gesture-handler';
// NativeWind v4 requires the CSS entry-point to be imported so the Metro
// transformer injects the compiled stylesheet into the JS bundle.
import './global.css';

import React from 'react';
import { Platform, StatusBar, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { queryClientInstance } from './src/lib/query-client';
import { AuthProvider } from './src/lib/AuthContext';
import { Toaster } from './src/components/ui/Toaster';
import Navigation from './src/navigation';
import { env } from './src/lib/env';

// Configure Google Sign-In once at app startup.
// On iOS, iosClientId is required by the native module even though the Sign-In
// button is hidden on iOS — without it the configure() call rejects and crashes.
GoogleSignin.configure({
  webClientId: env.GOOGLE_CLIENT_ID,
  ...(Platform.OS === 'ios' && {
    iosClientId: env.IOS_CLIENT_ID || '491922250866-oj7n68jvo5faorv0aedoc6ps5inn4k93.apps.googleusercontent.com',
  }),
});

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
