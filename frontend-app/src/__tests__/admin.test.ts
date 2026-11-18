import * as SecureStore from 'expo-secure-store';
import { admin, ADMIN_ERRORS, nameOf } from '@/api/admin';
import { httpErrorMessage } from '@/lib/apiError';

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

type Sent = { method: string; url: string; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers every call with `answer`, and keeps what was sent. */
function network(answer: (sent: Sent) => Response): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const text = await request.text();
      const call = {
        method: request.method,
        url: request.url,
        body: text ? JSON.parse(text) : undefined,
      };
      sent.push(call);
      return answer(call);
    },
  ) as typeof fetch;
  return sent;
}

const EMAIL = 'jane.doe+kids@example.com';
const ACCOUNT = {
  id: '6f1c2c1e-1b2a-4c3d-8e4f-5a6b7c8d9e0f',
  email: EMAIL,
  role: 'parent' as const,
  auth_provider: 'password' as const,
  location: 'in',
  locked: false,
  deleting: false,
  created_at: '2026-10-28T00:00:00Z',
};

beforeEach(async () => {
  await SecureStore.setItemAsync('superpower.access_token', 'admin-token');
});

describe('the admin calls (build plan 7.3)', () => {
  it('never put an email in a request URL', async () => {
    const sent = network(({ url }) =>
      url.includes('/search')
        ? json(404, { detail: { code: 'not_found', msg: 'No.' } })
        : json(201, { key: 'k1', email_hint: 'j***@example.com' }),
    );
    expect(await admin.accounts.search(EMAIL)).toBeNull();
    expect(await admin.allowedEmails.search(EMAIL)).toBeNull();
    await admin.allowedEmails.add(EMAIL);
    expect(sent).toHaveLength(3);
    for (const call of sent) {
      expect(call.method).toBe('POST');
      expect(decodeURIComponent(call.url)).not.toContain('@');
      expect(call.url).not.toContain(encodeURIComponent(EMAIL));
      expect(call.body).toEqual({ email: EMAIL }); // in the body instead
    }
  });

  it('lock, unlock and change a role with the owner location, by id', async () => {
    const sent = network(({ url }) =>
      url.includes('/role')
        ? json(200, { id: ACCOUNT.id, role: 'admin' })
        : json(200, { id: ACCOUNT.id, locked: url.includes('/lock') }),
    );
    expect((await admin.accounts.lock(ACCOUNT)).locked).toBe(true);
    expect((await admin.accounts.unlock(ACCOUNT)).locked).toBe(false);
    expect((await admin.accounts.setRole(ACCOUNT, 'admin')).role).toBe('admin');
    expect(
      sent.map(s => [s.method, s.url.replace('https://api.test', '')]),
    ).toEqual([
      ['POST', `/api/v1/auth/accounts/${ACCOUNT.id}/lock?location=in`],
      ['POST', `/api/v1/auth/accounts/${ACCOUNT.id}/unlock?location=in`],
      ['PATCH', `/api/v1/auth/accounts/${ACCOUNT.id}/role?location=in`],
    ]);
    expect(sent[2]?.body).toEqual({ role: 'admin' });
  });

  it('read a page of names in one call, and nothing for no ids', async () => {
    const sent = network(() =>
      json(200, {
        items: [
          { id: 'a', first_name: 'Ann', middle_name: null, last_name: 'Lee' },
          { id: 'b', first_name: 'Bo', middle_name: null, last_name: null },
        ],
      }),
    );
    const names = await admin.names(['a', 'b']);
    expect(sent.map(s => decodeURIComponent(s.url))).toEqual([
      'https://api.test/api/v1/users/profiles?ids=a,b',
    ]);
    expect(nameOf(names.get('a'))).toBe('Ann Lee');
    expect(nameOf(names.get('b'))).toBe('Bo');
    expect(nameOf(names.get('missing'))).toBeNull();
    expect(
      nameOf({ id: 'c', first_name: '', middle_name: null, last_name: null }),
    ).toBeNull();
    expect((await admin.names([])).size).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('remove an allow-list entry by its key, and list pages', async () => {
    const sent = network(({ method }) =>
      method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json(200, { items: [], total: 0, skip: 20, limit: 20 }),
    );
    await admin.allowedEmails.remove('key-123');
    await admin.allowedEmails.list(20, 20);
    await admin.accounts.list(0, 20);
    expect(
      sent.map(s => `${s.method} ${s.url.replace('https://api.test', '')}`),
    ).toEqual([
      'DELETE /api/v1/auth/allowed-emails/key-123',
      'GET /api/v1/auth/allowed-emails?skip=20&limit=20',
      'GET /api/v1/auth/accounts?skip=0&limit=20',
    ]);
  });

  it('show the last-admin refusal by its code, and rethrow other errors', async () => {
    network(() => json(409, { detail: { code: 'last_admin', msg: 'x' } }));
    const refused: Error = await admin.accounts.setRole(ACCOUNT, 'parent').then(
      () => new Error('expected a refusal'),
      (err: unknown) => err as Error,
    );
    expect(httpErrorMessage(refused, { codeMessages: ADMIN_ERRORS })).toBe(
      ADMIN_ERRORS.last_admin,
    );
    network(() => json(503, { detail: 'auth is down' }));
    await expect(admin.accounts.search(EMAIL)).rejects.toMatchObject({
      status: 503,
    });
  });
});
