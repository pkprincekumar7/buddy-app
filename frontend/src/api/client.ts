import { ApiError } from './errors';
import type {
  UserRecord,
  ChildRecord,
  PreferencesRecord,
  GoalsRecord,
  GoalMonthsRecord,
  GoalInsightsRecord,
  CompletedGrowthAreasRecord,
  EnqueueJobPayload,
  EnqueueJobResponse,
  JobStatusRecord,
  AllowedEmailRecord,
  AllowedEmailsPage,
  AdminUserRecord,
  AdminUsersPage,
} from '@/types/api';

function joinApi(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
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

  const res = await fetch(joinApi(path), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  if (res.status === 401 && !_retry) {
    try {
      await ensureRefreshed();
      return await request(path, { method, body }, true);
    } catch {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('buddy360:auth-expired'));
      }
      throw new ApiError(401, 'Session expired');
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
    return text ? (JSON.parse(text) as unknown) : undefined;
  }
  return undefined;
}

async function refreshTokenPair(): Promise<void> {
  await request('/auth/refresh', { method: 'POST' }, true);
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
    },

    async redirectToLogin(): Promise<void> {
      if (_redirectingToLogin) return;
      _redirectingToLogin = true;
      await api.auth.logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/Login';
      }
    },

    async register(
      email: string,
      password: string,
      full_name: string,
      country_code: string,
    ): Promise<void> {
      await request('/auth/register', {
        method: 'POST',
        body: { email, password, full_name: full_name || 'Parent', country_code },
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
        request('/llm/invoke', { method: 'POST', body: { prompt, response_json_schema } }),
    },
  },

  audio: {
    transcribe(blob: Blob, filename = 'recording.webm'): Promise<unknown> {
      const form = new FormData();
      form.append('audio', blob, filename);
      return request('/audio/transcribe', { method: 'POST', body: form });
    },
  },

  preferences: {
    get: (): Promise<PreferencesRecord> =>
      request('/user/preferences') as Promise<PreferencesRecord>,
    patch: (body: Record<string, unknown>): Promise<PreferencesRecord> =>
      request('/user/preferences', { method: 'PATCH', body }) as Promise<PreferencesRecord>,
  },

  completedGrowthAreas: {
    list: (childId: string): Promise<CompletedGrowthAreasRecord> =>
      request(
        `/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<CompletedGrowthAreasRecord>,
    append: (childId: string, body: Record<string, unknown>): Promise<void> =>
      request(`/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`, {
        method: 'POST',
        body,
      }) as Promise<void>,
    clear: (childId: string): Promise<void> =>
      request(`/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`, {
        method: 'DELETE',
      }) as Promise<void>,
  },

  goals: {
    get: (childId: string): Promise<GoalsRecord> =>
      request(`/user/goals?child_id=${encodeURIComponent(childId)}`) as Promise<GoalsRecord>,
    patch: (childId: string, body: Record<string, unknown>): Promise<GoalsRecord> =>
      request(`/user/goals?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<GoalsRecord>,
  },

  goalMonths: {
    get: (childId: string): Promise<GoalMonthsRecord> =>
      request(
        `/user/goal-months?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<GoalMonthsRecord>,
    patchOne: (
      childId: string,
      monthNumber: number,
      body: Record<string, unknown>,
    ): Promise<void> =>
      request(`/user/goal-months/${monthNumber}?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<void>,
    patchAll: (childId: string, body: Record<string, unknown>): Promise<void> =>
      request(`/user/goal-months?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<void>,
  },

  goalInsights: {
    get: (childId: string): Promise<GoalInsightsRecord> =>
      request(
        `/user/goal-insights?child_id=${encodeURIComponent(childId)}`,
      ) as Promise<GoalInsightsRecord>,
    patch: (childId: string, body: Record<string, unknown>): Promise<GoalInsightsRecord> =>
      request(`/user/goal-insights?child_id=${encodeURIComponent(childId)}`, {
        method: 'PATCH',
        body,
      }) as Promise<GoalInsightsRecord>,
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
      return request(`/admin/users?skip=${skip}&limit=${limit}`) as Promise<AdminUsersPage>;
    },
    lockUser(userId: string, location: string): Promise<AdminUserRecord> {
      return request(
        `/admin/users/${encodeURIComponent(userId)}/lock?location=${encodeURIComponent(location)}`,
        { method: 'PATCH' },
      ) as Promise<AdminUserRecord>;
    },
    unlockUser(userId: string, location: string): Promise<AdminUserRecord> {
      return request(
        `/admin/users/${encodeURIComponent(userId)}/unlock?location=${encodeURIComponent(location)}`,
        { method: 'PATCH' },
      ) as Promise<AdminUserRecord>;
    },
  },

  downloads: {
    // Web app only — the React Native app (frontend-app/) has its own update flow.
    // Returns a 5-minute pre-signed S3 URL pointing to the latest Android APK build.
    getApkUrl: (): Promise<{ url: string; filename: string; expires_in: number }> =>
      request('/downloads/apk') as Promise<{ url: string; filename: string; expires_in: number }>,
  },

  entities: {
    Child: {
      async list(sort = '-created_date', limit?: number): Promise<ChildRecord[]> {
        const qs = new URLSearchParams();
        if (sort) qs.set('sort', sort);
        if (limit != null) qs.set('limit', String(limit));
        const q = qs.toString();
        return request(`/children${q ? `?${q}` : ''}`) as Promise<ChildRecord[]>;
      },
      get: (id: string): Promise<ChildRecord> =>
        request(`/children/${encodeURIComponent(id)}`) as Promise<ChildRecord>,
      create: (payload: Record<string, unknown>): Promise<ChildRecord> =>
        request('/children', { method: 'POST', body: payload }) as Promise<ChildRecord>,
      update: (id: string, patch: Record<string, unknown>): Promise<ChildRecord> =>
        request(`/children/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: patch,
        }) as Promise<ChildRecord>,
      delete: (id: string): Promise<void> =>
        request(`/children/${encodeURIComponent(id)}`, { method: 'DELETE' }) as Promise<void>,
      uploadAvatar: async (id: string, photo: File): Promise<{ avatar_url: string }> => {
        const contentType = photo.type || 'image/jpeg';
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
          throw new Error(`S3 upload failed: ${s3Res.status} ${s3Res.statusText}`);
        }
        return { avatar_url };
      },
    },
  },
};
