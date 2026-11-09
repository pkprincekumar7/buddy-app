import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { ApiError } from './errors';
import { env } from '@/lib/env';
import { DeviceEventEmitter } from 'react-native';

// ---------------------------------------------------------------------------
// Token store — the iOS Keychain / Android Keystore (expo-secure-store), a manual
// cookie jar for React Native. Not AsyncStorage: that is plain files, readable from a
// rooted device or an unencrypted backup, and the refresh token is a long-lived login.
//
// The JS fetch polyfill in React Native has no cookie jar: Set-Cookie response
// headers are silently discarded and credentials: 'include' is a no-op.
// We solve this by:
//   1. Reading access_token / refresh_token from the login/register/refresh
//      response bodies (the backend sets these in addition to HttpOnly cookies,
//      so the web app continues to use cookies unchanged).
//   2. Sending the access_token as an Authorization: Bearer header on every
//      request.
//   3. On 401, sending the refresh_token as Authorization: Bearer to /auth/refresh
//      and storing the new token pair.
// ---------------------------------------------------------------------------

// SecureStore keys allow only letters, digits, ".", "-" and "_".
export const ACCESS_KEY = 'superpower.access_token';
export const REFRESH_KEY = 'superpower.refresh_token';

// Only while the device is unlocked, and never restored onto another device from a backup.
const SECURE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// Once per app start, before the store is used:
// - A fresh install forgets any tokens. The iOS Keychain outlives an uninstall, while
//   AsyncStorage (the app's own files) doesn't, so a missing INSTALLED_KEY means this
//   install never signed in, and a Keychain pair from before belongs to whoever used the
//   app last. Without this, reinstalling would sign straight back into their account.
// - Builds before the move kept the tokens in AsyncStorage. They're deleted, not moved:
//   a plaintext copy must not stay behind, and signing in once more is the whole cost.
const INSTALLED_KEY = 'superpower:installed';
const PLAINTEXT_KEYS = ['superpower:access_token', 'superpower:refresh_token'];
let prepared: Promise<void> | null = null;
function prepare(): Promise<void> {
  prepared ??= (async () => {
    await AsyncStorage.removeMany(PLAINTEXT_KEYS);
    if ((await AsyncStorage.getItem(INSTALLED_KEY)) === null) {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY, SECURE),
        SecureStore.deleteItemAsync(REFRESH_KEY, SECURE),
      ]);
      await AsyncStorage.setItem(INSTALLED_KEY, '1');
    }
  })().catch((err: unknown) => {
    prepared = null; // tried again on the next use
    throw err; // never hand out a pair this install may not own
  });
  return prepared;
}

/** Also used by api/services.ts, the generated clients' fetch. */
export const tokenStore = {
  async getAccess(): Promise<string | null> {
    await prepare();
    return SecureStore.getItemAsync(ACCESS_KEY, SECURE);
  },
  async getRefresh(): Promise<string | null> {
    await prepare();
    return SecureStore.getItemAsync(REFRESH_KEY, SECURE);
  },
  async set(access: string, refresh: string): Promise<void> {
    await prepare(); // after a fresh install's clean-up, never wiped by it
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, access, SECURE),
      SecureStore.setItemAsync(REFRESH_KEY, refresh, SECURE),
    ]);
  },
  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY, SECURE),
      SecureStore.deleteItemAsync(REFRESH_KEY, SECURE),
    ]);
  },
};

function joinApi(path: string): string {
  const base = (env.API_URL ?? '').replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api/v1${suffix}`;
}

let refreshPromise: Promise<void> | null = null;

/** One refresh at a time, shared by every caller (and by api/services.ts). */
export function ensureRefreshed(): Promise<void> {
  refreshPromise ??= refreshTokenPair().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// A failed refresh is normally a plain expired session (401, generic message).
// A locked account fails with 403 and a specific reason (see auth's
// _refuse_refresh and _rejected: {"code": "account_locked", "msg": ...}) — resolved
// once here so every caller that reacts to a failed refresh (serviceFetch's retry,
// and AuthContext's silent-refresh timer) surfaces the same status/message instead
// of each re-deriving it.
export function resolveAuthExpiry(err: unknown): {
  status: 401 | 403;
  message: string;
} {
  if (err instanceof ApiError && err.status === 403) {
    if (err.code === 'account_locked' && typeof err.detail !== 'string') {
      const msg = err.detail.msg;
      if (typeof msg === 'string') return { status: 403, message: msg };
    }
    if (typeof err.detail === 'string') {
      return { status: 403, message: err.detail };
    }
  }
  return { status: 401, message: 'Session expired' };
}

/** Only a refresh the auth service refused (401/403) ends the session: a network error,
 *  a 5xx or a 429 from the refresh limit leaves the user signed in (as the silent-refresh
 *  timer in AuthContext does). */
export function isSessionEnded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/** Event name AuthContext listens on — RN's stand-in for the web's window CustomEvent. */
export const AUTH_EXPIRED_EVENT = 'superpower:auth-expired';

export function dispatchAuthExpired(status: number, message: string): void {
  DeviceEventEmitter.emit(
    AUTH_EXPIRED_EVENT,
    status === 403 ? { message } : undefined,
  );
}

/** Login / register / refresh / google return the token pair in the body as well as cookies. */
export async function captureTokens(json: unknown): Promise<void> {
  if (json === null || typeof json !== 'object') return;
  const { access_token, refresh_token } = json as Record<string, unknown>;
  if (typeof access_token === 'string' && typeof refresh_token === 'string') {
    await tokenStore.set(access_token, refresh_token);
  }
}

async function refreshTokenPair(): Promise<void> {
  // The refresh endpoint validates the refresh token sent as a Bearer header
  // (no cookie jar on RN), so this can't go through request() — that would
  // attach the expired access token instead.
  const refreshToken = await tokenStore.getRefresh();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (refreshToken) headers.Authorization = `Bearer ${refreshToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(joinApi('/auth/refresh'), {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    // Not an AbortError: callers read that as "the screen went away" and stop silently,
    // which would leave a generation spinning. A timed-out refresh is a plain failure.
    if (controller.signal.aborted)
      throw new Error('The session refresh timed out.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let detail: string | Record<string, unknown> = 'Refresh failed';
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === 'string') detail = j.detail;
      else if (
        j.detail !== null &&
        typeof j.detail === 'object' &&
        !Array.isArray(j.detail)
      ) {
        // e.g. {"code": "account_locked", "msg": ...}: kept whole for resolveAuthExpiry.
        detail = j.detail as Record<string, unknown>;
      }
    } catch {
      /* non-JSON body */
    }
    // Only a refused refresh spends the pair: a 5xx, a 429 or a timeout keeps it, so the
    // next attempt can still refresh.
    if (res.status === 401 || res.status === 403) await tokenStore.clear();
    throw new ApiError(res.status, detail);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return; /* empty body */
  }
  // Not caught: the server has already rotated the pair, so a failed save (a locked
  // device, a Keystore error) must fail this refresh rather than keep the old refresh
  // token, whose next use would look like reuse and revoke the session.
  await captureTokens(body);
}

export const api = {
  auth: {
    // The sign-in calls moved to api/account.ts (build plan 7.2); the refresh stays here,
    // shared by request() and the generated clients.
    async silentRefresh(): Promise<void> {
      return ensureRefreshed(); // never alongside a request-triggered refresh
    },
  },
};
