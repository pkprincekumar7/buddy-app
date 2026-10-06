import '@testing-library/jest-native/extend-expect';

// Gesture handler must be set up before tests that use react-navigation
import 'react-native-gesture-handler/jestSetup';

// Silence non-critical RN warnings in tests
jest
  .spyOn(console, 'warn')
  .mockImplementation((msg: string, ...rest: unknown[]) => {
    if (typeof msg === 'string' && msg.includes('VirtualizedLists')) return;
    if (typeof msg === 'string' && msg.includes('NativeWind')) return;

    console.warn(msg, ...rest);
  });

// Mock react-native-config so env vars resolve to empty strings in tests
jest.mock('react-native-config', () => ({
  default: {},
  GOOGLE_CLIENT_ID: '',
  API_URL: '',
}));

// Mock AsyncStorage (no official jest mock shipped in this version)
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    removeItem: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map(k => [k, store[k] ?? null])),
    ),
    multiSet: jest.fn((pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => {
        store[k] = v;
      });
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach(k => {
        delete store[k];
      });
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach(k => {
        delete store[k];
      });
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
  };
});

// Stub native modules that are unavailable in the Node test environment
jest.mock('@shopify/react-native-skia', () => ({
  matchFont: () => null,
  Skia: {},
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    requestPermission: jest.fn().mockResolvedValue({ authorizationStatus: 1 }),
    getNotificationSettings: jest
      .fn()
      .mockResolvedValue({ authorizationStatus: 1 }),
    createChannel: jest.fn().mockResolvedValue('buddy360'),
    displayNotification: jest.fn().mockResolvedValue(undefined),
    createTriggerNotification: jest.fn().mockResolvedValue('notification-id'),
    cancelNotification: jest.fn().mockResolvedValue(undefined),
    cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
    onForegroundEvent: jest.fn().mockReturnValue(() => undefined),
  },
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  AndroidImportance: { HIGH: 4 },
  TriggerType: { TIMESTAMP: 0 },
}));

jest.mock('victory-native', () => ({
  CartesianChart: 'CartesianChart',
  Line: 'Line',
  Bar: 'Bar',
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: Object.assign(() => null, { show: jest.fn(), hide: jest.fn() }),
  BaseToast: 'BaseToast',
  ErrorToast: 'ErrorToast',
}));

jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
  // CSS-animation timing helpers aren't in Reanimated's mock.
  cubicBezier: (...args: number[]) => `cubic-bezier(${args.join(',')})`,
  steps: (n: number) => `steps(${n})`,
}));

jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    release: jest.fn(),
    volume: 1,
    loop: false,
  })),
  useVideoPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  VideoView: 'VideoView',
}));

jest.mock('expo', () => ({ useEventListener: jest.fn(), useEvent: jest.fn() }));

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest
    .fn()
    .mockResolvedValue({ canceled: true, assets: null }),
  launchCameraAsync: jest
    .fn()
    .mockResolvedValue({ canceled: true, assets: null }),
  requestMediaLibraryPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true }),
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
}));

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

jest.mock('@mhpdev/react-native-speech', () => ({
  __esModule: true,
  default: {
    speak: jest.fn().mockResolvedValue('id'),
    stop: jest.fn().mockResolvedValue(undefined),
    configure: jest.fn(),
    onFinish: jest.fn(() => ({ remove: jest.fn() })),
    onStopped: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
  statusCodes: {},
  isSuccessResponse: jest.fn(() => false),
}));
