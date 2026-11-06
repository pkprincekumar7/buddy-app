// The admin screen's calls (build plan 7.3), through the generated clients: accounts and
// the allow-list on auth, names on users. An email only ever travels in a request body
// (`…/search`), never in a URL; an allow-list entry is removed by its `key`.

import type { components as AuthComponents } from './generated/auth';
import type { components as UsersComponents } from './generated/users';
import { ApiError } from './errors';
import { services, unwrap } from './services';

type AuthSchemas = AuthComponents['schemas'];

export type Account = AuthSchemas['Account'];
export type AccountPage = AuthSchemas['AccountPage'];
export type AllowedEmail = AuthSchemas['AllowedEmail'];
export type AllowedEmailPage = AuthSchemas['AllowedEmailPage'];
export type Role = Account['role'];
export type ProfileName = UsersComponents['schemas']['ProfileName'];

/** null for a 404 (no such account or entry); any other error is thrown. */
async function orNull<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

const target = (account: Pick<Account, 'id' | 'location'>) => ({
  params: { path: { id: account.id }, query: { location: account.location } },
});

export const admin = {
  accounts: {
    list: (skip: number, limit: number): Promise<AccountPage> =>
      unwrap(
        services.auth.GET('/api/v1/auth/accounts', {
          params: { query: { skip, limit } },
        }),
      ),
    /** The account with this email, or null. */
    search: (email: string): Promise<Account | null> =>
      orNull(
        unwrap(
          services.auth.POST('/api/v1/auth/accounts/search', {
            body: { email },
          }),
        ),
      ),
    lock: (account: Pick<Account, 'id' | 'location'>) =>
      unwrap(
        services.auth.POST('/api/v1/auth/accounts/{id}/lock', target(account)),
      ),
    unlock: (account: Pick<Account, 'id' | 'location'>) =>
      unwrap(
        services.auth.POST(
          '/api/v1/auth/accounts/{id}/unlock',
          target(account),
        ),
      ),
    setRole: (account: Pick<Account, 'id' | 'location'>, role: Role) =>
      unwrap(
        services.auth.PATCH('/api/v1/auth/accounts/{id}/role', {
          ...target(account),
          body: { role },
        }),
      ),
  },

  /** The names of a page of accounts, in one call (the ids aren't personal data). */
  async names(ids: string[]): Promise<Map<string, ProfileName>> {
    if (ids.length === 0) return new Map();
    const { items } = await unwrap(
      services.users.GET('/api/v1/users/profiles', {
        params: { query: { ids: ids.join(',') } },
      }),
    );
    return new Map(items.map(item => [item.id, item]));
  },

  allowedEmails: {
    list: (skip: number, limit: number): Promise<AllowedEmailPage> =>
      unwrap(
        services.auth.GET('/api/v1/auth/allowed-emails', {
          params: { query: { skip, limit } },
        }),
      ),
    /** The entry for this email, or null. */
    search: (email: string): Promise<AllowedEmail | null> =>
      orNull(
        unwrap(
          services.auth.POST('/api/v1/auth/allowed-emails/search', {
            body: { email },
          }),
        ),
      ),
    add: (email: string): Promise<AllowedEmail> =>
      unwrap(
        services.auth.POST('/api/v1/auth/allowed-emails', { body: { email } }),
      ),
    remove: async (key: string): Promise<void> => {
      await unwrap(
        services.auth.DELETE('/api/v1/auth/allowed-emails/{key}', {
          params: { path: { key } },
        }),
      );
    },
  },
};

/** "First Last" from a profile name, or null. */
export function nameOf(name: ProfileName | undefined): string | null {
  if (!name) return null;
  const full = [name.first_name, name.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return full === '' ? null : full;
}

/** What the admin screen shows for a refusal, matched on `detail.code`. */
export const ADMIN_ERRORS: Record<string, string> = {
  cannot_lock_self: "You can't lock your own account.",
  last_admin: 'This is the last active admin: make another admin first.',
  account_deleting: 'This account is being deleted.',
  account_changed: 'The account changed meanwhile. Please try again.',
  already_allowed: 'That email is already on the allowlist.',
  invalid_email: "That isn't a valid email address.",
};
