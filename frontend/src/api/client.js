const TOKEN_KEY = 'access_token';

function joinApi(path) {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api/v1${suffix}`;
}

async function request(path, { method = 'GET', body, auth = true, raw = false } = {}) {
  const headers = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(joinApi(path), {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

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

  if (raw) return res;
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('application/json')) return res.json();
  return undefined;
}

/**
 * Drops Base44-era dependencies: REST + Bearer token backed by Buddy360 backend.
 */
export const api = {
  async ensureSession() {
    if (typeof window === 'undefined') return;
    let token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      const data = await request('/auth/bootstrap', { method: 'POST', auth: false });
      token = data.access_token;
      window.localStorage.setItem(TOKEN_KEY, token);
    }
  },

  auth: {
    async isAuthenticated() {
      if (typeof window === 'undefined') return false;
      return !!window.localStorage.getItem(TOKEN_KEY);
    },

    async me() {
      return request('/auth/me');
    },

    logout(nextHref) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(TOKEN_KEY);
        if (typeof nextHref === 'string' && nextHref.length > 0) {
          window.location.href = nextHref;
        }
      }
    },

    /** Clears token and reloads — next load runs bootstrap demo session again. */
    redirectToLogin() {
      api.auth.logout();
      if (typeof window !== 'undefined') window.location.reload();
    },

    async register(email, password, full_name) {
      const data = await request('/auth/register', {
        method: 'POST',
        auth: false,
        body: { email, password, full_name: full_name || 'Parent' },
      });
      window.localStorage.setItem(TOKEN_KEY, data.access_token);
    },

    async login(email, password) {
      const data = await request('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password },
      });
      window.localStorage.setItem(TOKEN_KEY, data.access_token);
    },
  },

  integrations: {
    Core: {
      InvokeLLM: ({ prompt, response_json_schema }) =>
        request('/llm/invoke', { method: 'POST', body: { prompt, response_json_schema } }),
    },
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
      create(payload) {
        return request('/children', { method: 'POST', body: payload });
      },
      update(id, patch) {
        return request(`/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
      },
      delete(id) {
        return request(`/children/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    },

    GrowthMission: {
      async filter(filters, sort = '-created_date', limit = 50) {
        const qs = new URLSearchParams({ sort });
        if (filters?.child_id) qs.set('child_id', filters.child_id);
        if (filters?.is_read !== undefined && filters?.is_read !== null) qs.set('is_read', String(filters.is_read));
        qs.set('limit', String(limit));
        return request(`/growth-missions?${qs.toString()}`);
      },
      create(payload) {
        return request('/growth-missions', { method: 'POST', body: payload });
      },
      update(id, patch) {
        return request(`/growth-missions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
      },
      bulkCreate(items) {
        return request('/growth-missions/bulk', { method: 'POST', body: { items } });
      },
    },

    ParentInsight: {
      async filter(filters, sort = '-created_date', limit = 5) {
        const qs = new URLSearchParams({ sort });
        if (filters?.child_id) qs.set('child_id', filters.child_id);
        if (filters?.is_read !== undefined && filters?.is_read !== null) qs.set('is_read', String(filters.is_read));
        qs.set('limit', String(limit));
        return request(`/parent-insights?${qs.toString()}`);
      },
      create(payload) {
        return request('/parent-insights', { method: 'POST', body: payload });
      },
    },

    Reflection: {
      async filter(filters, sort = '-created_date', limit = 10) {
        const qs = new URLSearchParams({ sort });
        if (filters?.child_id) qs.set('child_id', filters.child_id);
        qs.set('limit', String(limit));
        return request(`/reflections?${qs.toString()}`);
      },
      create(payload) {
        return request('/reflections', { method: 'POST', body: payload });
      },
    },
  },

  userAppState: {
    async get() {
      return request('/user/app-state');
    },
    async patch(payload) {
      return request('/user/app-state', { method: 'PATCH', body: payload });
    },
    /** Upserts one completed area by id; server merges atomically into completed_growth_areas */
    appendCompletedGrowthArea(areaPayload) {
      return request('/user/app-state/completed-growth-area', { method: 'POST', body: areaPayload });
    },
  },

  appLogs: {
    logUserInApp() {
      return Promise.resolve();
    },
  },
};
