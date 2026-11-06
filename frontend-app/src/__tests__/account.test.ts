import AsyncStorage from '@react-native-async-storage/async-storage';
import { account, displayName, firstName } from '@/api/account';
import { ApiError } from '@/api/errors';
import { httpErrorMessage } from '@/lib/apiError';

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

const ACCESS = 'superpower:access_token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function network(...answers: ((url: string) => Response)[]): string[] {
  const seen: string[] = [];
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      seen.push(`${request.method} ${new URL(request.url).pathname}`);
      const answer = answers.shift();
      if (!answer) throw new Error(`unexpected call to ${request.url}`);
      return answer(request.url);
    },
  ) as typeof fetch;
  return seen;
}

const ME = {
  id: 'u1',
  email: 'sarah@example.com',
  role: 'parent',
  auth_provider: 'password',
  location: 'in',
};
const PROFILE = {
  id: 'u1',
  location: 'in',
  first_name: 'Sarah',
  middle_name: null,
  last_name: 'Johnson',
  address_line_one: null,
  address_line_two: null,
  address_line_three: null,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};

beforeEach(async () => {
  await AsyncStorage.setItem(ACCESS, 'access-1');
});

describe('the account (build plan 7.2)', () => {
  it('reads the name from the profile, next to /auth/me', async () => {
    const seen = network(
      () => json(200, ME),
      () => json(200, PROFILE),
    );
    const user = await account.current();
    expect(seen).toEqual([
      'GET /api/v1/auth/me',
      'GET /api/v1/users/me/profile',
    ]);
    expect(firstName(user)).toBe('Sarah');
    expect(displayName(user)).toBe('Sarah Johnson');
  });

  it('still signs in without the profile, greeting "there"', async () => {
    network(
      () => json(200, ME),
      () => json(503, { detail: 'users is down' }),
    );
    const user = await account.current();
    expect(user.profile).toBeNull();
    expect(firstName(user) ?? 'there').toBe('there');
    expect(displayName(user)).toBeNull();
    expect(firstName({ profile: { ...PROFILE, first_name: '  ' } })).toBeNull();
  });

  it('registers with the names and address lines, and keeps the tokens', async () => {
    let sent: Record<string, unknown> = {};
    globalThis.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input as RequestInfo, init);
        sent = (await request.json()) as Record<string, unknown>;
        return json(201, {
          status: 'ok',
          access_token: 'a-2',
          refresh_token: 'r-2',
        });
      },
    ) as typeof fetch;
    await account.register('sarah@example.com', 'pass-word-1', 'IN', {
      first_name: 'Sarah',
      last_name: 'Johnson',
      address_line_one: '1 High Street',
    });
    expect(sent).toMatchObject({
      email: 'sarah@example.com',
      country_code: 'IN',
      first_name: 'Sarah',
      last_name: 'Johnson',
      address_line_one: '1 High Street',
    });
    expect(sent).not.toHaveProperty('full_name');
    expect(await AsyncStorage.getItem(ACCESS)).toBe('a-2');
  });

  it('signs out (even if the server is unreachable) and forgets the tokens', async () => {
    network(() => {
      throw new TypeError('Network request failed');
    });
    await account.logout();
    expect(await AsyncStorage.getItem(ACCESS)).toBeNull();
  });

  it('signs out with the refresh token, so the server ends that session', async () => {
    await AsyncStorage.setItem(ACCESS, 'access-1');
    await AsyncStorage.setItem('superpower:refresh_token', 'refresh-1');
    let sent: string | null = null;
    globalThis.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        sent = new Request(input as RequestInfo, init).headers.get(
          'Authorization',
        );
        return new Response(null, { status: 204 });
      },
    ) as typeof fetch;
    await account.logout();
    expect(sent).toBe('Bearer refresh-1');
    expect(await AsyncStorage.getItem('superpower:refresh_token')).toBeNull();
  });

  it('signs out of every device with logout-all', async () => {
    const seen = network(() => new Response(null, { status: 204 }));
    await account.logoutAll();
    expect(seen).toEqual(['POST /api/v1/auth/logout-all']);
  });

  it('keeps only tts_enabled in the preferences', async () => {
    const seen = network(() => json(200, { tts_enabled: false }));
    expect(await account.preferences.patch({ tts_enabled: false })).toEqual({
      tts_enabled: false,
    });
    expect(seen).toEqual(['PATCH /api/v1/users/me/preferences']);
  });
});

describe('error messages matched on detail.code', () => {
  const tooMany = new ApiError(429, {
    code: 'too_many_attempts',
    msg: 'Too many attempts.',
  });

  it('prefer the code, then the status, then the service message', () => {
    const options = {
      codeMessages: { too_many_attempts: 'Wait 15 minutes.' },
      statusMessages: { 429: 'Slow down.' },
    };
    expect(httpErrorMessage(tooMany, options)).toBe('Wait 15 minutes.');
    expect(
      httpErrorMessage(tooMany, { statusMessages: { 429: 'Slow down.' } }),
    ).toBe('Slow down.');
    expect(httpErrorMessage(tooMany)).toBe('Too many attempts.');
  });

  it("show a 422's first problem, without pydantic's prefix", () => {
    const invalid = new ApiError(422, {
      code: 'invalid_request',
      errors: [
        { msg: 'Value error, Password must contain at least one digit' },
      ],
    });
    expect(httpErrorMessage(invalid)).toBe(
      'Password must contain at least one digit',
    );
  });

  it('fall back for a detail with nothing to show', () => {
    expect(
      httpErrorMessage(new ApiError(500, { code: 'x' }), { fallback: 'Oops.' }),
    ).toBe('Oops.');
    expect(httpErrorMessage(new ApiError(500, 'Server error'))).toBe(
      'Server error',
    );
    expect(httpErrorMessage(new Error('offline'))).toBe('offline');
  });
});
