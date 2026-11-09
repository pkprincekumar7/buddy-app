import { ApiError } from './errors';

function joinApi(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
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

type RequestBody = Record<string, unknown> | FormData | undefined;

// A failed refresh is normally a plain expired session (401, generic message).
// A locked account fails with 403 and a specific reason (see auth's
// _refuse_refresh and _rejected: {"code": "account_locked", "msg": ...}) — resolved
// once here so every caller that reacts to a failed refresh (the request() retry
// below, serviceFetch, and AuthContext's silent-refresh timer) surfaces the same
// status/message instead of each re-deriving it.
export function resolveAuthExpiry(err: unknown): { status: 401 | 403; message: string } {
  if (err instanceof ApiError && err.status === 403) {
    if (err.code === 'account_locked' && typeof err.detail !== 'string') {
      const msg = err.detail['msg'];
      if (typeof msg === 'string') return { status: 403, message: msg };
    }
    if (typeof err.detail === 'string') return { status: 403, message: err.detail };
  }
  return { status: 401, message: 'Session expired' };
}

/** Only a refresh the auth service refused (401/403) ends the session: a network error,
 *  a 5xx or a 429 from the refresh limit leaves the user signed in (as the silent-refresh
 *  timer in AuthContext does). */
export function isSessionEnded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export function dispatchAuthExpired(status: number, message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('superpower:auth-expired', {
      detail: status === 403 ? { message } : undefined,
    }),
  );
}

async function request(
  path: string,
  {
    method = 'GET',
    body,
    headers: extraHeaders,
  }: { method?: string; body?: RequestBody; headers?: Record<string, string> } = {},
  _retry = false,
): Promise<unknown> {
  const headers: Record<string, string> = { ...extraHeaders };
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
    } catch (err) {
      if (!isSessionEnded(err)) throw err;
      const { status, message } = resolveAuthExpiry(err);
      dispatchAuthExpired(status, message);
      throw new ApiError(status, message);
    }
    // Outside the try: the retried call's own errors (a 403 circle_locked, a 404) are
    // the caller's to handle, never a reason to end the session.
    return request(path, { method, body, headers: extraHeaders }, true);
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
  try {
    await request('/auth/refresh', { method: 'POST' }, true);
  } catch (err) {
    // 409 refresh_superseded: another tab refreshed this session first, and its new
    // cookies are already in the browser, so this tab carries on with them.
    if (err instanceof ApiError && err.status === 409) return;
    throw err;
  }
}

export const api = {
  auth: {
    // The sign-in calls moved to api/account.ts (build plan 7.2); the refresh stays here,
    // shared by request() and the generated clients.
    async silentRefresh(): Promise<void> {
      return ensureRefreshed(); // never alongside a request()-triggered refresh
    },
  },
};
