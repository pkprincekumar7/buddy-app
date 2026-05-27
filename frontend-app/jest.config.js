/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',

  // Path alias @/ → src/
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Extend Jest with RNTL + jest-native matchers
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Transform RN packages that ship ESM / modern JS
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|nativewind|react-native-css-interop|react-native-reanimated|react-native-worklets|react-native-toast-message|@shopify/react-native-skia|victory-native|@notifee|lucide-react-native|react-native-svg|react-native-safe-area-context|@react-native-async-storage|react-native-config|react-native-gesture-handler)/)',
  ],
};
