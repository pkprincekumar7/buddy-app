import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { ACCESS_KEY, REFRESH_KEY, tokenStore } from '../api/client';

// The tokens live in the Keychain / Keystore (expo-secure-store), never in AsyncStorage's
// plain files, and a build from before the move leaves no plaintext copy behind.

const SECURE = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

test('tokens are saved in the secure store, for this device only while it is unlocked', async () => {
  await tokenStore.set('access-1', 'refresh-1');

  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    ACCESS_KEY,
    'access-1',
    SECURE,
  );
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    REFRESH_KEY,
    'refresh-1',
    SECURE,
  );
  expect(await tokenStore.getAccess()).toBe('access-1');
  expect(await tokenStore.getRefresh()).toBe('refresh-1');
  // No token in AsyncStorage's plain files (only the install flag goes there).
  const written = (AsyncStorage.setItem as jest.Mock).mock.calls.map(
    ([, value]) => value as string,
  );
  expect(written).not.toContain('access-1');
  expect(written).not.toContain('refresh-1');
});

test('the old plaintext tokens are deleted, not carried over', async () => {
  await AsyncStorage.setItem('superpower:access_token', 'old-access');
  await AsyncStorage.setItem('superpower:refresh_token', 'old-refresh');
  // A fresh module, as on the first start of an updated app: the clean-up runs once.
  let fresh: typeof tokenStore | undefined;
  jest.isolateModules(() => {
    fresh = (require('../api/client') as { tokenStore: typeof tokenStore })
      .tokenStore;
  });
  await fresh!.clear();

  expect(await fresh!.getRefresh()).toBeNull();
  expect(await AsyncStorage.getItem('superpower:access_token')).toBeNull();
  expect(await AsyncStorage.getItem('superpower:refresh_token')).toBeNull();
});

test('clear removes both tokens from the secure store', async () => {
  await tokenStore.set('access-2', 'refresh-2');
  await tokenStore.clear();

  expect(await tokenStore.getAccess()).toBeNull();
  expect(await tokenStore.getRefresh()).toBeNull();
});

function freshTokenStore(): typeof tokenStore {
  let fresh: typeof tokenStore | undefined;
  jest.isolateModules(() => {
    fresh = (require('../api/client') as { tokenStore: typeof tokenStore })
      .tokenStore;
  });
  return fresh!;
}

test('a fresh install forgets a Keychain pair left by an earlier install', async () => {
  // iOS keeps Keychain items after an uninstall; AsyncStorage goes with the app.
  await SecureStore.setItemAsync(ACCESS_KEY, 'someone-elses-access');
  await SecureStore.setItemAsync(REFRESH_KEY, 'someone-elses-refresh');
  await AsyncStorage.removeItem('superpower:installed');

  const store = freshTokenStore();
  expect(await store.getRefresh()).toBeNull();
  expect(await store.getAccess()).toBeNull();
  expect(await AsyncStorage.getItem('superpower:installed')).toBe('1');

  // Signing in on this install is kept.
  await store.set('access-3', 'refresh-3');
  expect(await store.getRefresh()).toBe('refresh-3');
});

test('an app that ran before keeps its tokens across a restart', async () => {
  await SecureStore.setItemAsync(ACCESS_KEY, 'access-4');
  await SecureStore.setItemAsync(REFRESH_KEY, 'refresh-4');

  const store = freshTokenStore();
  expect(await store.getRefresh()).toBe('refresh-4');
});

test('if the fresh-install clean-up fails, no token is handed out', async () => {
  await SecureStore.setItemAsync(REFRESH_KEY, 'someone-elses-refresh');
  await AsyncStorage.removeItem('superpower:installed');
  (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(
    new Error('The device is locked'),
  );

  const store = freshTokenStore();
  await expect(store.getRefresh()).rejects.toThrow('The device is locked');
  // Tried again on the next use, and then it works.
  expect(await store.getRefresh()).toBeNull();
});
