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
  default: { show: jest.fn(), hide: jest.fn() },
  BaseToast: 'BaseToast',
  ErrorToast: 'ErrorToast',
}));

jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  const React = require('react');
  const createAnimatedComponent = (C: unknown) => C;
  const mod = {
    default: {
      View,
      Text: View,
      ScrollView: View,
      FlatList: View,
      Image: View,
      createAnimatedComponent,
    },
    View,
    Text: View,
    ScrollView: View,
    FlatList: View,
    Image: View,
    createAnimatedComponent,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withDelay: (_: unknown, v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
    Easing: {
      out: (e: unknown) => e,
      in: (e: unknown) => e,
      inOut: (e: unknown) => e,
      linear: (v: unknown) => v,
      ease: 0,
    },
    cancelAnimation: jest.fn(),
    runOnJS: (fn: unknown) => fn,
    runOnUI: (fn: unknown) => fn,
    interpolate: (_v: unknown, _in: unknown, out: unknown[]) => out[0],
    Extrapolate: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    useAnimatedRef: () => React.createRef(),
    useAnimatedScrollHandler: () => jest.fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    __esModule: true,
  };
  return mod;
});
