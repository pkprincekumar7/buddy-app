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
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
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
