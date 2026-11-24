/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  // Worklets ships a resolver that skips its *.native.* files under Jest.
  resolver: 'react-native-worklets/jest/resolver',

  // Path alias @/ → src/
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.css$': '<rootDir>/__mocks__/styleMock.js',
    '\\.(ttf|mp3|mp4|png|jpg)$': '<rootDir>/__mocks__/fileMock.js',
    // lucide-react-native's own CommonJS build. From 1.74 its exports send the "react-native"
    // condition (which Jest's React Native environment uses) to the ESM .mjs build, and the
    // preset only runs Babel on .js/.ts/.tsx, so `export` failed. Jest only: Metro still
    // bundles the ESM build.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },

  // Extend Jest with RNTL + jest-native matchers
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Transform RN packages that ship ESM / modern JS
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|nativewind|react-native-css-interop|react-native-reanimated|react-native-worklets|react-native-toast-message|@shopify/react-native-skia|victory-native|@notifee|lucide-react-native|react-native-svg|react-native-safe-area-context|@react-native-async-storage|react-native-config|react-native-gesture-handler|expo|expo-.*|@expo|@mhpdev|@react-native-google-signin)/)',
  ],
};
