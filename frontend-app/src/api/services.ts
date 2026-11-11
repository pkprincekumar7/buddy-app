// One typed client per service (build plan 7.1), from the specs in backend/openapi/: the
// types in ./generated are written by scripts/sync-api-clients.mjs, so a path, a body or a
// response that changes in a service fails the typecheck here.
//
//   await unwrap(services.auth.POST('/api/v1/auth/logout'));
//
// Every call goes through serviceFetch: the stored access token as a Bearer header (React
// Native has no cookie jar, as client.ts explains), the token pair kept from any response
// that carries one, and one refresh and retry on a 401. An error response becomes an
// ApiError whose `code` is the service's `detail.code`. Screens move here from client.ts as
// they move to the new API (7.2–7.8).

import createClient from 'openapi-fetch';
import {
  captureTokens,
  dispatchAuthExpired,
  ensureRefreshed,
  isSessionEnded,
  resolveAuthExpiry,
  tokenStore,
} from './client';
import { ApiError } from './errors';
import type { paths as AuthPaths } from './generated/auth';
import type { paths as ChildrenPaths } from './generated/children';
import type { paths as DiscoverPaths } from './generated/discover';
import type { paths as GrowPaths } from './generated/grow';
import type { paths as OnboardingPaths } from './generated/onboarding';
import type { paths as ReleasePaths } from './generated/release';
import type { paths as SharedPaths } from './generated/shared';
import type { paths as TransformPaths } from './generated/transform';
import type { paths as UsersPaths } from './generated/users';
import { env } from '@/lib/env';

const baseUrl = (env.API_URL ?? '').replace(/\/$/, '');

// The sign-in and token routes answer 401 for a wrong password or a spent refresh token:
// no refresh. Every other route, auth's `/me`, `/account` and admin ones included, gets one
// refresh on a 401 (an access token that expired while the app was open).
const NO_REFRESH = new Set(
  ['login', 'register', 'google', 'refresh', 'logout'].map(
    route => `/api/v1/auth/${route}`,
  ),
);

async function withToken(input: Request): Promise<Request> {
  // A caller that sends its own token keeps it: logout sends the refresh token.
  if (input.headers.has('Authorization')) return input;
  const access = await tokenStore.getAccess();
  if (!access) return input;
  const headers = new Headers(input.headers);
  headers.set('Authorization', `Bearer ${access}`);
  return new Request(input, { headers });
}

async function keepTokens(response: Response): Promise<Response> {
  if (
    response.ok &&
    response.headers.get('content-type')?.includes('application/json')
  ) {
    try {
      await captureTokens(await response.clone().json());
    } catch {
      /* an empty or non-JSON body carries no tokens */
    }
  }
  return response;
}

/** fetch for the generated clients: as client.ts's request(), with the Bearer token. */
export async function serviceFetch(input: Request): Promise<Response> {
  const retry = input.clone();
  const response = await fetch(await withToken(input));
  if (response.status !== 401 || NO_REFRESH.has(new URL(input.url).pathname)) {
    return keepTokens(response);
  }
  try {
    await ensureRefreshed();
  } catch (err) {
    // A refresh that merely failed (offline, 5xx, 429) keeps the session: the caller gets
    // that error, not the 401, so nothing treats it as signed out (AuthContext shows its
    // retry screen instead of logging out, which would revoke the session).
    if (!isSessionEnded(err)) throw err;
    const { status, message } = resolveAuthExpiry(err);
    dispatchAuthExpired(status, message);
    return response;
  }
  return keepTokens(await fetch(await withToken(retry)));
}

function client<Paths extends object>() {
  return createClient<Paths>({
    baseUrl,
    credentials: 'include',
    fetch: serviceFetch,
  });
}

export const services = {
  auth: client<AuthPaths>(),
  users: client<UsersPaths>(),
  children: client<ChildrenPaths>(),
  onboarding: client<OnboardingPaths>(),
  discover: client<DiscoverPaths>(),
  grow: client<GrowPaths>(),
  transform: client<TransformPaths>(),
  release: client<ReleasePaths>(),
  shared: client<SharedPaths>(),
};

type Result<T> = { data?: T; error?: unknown; response: Response };

/** The call's data, or an ApiError with the service's `detail` (and its `code`). */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok) return data as T;
  throw new ApiError(response.status, detailOf(error, response));
}

function detailOf(
  error: unknown,
  response: Response,
): string | Record<string, unknown> {
  const detail = isObject(error) ? error.detail : undefined;
  if (typeof detail === 'string') return detail;
  // FastAPI's 422: a list of problems, given a code like every other refusal.
  if (Array.isArray(detail)) return { code: 'invalid_request', errors: detail };
  if (isObject(detail)) return detail;
  return `${response.status} ${response.statusText}`.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
