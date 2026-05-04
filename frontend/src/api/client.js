const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';
const storage = typeof window !== 'undefined' ? window.sessionStorage : null;

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

async function request(path, { method = 'GET', body, auth = true } = {}, _retry = false) {
  const headers = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = storage?.getItem(ACCESS_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(joinApi(path), {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  // On first 401, try refreshing once then replay the original request.
  if (res.status === 401 && auth && !_retry) {
    try {
      await ensureRefreshed();
      return request(path, { method, body, auth }, true);
    } catch {
      clearStoredTokens();
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
      if (text) detail = text;
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

function storeTokensFromResponse(data) {
  if (!storage || !data) return;
  if (data.access_token) storage.setItem(ACCESS_KEY, data.access_token);
  if (data.refresh_token) storage.setItem(REFRESH_KEY, data.refresh_token);
}

function clearStoredTokens() {
  if (!storage) return;
  storage.removeItem(ACCESS_KEY);
  storage.removeItem(REFRESH_KEY);
}

async function refreshTokenPair() {
  if (!storage) {
    const e = new Error('No window');
    e.status = 401;
    throw e;
  }
  const access = storage.getItem(ACCESS_KEY);
  const refresh = storage.getItem(REFRESH_KEY);
  if (!access || !refresh) {
    const e = new Error('Missing tokens');
    e.status = 401;
    throw e;
  }
  const data = await request('/auth/refresh', {
    method: 'POST',
    auth: false,
    body: { access_token: access, refresh_token: refresh },
  });
  storeTokensFromResponse(data);
  return data;
}

export const api = {
  auth: {
    /** Fast synchronous check — token presence only, no network. Use as a guard in components. */
    hasToken() {
      return !!(storage?.getItem(ACCESS_KEY) && storage?.getItem(REFRESH_KEY));
    },

    /** True auth check — verifies token with the server. Use sparingly (app init, protected routes). */
    async isAuthenticated() {
      try { await request('/auth/me'); return true; } catch { return false; }
    },

    async me() {
      return request('/auth/me');
    },

    logout() {
      clearStoredTokens();
    },

    redirectToLogin() {
      api.auth.logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/Login';
      }
    },

    async register(email, password, full_name) {
      const data = await request('/auth/register', {
        method: 'POST',
        auth: false,
        body: { email, password, full_name: full_name || 'Parent' },
      });
      storeTokensFromResponse(data);
    },

    async login(email, password) {
      const data = await request('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password },
      });
      storeTokensFromResponse(data);
    },

    async google(id_token) {
      const data = await request('/auth/google', {
        method: 'POST',
        auth: false,
        body: { id_token },
      });
      storeTokensFromResponse(data);
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
      get: (id) => request(`/growth-missions/${encodeURIComponent(id)}`),
      create: (payload) => request('/growth-missions', { method: 'POST', body: payload }),
      update: (id, patch) => request(`/growth-missions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      bulkCreate: (items) => request('/growth-missions/bulk', { method: 'POST', body: { items } }),
    },

    ParentInsight: {
      async filter(filters, sort = '-created_date', limit = 5) {
        const qs = new URLSearchParams({ sort });
        if (filters?.child_id) qs.set('child_id', filters.child_id);
        if (filters?.is_read !== undefined && filters?.is_read !== null) qs.set('is_read', String(filters.is_read));
        qs.set('limit', String(limit));
        return request(`/parent-insights?${qs.toString()}`);
      },
      create: (payload) => request('/parent-insights', { method: 'POST', body: payload }),
      update: (id, body) => request(`/parent-insights/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      delete: (id) => request(`/parent-insights/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    Reflection: {
      async filter(filters, sort = '-created_date', limit = 10) {
        const qs = new URLSearchParams({ sort });
        if (filters?.child_id) qs.set('child_id', filters.child_id);
        qs.set('limit', String(limit));
        return request(`/reflections?${qs.toString()}`);
      },
      create: (payload) => request('/reflections', { method: 'POST', body: payload }),
      delete: (id) => request(`/reflections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
  },

  appLogs: {
    logUserInApp: () => Promise.resolve(),
  },
};
