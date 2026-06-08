import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './errors';
import type {
  UserRecord,
  ChildRecord,
  PreferencesRecord,
  GoalsRecord,
  CompletedGrowthAreasRecord,
} from '@/types/api';
import { env } from '@/lib/env';
import { navigateTo } from '@/lib/navigationRef';

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

const ACCESS_KEY = 'buddy360:access_token';
const REFRESH_KEY = 'buddy360:refresh_token';

const tokenStore = {
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
let _redirectingToLogin = false;

function ensureRefreshed(): Promise<void> {
  refreshPromise ??= refreshTokenPair().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

type RequestBody = Record<string, unknown> | FormData | undefined;

async function request(
  path: string,
  { method = 'GET', body }: { method?: string; body?: RequestBody } = {},
  _retry = false,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Attach stored access token as Bearer header so authenticated requests
  // work on React Native (fetch has no cookie jar).
  const accessToken = await tokenStore.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(joinApi(path), {
    method,
    headers,
    credentials: 'include',
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
        ? body
        : JSON.stringify(body),
  });

  // Save tokens returned in the response body (login / register / refresh).
  if (res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const text = await res.text();
      if (text) {
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          if (
            typeof json.access_token === 'string' &&
            typeof json.refresh_token === 'string'
          ) {
            await tokenStore.set(json.access_token, json.refresh_token);
          }
        } catch {
          /* not JSON or no tokens — ignore */
        }
        return JSON.parse(text) as unknown;
      }
      return undefined;
    }
    return undefined;
  }

  if (res.status === 401 && !_retry) {
    try {
      await ensureRefreshed();
      return await request(path, { method, body }, true);
    } catch {
      navigateTo('Auth');
      throw new ApiError(401, 'Session expired');
    }
  }

  let detail = `${res.status} ${res.statusText}`;
  try {
    const text = await res.text();
    if (text) {
      try {
        const json: unknown = JSON.parse(text);
        if (json !== null && typeof json === 'object' && 'detail' in json) {
          const d = (json as Record<string, unknown>).detail;
          if (typeof d === 'string') {
            detail = d;
          } else if (d !== null && typeof d === 'object') {
            throw new ApiError(res.status, d as Record<string, unknown>);
          } else {
            detail = text;
          }
        } else {
          detail = text;
        }
      } catch (inner) {
        if (inner instanceof ApiError) throw inner;
        detail = text;
      }
    }
  } catch (outer) {
    if (outer instanceof ApiError) throw outer;
    /* ignore network/parse errors — fall through to default detail */
  }
  throw new ApiError(res.status, detail);
}

async function refreshTokenPair(): Promise<void> {
  // Send the stored refresh token as Bearer header so the refresh endpoint
  // can validate it on React Native (no cookie jar).
  const refreshToken = await tokenStore.getRefresh();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (refreshToken) {
    headers.Authorization = `Bearer ${refreshToken}`;
  }

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
    await tokenStore.clear();
    throw new ApiError(res.status, 'Refresh failed');
  }

  const text = await res.text();
  if (text) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (
        typeof json.access_token === 'string' &&
        typeof json.refresh_token === 'string'
      ) {
        await tokenStore.set(json.access_token, json.refresh_token);
      }
    } catch {
      /* ignore */
    }
  }
}

export const api = {
  auth: {
    async isAuthenticated(): Promise<boolean> {
      try {
        await request('/auth/me');
        return true;
      } catch {
        return false;
      }
    },

    async me(): Promise<UserRecord> {
      return request('/auth/me') as Promise<UserRecord>;
    },

    async logout(): Promise<void> {
      try {
        await request('/auth/logout', { method: 'POST' }, true);
      } catch {
        /* cookie cleared best-effort; proceed regardless */
      }
      await tokenStore.clear();
    },

    async redirectToLogin(): Promise<void> {
      if (_redirectingToLogin) return;
      _redirectingToLogin = true;
      await api.auth.logout();
      navigateTo('Auth');
      _redirectingToLogin = false;
    },

    async register(
      email: string,
      password: string,
      full_name: string,
      country_code: string,
    ): Promise<void> {
      await request('/auth/register', {
        method: 'POST',
        body: {
          email,
          password,
          full_name: full_name || 'Parent',
          country_code,
        },
      });
    },

    async login(email: string, password: string): Promise<void> {
      await request('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
    },

    async google(id_token: string, country_code?: string): Promise<void> {
      await request('/auth/google', {
        method: 'POST',
        body: country_code ? { id_token, country_code } : { id_token },
      });
    },

    async deleteAccount(confirmEmail: string): Promise<void> {
      await request('/user/me', {
        method: 'DELETE',
        body: { confirm_email: confirmEmail },
      });
    },

    async silentRefresh(): Promise<void> {
      return refreshTokenPair();
    },
  },

  integrations: {
    Core: {
      InvokeLLM: ({
        prompt,
        response_json_schema,
      }: {
        prompt: string;
        response_json_schema?: Record<string, unknown>;
      }): Promise<unknown> =>
        request('/llm/invoke', {
          method: 'POST',
          body: { prompt, response_json_schema },
        }),
    },
  },

  audio: {
    transcribe(uri: string): Promise<unknown> {
      // Derive the file extension from the actual URI so the backend receives the
      // correct filename regardless of platform. Android records as .mp4 while iOS
      // records as .m4a — both are MPEG-4 audio but the extension matters for the
      // backend's allowlist check and for Whisper's file-type detection.
      const rawExt = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? 'mp4';
      const ext = ['m4a', 'mp4', 'wav', 'mp3', 'webm', 'ogg'].includes(rawExt)
        ? rawExt
        : 'mp4';
      const mimeMap: Record<string, string> = {
        m4a: 'audio/mp4',
        mp4: 'audio/mp4',
        wav: 'audio/wav',
        mp3: 'audio/mpeg',
        webm: 'audio/webm',
        ogg: 'audio/ogg',
      };
      const form = new FormData();
      // RN FormData uses { uri, name, type } instead of Blob
      form.append('audio', {
        uri,
        name: `recording.${ext}`,
        type: mimeMap[ext],
      } as unknown as Blob);
      return request('/audio/transcribe', { method: 'POST', body: form });
    },
  },

  preferences: {
    get: (): Promise<PreferencesRecord> =>
      request('/user/preferences') as Promise<PreferencesRecord>,
    patch: (body: Record<string, unknown>): Promise<PreferencesRecord> =>
      request('/user/preferences', {
        method: 'PATCH',
        body,
      }) as Promise<PreferencesRecord>,
  },

  completedGrowthAreas: {
    list: (childId: string): Promise<CompletedGrowthAreasRecord> =>
      request(
        `/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<CompletedGrowthAreasRecord>,
    append: (
      childId: string,
      body: Record<string, unknown>,
    ): Promise<CompletedGrowthAreasRecord> =>
      request(
        `/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`,
        {
          method: 'POST',
          body,
        },
      ) as Promise<CompletedGrowthAreasRecord>,
    clear: (childId: string): Promise<void> =>
      request(
        `/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`,
        {
          method: 'DELETE',
        },
      ) as Promise<void>,
  },

  goals: {
    get: (childId: string): Promise<GoalsRecord> =>
      request(
        `/user/goals?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<GoalsRecord>,
    patch: (
      childId: string,
      body: Record<string, unknown>,
    ): Promise<GoalsRecord> =>
      request(`/user/goals?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<GoalsRecord>,
  },

  entities: {
    Child: {
      async list(
        sort = '-created_date',
        limit?: number,
      ): Promise<ChildRecord[]> {
        const qs = new URLSearchParams();
        if (sort) qs.set('sort', sort);
        if (limit != null) qs.set('limit', String(limit));
        const q = qs.toString();
        return request(`/children${q ? `?${q}` : ''}`) as Promise<
          ChildRecord[]
        >;
      },
      get: (id: string): Promise<ChildRecord> =>
        request(`/children/${encodeURIComponent(id)}`) as Promise<ChildRecord>,
      create: (payload: Record<string, unknown>): Promise<ChildRecord> =>
        request('/children', {
          method: 'POST',
          body: payload,
        }) as Promise<ChildRecord>,
      update: (
        id: string,
        patch: Record<string, unknown>,
      ): Promise<ChildRecord> =>
        request(`/children/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: patch,
        }) as Promise<ChildRecord>,
      delete: (id: string): Promise<void> =>
        request(`/children/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }) as Promise<void>,
    },
  },
};
