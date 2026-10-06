import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './errors';
import { locationHint } from '@/lib/locationHint';
import type {
  UserRecord,
  ChildRecord,
  PreferencesRecord,
  ObservationsRecord,
  NinetyDayPlanRecord,
  CompletedGrowthAreasRecord,
  EnqueueJobPayload,
  EnqueueJobResponse,
  JobStatusRecord,
  AdminUserRecord,
  AllowedEmailRecord,
  AllowedEmailsPage,
  AdminUsersPage,
} from '@/types/api';
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

// A failed refresh is normally a plain expired session (401, generic message).
// A locked account fails with 403 and a specific reason (see backend's
// refresh_tokens) — resolved once here so every caller that reacts to a failed
// refresh (the request() retry below, and AuthContext's silent-refresh timer)
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
export const AUTH_EXPIRED_EVENT = 'buddy360:auth-expired';

export function dispatchAuthExpired(status: number, message: string): void {
  DeviceEventEmitter.emit(
    AUTH_EXPIRED_EVENT,
    status === 403 ? { message } : undefined,
  );
}

async function request(
  path: string,
  {
    method = 'GET',
    body,
    headers: extraHeaders,
  }: {
    method?: string;
    body?: RequestBody;
    headers?: Record<string, string>;
  } = {},
  _retry = false,
): Promise<unknown> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // RN fetch has no cookie jar — send the stored access token as a Bearer header.
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

  if (res.status === 401 && !_retry) {
    try {
      await ensureRefreshed();
      return await request(path, { method, body, headers: extraHeaders }, true);
    } catch (err) {
      const { status, message } = resolveAuthExpiry(err);
      dispatchAuthExpired(status, message);
      throw new ApiError(status, message);
    }
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const json: unknown = JSON.parse(text);
          if (json !== null && typeof json === 'object' && 'detail' in json) {
            const d = (json as Record<string, unknown>)['detail'];
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

  const ct = res.headers.get('content-type');
  if (ct?.includes('application/json')) {
    const text = await res.text();
    if (!text) return undefined;
    const json = JSON.parse(text) as unknown;
    await captureTokens(json);
    return json;
  }
  return undefined;
}

/** Login / register / refresh / google return the token pair in the body as well as cookies. */
async function captureTokens(json: unknown): Promise<void> {
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
        /* server-side session cleared best-effort; proceed regardless */
      }
      await tokenStore.clear();
    },

    async redirectToLogin(): Promise<void> {
      if (_redirectingToLogin) return;
      _redirectingToLogin = true;
      await api.auth.logout();
      // AuthContext reacts to this by dropping the session, which swaps the
      // root navigator back to the Login screen.
      dispatchAuthExpired(401, 'Session expired');
      _redirectingToLogin = false;
    },

    async register(
      email: string,
      password: string,
      full_name: string,
      country_code: string,
    ): Promise<void> {
      // X-Client-Location is a best-effort routing hint only — see
      // @/lib/locationHint and the Lambda@Edge that reads it. The account's
      // real `location` field is always computed server-side from
      // country_code below, regardless of which region processes this call.
      const hint = locationHint(country_code);
      await request('/auth/register', {
        method: 'POST',
        body: {
          email,
          password,
          full_name: full_name || 'Parent',
          country_code,
        },
        headers: hint ? { 'X-Client-Location': hint } : undefined,
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
      const rawExt =
        uri.split('?')[0]?.split('.').pop()?.toLowerCase() ?? 'mp4';
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
    append: (childId: string, body: Record<string, unknown>): Promise<void> =>
      request(
        `/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`,
        {
          method: 'POST',
          body,
        },
      ) as Promise<void>,
    clear: (childId: string): Promise<void> =>
      request(
        `/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`,
        {
          method: 'DELETE',
        },
      ) as Promise<void>,
  },

  observations: {
    get: (childId: string): Promise<ObservationsRecord> =>
      request(
        `/user/observations?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<ObservationsRecord>,
    patch: (
      childId: string,
      body: Record<string, unknown>,
    ): Promise<ObservationsRecord> =>
      request(`/user/observations?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<ObservationsRecord>,
  },

  ninetyDayPlan: {
    get: (childId: string): Promise<NinetyDayPlanRecord> =>
      request(
        `/user/ninety-day-plan?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<NinetyDayPlanRecord>,
    patch: (
      childId: string,
      body: Record<string, unknown>,
    ): Promise<NinetyDayPlanRecord> =>
      request(`/user/ninety-day-plan?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<NinetyDayPlanRecord>,
    /** Uploads a photo directly to S3 for the given field, returning the public URL to persist. */
    uploadPhoto: async (
      childId: string,
      fieldKey: string,
      /** Local file URI from expo-image-picker. */
      photoUri: string,
      contentType: string = 'image/jpeg',
    ): Promise<{ photo_url: string }> => {
      const photo = await (await fetch(photoUri)).blob();
      const { upload_url, photo_url } = (await request(
        `/user/ninety-day-plan/photo-presign?child_id=${encodeURIComponent(
          childId,
        )}`,
        {
          method: 'POST',
          body: { field_key: fieldKey, content_type: contentType },
        },
      )) as { upload_url: string; photo_url: string };
      // Upload directly to S3 — must include the same Content-Type the presigned
      // URL was signed with, or S3 will reject the request (signature mismatch).
      const s3Res = await fetch(upload_url, {
        method: 'PUT',
        body: photo,
        headers: { 'Content-Type': contentType },
      });
      if (!s3Res.ok) {
        throw new Error(
          `S3 upload failed: ${s3Res.status} ${s3Res.statusText}`,
        );
      }
      return { photo_url };
    },
  },

  jobs: {
    enqueue: (payload: EnqueueJobPayload): Promise<EnqueueJobResponse> =>
      request('/jobs', {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      }) as Promise<EnqueueJobResponse>,
    poll: (jobId: string): Promise<JobStatusRecord> =>
      request(`/jobs/${encodeURIComponent(jobId)}`) as Promise<JobStatusRecord>,
  },

  admin: {
    listAllowedEmails(skip = 0, limit = 20): Promise<AllowedEmailsPage> {
      return request(
        `/admin/allowed-emails?skip=${skip}&limit=${limit}`,
      ) as Promise<AllowedEmailsPage>;
    },
    getAllowedEmail(email: string): Promise<AllowedEmailRecord> {
      return request(
        `/admin/allowed-emails/${encodeURIComponent(email)}`,
      ) as Promise<AllowedEmailRecord>;
    },
    addAllowedEmail(email: string): Promise<AllowedEmailRecord> {
      return request('/admin/allowed-emails', {
        method: 'POST',
        body: { email },
      }) as Promise<AllowedEmailRecord>;
    },
    removeAllowedEmail(email: string): Promise<void> {
      return request(`/admin/allowed-emails/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      }) as Promise<void>;
    },
    getUserByEmail(email: string): Promise<AdminUserRecord> {
      return request(
        `/admin/users/by-email/${encodeURIComponent(email)}`,
      ) as Promise<AdminUserRecord>;
    },
    listUsers(skip = 0, limit = 20): Promise<AdminUsersPage> {
      return request(
        `/admin/users?skip=${skip}&limit=${limit}`,
      ) as Promise<AdminUsersPage>;
    },
    lockUser(userId: string, location: string): Promise<AdminUserRecord> {
      return request(
        `/admin/users/${encodeURIComponent(
          userId,
        )}/lock?location=${encodeURIComponent(location)}`,
        { method: 'PATCH' },
      ) as Promise<AdminUserRecord>;
    },
    unlockUser(userId: string, location: string): Promise<AdminUserRecord> {
      return request(
        `/admin/users/${encodeURIComponent(
          userId,
        )}/unlock?location=${encodeURIComponent(location)}`,
        { method: 'PATCH' },
      ) as Promise<AdminUserRecord>;
    },
  },

  entities: {
    Child: {
      async list(
        sort = '-created_date',
        limit?: number,
      ): Promise<ChildRecord[]> {
        // RN's URLSearchParams polyfill is incomplete — build the query by hand.
        const q = [
          sort ? `sort=${encodeURIComponent(sort)}` : '',
          limit != null ? `limit=${limit}` : '',
        ]
          .filter(Boolean)
          .join('&');
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
      // One-way (false→true) Personality Journey progression flags, gated on
      // the previous step in the chain already being true. PATCH /children/{id}
      // silently ignores these fields — this is the only way to set them
      // (see backend/app/routers/children.py).
      markProgress: (
        id: string,
        flag:
          | 'onboarding_profile_completed'
          | 'discover_completed'
          | 'transform_visited'
          | 'release_visited'
          | 'connect_visited',
      ): Promise<ChildRecord> =>
        request(`/children/${encodeURIComponent(id)}/progress/${flag}`, {
          method: 'POST',
        }) as Promise<ChildRecord>,
      /** `photoUri` is a local file URI from expo-image-picker. */
      uploadAvatar: async (
        id: string,
        photoUri: string,
        contentType: string = 'image/jpeg',
      ): Promise<{ avatar_url: string }> => {
        const photo = await (await fetch(photoUri)).blob();
        const { upload_url, avatar_url } = (await request(
          `/children/${encodeURIComponent(id)}/avatar/presign`,
          { method: 'POST', body: { content_type: contentType } },
        )) as { upload_url: string; avatar_url: string };
        // Upload directly to S3 — must include the same Content-Type the presigned
        // URL was signed with, or S3 will reject the request (signature mismatch).
        const s3Res = await fetch(upload_url, {
          method: 'PUT',
          body: photo,
          headers: { 'Content-Type': contentType },
        });
        if (!s3Res.ok) {
          throw new Error(
            `S3 upload failed: ${s3Res.status} ${s3Res.statusText}`,
          );
        }
        return { avatar_url };
      },
    },
  },
};
