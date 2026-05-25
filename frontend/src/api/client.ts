import { ApiError } from './errors';

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
          if (
            json !== null &&
            typeof json === 'object' &&
            'detail' in json &&
            typeof (json as Record<string, unknown>)['detail'] === 'string'
          ) {
            detail = (json as { detail: string }).detail;
          } else {
            detail = text;
          }
        } catch {
          detail = text;
        }
      }
    } catch {
      /* ignore */
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

    async me(): Promise<unknown> {
      return request('/auth/me');
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
    get: (): Promise<unknown> => request('/user/preferences'),
    patch: (body: Record<string, unknown>): Promise<unknown> =>
      request('/user/preferences', { method: 'PATCH', body }),
  },

  completedGrowthAreas: {
    list: (childId: string): Promise<unknown> =>
      request(`/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`),
    append: (childId: string, body: Record<string, unknown>): Promise<unknown> =>
      request(`/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`, {
        method: 'POST',
        body,
      }),
    clear: (childId: string): Promise<unknown> =>
      request(`/user/completed-growth-areas?child_id=${encodeURIComponent(childId)}`, {
        method: 'DELETE',
      }),
  },

  goals: {
    get: (childId: string): Promise<unknown> =>
      request(`/user/goals?child_id=${encodeURIComponent(childId)}`),
    patch: (childId: string, body: Record<string, unknown>): Promise<unknown> =>
      request(`/user/goals?child_id=${encodeURIComponent(childId)}`, { method: 'PATCH', body }),
  },

  entities: {
    Child: {
      async list(sort = '-created_date', limit?: number): Promise<unknown> {
        const qs = new URLSearchParams();
        if (sort) qs.set('sort', sort);
        if (limit != null) qs.set('limit', String(limit));
        const q = qs.toString();
        return request(`/children${q ? `?${q}` : ''}`);
      },
      get: (id: string): Promise<unknown> => request(`/children/${encodeURIComponent(id)}`),
      create: (payload: Record<string, unknown>): Promise<unknown> =>
        request('/children', { method: 'POST', body: payload }),
      update: (id: string, patch: Record<string, unknown>): Promise<unknown> =>
        request(`/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      delete: (id: string): Promise<unknown> =>
        request(`/children/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
  },

  appLogs: {
    logUserInApp: (_pageName: string): Promise<void> => Promise.resolve(),
  },
};
