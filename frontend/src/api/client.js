function joinApi(path) {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api/v1${suffix}`;
}

// Single in-flight refresh promise shared across concurrent requests.
let refreshPromise = null;

function ensureRefreshed() {
  if (!refreshPromise) {
    refreshPromise = refreshTokenPair().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body } = {}, _retry = false) {
  const headers = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(joinApi(path), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  // On first 401, attempt a token refresh then replay the original request once.
  if (res.status === 401 && !_retry) {
    try {
      await ensureRefreshed();
      return request(path, { method, body }, true);
    } catch {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('buddy360:auth-expired'));
      }
      const err = new Error('Session expired');
      err.status = 401;
      throw err;
    }
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const json = JSON.parse(text);
          detail = json?.detail ?? text;
        } catch {
          detail = text;
        }
      }
    } catch {
      /* ignore */
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }

  const ct = res.headers.get('content-type');
  if (ct && ct.includes('application/json')) {
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
  return undefined;
}

async function refreshTokenPair() {
  // Tokens live in HttpOnly cookies — the browser sends them automatically.
  // A 401 here means the refresh token is also expired; caller handles the fallout.
  await request('/auth/refresh', { method: 'POST' }, true);
}

export const api = {
  auth: {
    /** True auth check — verifies session cookie with the server. */
    async isAuthenticated() {
      try { await request('/auth/me'); return true; } catch { return false; }
    },

    async me() {
      return request('/auth/me');
    },

    /** Clears server-side cookies via POST /auth/logout. */
    async logout() {
      try {
        await request('/auth/logout', { method: 'POST' }, true);
      } catch {
        /* cookie cleared best-effort; proceed regardless */
      }
    },

    async redirectToLogin() {
      await api.auth.logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/Login';
      }
    },

    async register(email, password, full_name) {
      await request('/auth/register', {
        method: 'POST',
        body: { email, password, full_name: full_name || 'Parent' },
      });
    },

    async login(email, password) {
      await request('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
    },

    async google(id_token) {
      await request('/auth/google', {
        method: 'POST',
        body: { id_token },
      });
    },
  },

  integrations: {
    Core: {
      InvokeLLM: ({ prompt, response_json_schema }) =>
        request('/llm/invoke', { method: 'POST', body: { prompt, response_json_schema } }),
    },
  },

  audio: {
    /** Send a recorded audio Blob to Whisper for transcription. */
    transcribe(blob, filename = 'recording.webm') {
      const form = new FormData();
      form.append('audio', blob, filename);
      return request('/audio/transcribe', { method: 'POST', body: form });
    },
  },

  /** User preferences (TTS toggle etc.) */
  preferences: {
    get: () => request('/user/preferences'),
    patch: (body) => request('/user/preferences', { method: 'PATCH', body }),
  },

  /** Onboarding: phase, child data, personality, journey recommendations */
  onboarding: {
    get: () => request('/user/onboarding'),
    patch: (body) => request('/user/onboarding', { method: 'PATCH', body }),
  },

  /** Recommendations progress: sub-step UI state during the growth area flow */
  recommendationsProgress: {
    get: () => request('/user/recommendations-progress'),
    patch: (body) => request('/user/recommendations-progress', { method: 'PATCH', body }),
  },

  /** Completed growth areas: persistent record of each finished area */
  completedGrowthAreas: {
    list: () => request('/user/completed-growth-areas'),
    append: (body) => request('/user/completed-growth-areas', { method: 'POST', body }),
    clear: () => request('/user/completed-growth-areas', { method: 'DELETE' }),
  },

  /** Goals: parent concern + 3-month plan */
  goals: {
    get: () => request('/user/goals'),
    patch: (body) => request('/user/goals', { method: 'PATCH', body }),
  },

  entities: {
    Child: {
      async list(sort = '-created_date', limit = undefined) {
        const qs = new URLSearchParams();
        if (sort) qs.set('sort', sort);
        if (limit != null) qs.set('limit', String(limit));
        const q = qs.toString();
        return request(`/children${q ? `?${q}` : ''}`);
      },
      create: (payload) => request('/children', { method: 'POST', body: payload }),
      update: (id, patch) => request(`/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      delete: (id) => request(`/children/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    GrowthMission: {
      async filter(filters, sort = '-created_date', limit = 50) {
        const qs = new URLSearchParams({ sort });
        if (filters?.child_id) qs.set('child_id', filters.child_id);
        qs.set('limit', String(limit));
        return request(`/growth-missions?${qs.toString()}`);
      },
      bulkCreate: (items) => request('/growth-missions/bulk', { method: 'POST', body: { items } }),
    },
  },

  appLogs: {
    logUserInApp: () => Promise.resolve(),
  },
};
