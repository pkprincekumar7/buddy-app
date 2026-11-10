import * as SecureStore from 'expo-secure-store';
import { DeviceEventEmitter } from 'react-native';
import {
  AUTH_EXPIRED_EVENT,
  isSessionEnded,
  resolveAuthExpiry,
} from '@/api/client';
import { ApiError } from '@/api/errors';
import { services, unwrap } from '@/api/services';

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

const ACCESS = 'superpower.access_token';
const REFRESH = 'superpower.refresh_token';

type Seen = { url: string; auth: string | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake network: each call answered by the next handler, and what was sent kept. */
function network(...answers: ((seen: Seen) => Response)[]): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const call = {
        url: request.url,
        auth: request.headers.get('authorization'),
      };
      seen.push(call);
      const answer = answers.shift();
      if (!answer) throw new Error(`unexpected call to ${call.url}`);
      return answer(call);
    },
  ) as typeof fetch;
  return seen;
}

beforeEach(async () => {
  await SecureStore.setItemAsync(ACCESS, 'access-1');
  await SecureStore.setItemAsync(REFRESH, 'refresh-1');
});

describe('the generated service clients (build plan 7.1)', () => {
  it('send the stored access token and return the typed data', async () => {
    const seen = network(() =>
      json(200, {
        url: 'https://s3.test/apk',
        filename: 'superpower-android.apk',
        expires_in: 300,
      }),
    );
    const link = await unwrap(services.shared.GET('/api/v1/downloads/apk'));
    expect(link.expires_in).toBe(300);
    expect(seen).toEqual([
      { url: 'https://api.test/api/v1/downloads/apk', auth: 'Bearer access-1' },
    ]);
  });

  it('refresh once on a 401 and retry with the new token', async () => {
    const seen = network(
      () => json(401, { detail: 'Not authenticated' }),
      () => json(200, { access_token: 'access-2', refresh_token: 'refresh-2' }),
      () => json(200, { tts_enabled: true }),
    );
    await unwrap(
      services.users.GET('/api/v1/users/{user_id}/preferences', {
        params: { path: { user_id: 'me' } },
      }),
    );
    expect(seen.map(s => [new URL(s.url).pathname, s.auth])).toEqual([
      ['/api/v1/users/me/preferences', 'Bearer access-1'],
      ['/api/v1/auth/refresh', 'Bearer refresh-1'],
      ['/api/v1/users/me/preferences', 'Bearer access-2'],
    ]);
  });

  it('refresh for auth routes that need a session, such as /auth/me', async () => {
    // The app opening with an expired access token must not sign the parent out.
    const seen = network(
      () => json(401, { detail: 'Not authenticated' }),
      () => json(200, { access_token: 'access-2', refresh_token: 'refresh-2' }),
      () => json(200, { id: 'u1' }),
    );
    await unwrap(services.auth.GET('/api/v1/auth/me'));
    expect(seen.map(s => new URL(s.url).pathname)).toEqual([
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
    ]);
  });

  it("don't refresh on auth's own 401s, and keep a token pair a response carries", async () => {
    network(() =>
      json(401, { detail: { code: 'invalid_credentials', msg: 'No.' } }),
    );
    const refused = unwrap(
      services.auth.POST('/api/v1/auth/login', {
        body: { email: 'a@b.c', password: 'x' },
      }),
    );
    await expect(refused).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
    network(() =>
      json(200, {
        status: 'ok',
        access_token: 'access-9',
        refresh_token: 'refresh-9',
      }),
    );
    await unwrap(
      services.auth.POST('/api/v1/auth/login', {
        body: { email: 'a@b.c', password: 'y' },
      }),
    );
    expect(await SecureStore.getItemAsync(ACCESS)).toBe('access-9');
    expect(await SecureStore.getItemAsync(REFRESH)).toBe('refresh-9');
  });

  it('turn every error into an ApiError matched on detail.code', async () => {
    network(() =>
      json(403, {
        detail: { code: 'circle_locked', msg: 'Finish Release first.' },
      }),
    );
    const locked = await unwrap(
      services.children.POST('/api/v1/children/{id}/connect/visit', {
        params: { path: { id: '6f1c2c1e-1b2a-4c3d-8e4f-5a6b7c8d9e0f' } },
      }),
    ).catch((err: unknown) => err);
    expect(locked).toBeInstanceOf(ApiError);
    expect((locked as ApiError).code).toBe('circle_locked');

    // FastAPI's 422 is a list: given a code like every other refusal.
    network(() =>
      json(422, { detail: [{ loc: ['body', 'name'], msg: 'Field required' }] }),
    );
    const invalid = await unwrap(
      services.children.POST('/api/v1/children', { body: {} as never }),
    ).catch((err: unknown) => err as ApiError);
    expect(invalid).toMatchObject({ status: 422, code: 'invalid_request' });

    // A plain string detail, or none at all, has no code.
    network(
      () => json(500, { detail: 'boom' }),
      () => new Response('', { status: 502 }),
    );
    const plain = await unwrap(services.shared.GET('/api/health')).catch(
      e => e as ApiError,
    );
    expect(plain).toMatchObject({
      status: 500,
      detail: 'boom',
      code: undefined,
    });
    const empty = await unwrap(services.shared.GET('/api/health')).catch(
      e => e as ApiError,
    );
    expect(empty.status).toBe(502);
  });
});

describe('a failed refresh', () => {
  const prefs = () =>
    unwrap(
      services.users.GET('/api/v1/users/{user_id}/preferences', {
        params: { path: { user_id: 'me' } },
      }),
    );

  let expired: jest.Mock;
  let sub: { remove(): void };
  beforeEach(() => {
    expired = jest.fn();
    sub = DeviceEventEmitter.addListener(AUTH_EXPIRED_EVENT, expired);
  });
  afterEach(() => sub.remove());

  it("that merely failed (503) keeps the tokens and doesn't end the session", async () => {
    network(
      () => json(401, { detail: 'Not authenticated' }),
      () => json(503, { detail: 'Service unavailable' }),
    );
    await expect(prefs()).rejects.toMatchObject({ status: 503 });
    expect(expired).not.toHaveBeenCalled();
    expect(await SecureStore.getItemAsync(ACCESS)).toBe('access-1');
    expect(await SecureStore.getItemAsync(REFRESH)).toBe('refresh-1');
  });

  it('that hit the network keeps the tokens too', async () => {
    network(
      () => json(401, { detail: 'Not authenticated' }),
      () => {
        throw new TypeError('Network request failed');
      },
    );
    await expect(prefs()).rejects.toThrow('Network request failed');
    expect(expired).not.toHaveBeenCalled();
    expect(await SecureStore.getItemAsync(REFRESH)).toBe('refresh-1');
  });

  it('that was refused (401) clears the tokens and ends the session', async () => {
    network(
      () => json(401, { detail: 'Not authenticated' }),
      () => json(401, { detail: 'Invalid refresh token' }),
    );
    await expect(prefs()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith(undefined);
    expect(await SecureStore.getItemAsync(ACCESS)).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH)).toBeNull();
  });

  it("for a locked account surfaces the backend's message", async () => {
    network(
      () => json(401, { detail: 'Not authenticated' }),
      () =>
        json(403, {
          detail: { code: 'account_locked', msg: 'Your account is locked.' },
        }),
    );
    await expect(prefs()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledWith({
      message: 'Your account is locked.',
    });
    expect(await SecureStore.getItemAsync(REFRESH)).toBeNull();
  });
});

describe('resolveAuthExpiry / isSessionEnded', () => {
  it('read the account_locked msg, a string 403, or fall back', () => {
    expect(
      resolveAuthExpiry(
        new ApiError(403, { code: 'account_locked', msg: 'Locked.' }),
      ),
    ).toEqual({ status: 403, message: 'Locked.' });
    expect(resolveAuthExpiry(new ApiError(403, 'Nope.'))).toEqual({
      status: 403,
      message: 'Nope.',
    });
    expect(resolveAuthExpiry(new ApiError(401, 'x'))).toEqual({
      status: 401,
      message: 'Session expired',
    });
  });

  it('end the session only for a 401/403 ApiError', () => {
    expect(isSessionEnded(new ApiError(401, 'x'))).toBe(true);
    expect(isSessionEnded(new ApiError(403, 'x'))).toBe(true);
    expect(isSessionEnded(new ApiError(503, 'x'))).toBe(false);
    expect(isSessionEnded(new ApiError(429, 'x'))).toBe(false);
    expect(isSessionEnded(new TypeError('offline'))).toBe(false);
  });
});
