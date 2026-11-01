import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './errors';
import { env } from '@/lib/env';
import { DeviceEventEmitter } from 'react-native';

// ---------------------------------------------------------------------------
// Token store — AsyncStorage-backed manual cookie jar for React Native.
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

const ACCESS_KEY = 'superpower:access_token';
const REFRESH_KEY = 'superpower:refresh_token';

/** Also used by api/services.ts, the generated clients' fetch. */
export const tokenStore = {
  async getAccess(): Promise<string | null> {
    return AsyncStorage.getItem(ACCESS_KEY);
  },
  async getRefresh(): Promise<string | null> {
    return AsyncStorage.getItem(REFRESH_KEY);
  },
  async set(access: string, refresh: string): Promise<void> {
    await Promise.all([
      AsyncStorage.setItem(ACCESS_KEY, access),
      AsyncStorage.setItem(REFRESH_KEY, refresh),
    ]);
  },
  async clear(): Promise<void> {
    await Promise.all([
      AsyncStorage.removeItem(ACCESS_KEY),
      AsyncStorage.removeItem(REFRESH_KEY),
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
// _refuse_refresh) — resolved once here so every caller that reacts to a failed
// refresh (serviceFetch's retry, and AuthContext's silent-refresh timer)
// surfaces the same status/message instead of each re-deriving it.
export function resolveAuthExpiry(err: unknown): {
  status: 401 | 403;
  message: string;
} {
  if (
    err instanceof ApiError &&
    err.status === 403 &&
    typeof err.detail === 'string'
  ) {
    return { status: 403, message: err.detail };
  }
  return { status: 401, message: 'Session expired' };
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
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let detail: string = 'Refresh failed';
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === 'string') detail = j.detail;
    } catch {
      /* non-JSON body */
    }
    await tokenStore.clear();
    throw new ApiError(res.status, detail);
  }
  try {
    await captureTokens(await res.json());
  } catch {
    /* empty body */
  }
}

export const api = {
  auth: {
    // The sign-in calls moved to api/account.ts (build plan 7.2); the refresh stays here,
    // shared by request() and the generated clients.
    async silentRefresh(): Promise<void> {
      return refreshTokenPair();
    },
  },
};
