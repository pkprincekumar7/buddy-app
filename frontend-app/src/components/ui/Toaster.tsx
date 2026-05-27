import React from 'react';
import RNToast from 'react-native-toast-message';

// Drop this at the root of your app (inside App.tsx) to enable toasts.
// Mirrors the web <Toaster /> component API.
function Toaster() {
  return <RNToast />;
}

export { Toaster };
