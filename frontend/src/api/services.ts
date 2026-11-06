// One typed client per service (build plan 7.1), from the specs in backend/openapi/: the
// types in ./generated are written by scripts/sync-api-clients.mjs, so a path, a body or a
// response that changes in a service fails the typecheck here.
//
//   const link = await unwrap(services.shared.GET('/api/v1/downloads/apk'));
//
// Every call goes through serviceFetch: cookies, as for client.ts, and one refresh and retry
// on a 401. An error response becomes an ApiError whose `code` is the service's
// `detail.code`. Screens move here from client.ts as they move to the new API (7.2–7.8).

import createClient from 'openapi-fetch';
import { dispatchAuthExpired, ensureRefreshed, resolveAuthExpiry } from './client';
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

const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

// The sign-in and token routes answer 401 for a wrong password or a spent refresh token:
// no refresh. Every other route, auth's `/me`, `/account` and admin ones included, gets one
// refresh on a 401 (an access token that expired while the app was open).
const NO_REFRESH = new Set(
  ['login', 'register', 'google', 'refresh', 'logout'].map((route) => `/api/v1/auth/${route}`),
);

/** fetch for the generated clients: as client.ts's request(), one refresh and retry on 401. */
export async function serviceFetch(input: Request): Promise<Response> {
  const retry = input.clone();
  const response = await fetch(input);
  if (response.status !== 401 || NO_REFRESH.has(new URL(input.url).pathname)) {
    return response;
  }
  try {
    await ensureRefreshed();
  } catch (err) {
    const { status, message } = resolveAuthExpiry(err);
    dispatchAuthExpired(status, message);
    return response;
  }
  return fetch(retry);
}

function client<Paths extends object>() {
  return createClient<Paths>({ baseUrl, credentials: 'include', fetch: serviceFetch });
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

function detailOf(error: unknown, response: Response): string | Record<string, unknown> {
  const detail = isObject(error) ? error['detail'] : undefined;
  if (typeof detail === 'string') return detail;
  // FastAPI's 422: a list of problems, given a code like every other refusal.
  if (Array.isArray(detail)) return { code: 'invalid_request', errors: detail };
  if (isObject(detail)) return detail;
  return `${response.status} ${response.statusText}`.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
