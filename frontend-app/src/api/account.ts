// The account: sign-in (the auth service) and the profile and preferences (users), through
// the generated clients (build plan 7.2). The name is the profile's: `/auth/me` carries no
// name, so the app reads `GET /users/me/profile` alongside it. Tokens: serviceFetch keeps
// the pair a login, register or Google response carries; logout clears them.

import { locationHint } from '@/lib/locationHint';
import { dispatchAuthExpired, tokenStore } from './client';
import type { components as AuthComponents } from './generated/auth';
import type { components as UsersComponents } from './generated/users';
import { services, unwrap } from './services';

type AuthSchemas = AuthComponents['schemas'];
type UsersSchemas = UsersComponents['schemas'];

export type Me = AuthSchemas['MeResponse'];
export type Profile = UsersSchemas['Profile'];
export type ProfilePatch = UsersSchemas['ProfilePatch'];
export type Preferences = UsersSchemas['Preferences'];
/** Everything but the email, password and country: the names and the address lines. */
export type RegisterDetails = Omit<
  AuthSchemas['RegisterBody'],
  'email' | 'password' | 'country_code'
>;

/** The signed-in account, with its profile (null if users couldn't be reached). */
export type CurrentUser = Me & { profile: Profile | null };

const ME = { params: { path: { user_id: 'me' } } };

let redirecting = false;

export const account = {
  me: (): Promise<Me> => unwrap(services.auth.GET('/api/v1/auth/me')),

  async current(): Promise<CurrentUser> {
    const me = await account.me();
    // Best effort: the app works without the name (it greets "there").
    const profile = await account.profile.get().catch(() => null);
    return { ...me, profile };
  },

  async register(
    email: string,
    password: string,
    countryCode: string,
    details: RegisterDetails,
  ): Promise<void> {
    // X-Client-Location is a best-effort routing hint only (see @/lib/locationHint); the
    // account's location is always computed from country_code on the server.
    const hint = locationHint(countryCode);
    await unwrap(
      services.auth.POST('/api/v1/auth/register', {
        body: { email, password, country_code: countryCode, ...details },
        headers: hint ? { 'X-Client-Location': hint } : undefined,
      }),
    );
  },

  async login(email: string, password: string): Promise<void> {
    await unwrap(
      services.auth.POST('/api/v1/auth/login', { body: { email, password } }),
    );
  },

  async google(idToken: string, countryCode?: string): Promise<void> {
    const body = countryCode
      ? { id_token: idToken, country_code: countryCode }
      : { id_token: idToken };
    await unwrap(services.auth.POST('/api/v1/auth/google', { body }));
  },

  /** End this session on the server (best effort), then forget the tokens. Auth's logout
   *  ends the session its refresh token names, read from the Bearer header as refresh reads
   *  it (no cookie jar), so this sends that token, not the access token. */
  async logout(): Promise<void> {
    const refresh = await tokenStore.getRefresh();
    await unwrap(
      services.auth.POST(
        '/api/v1/auth/logout',
        refresh ? { headers: { Authorization: `Bearer ${refresh}` } } : {},
      ),
    ).catch(() => {});
    await tokenStore.clear();
  },

  /** End every session of the account, on every device. */
  async logoutAll(): Promise<void> {
    await unwrap(services.auth.POST('/api/v1/auth/logout-all'));
  },

  async redirectToLogin(): Promise<void> {
    if (redirecting) return;
    redirecting = true;
    await account.logout();
    // AuthContext reacts by dropping the session, which swaps the root navigator back to
    // the Login screen.
    dispatchAuthExpired(401, 'Session expired');
    redirecting = false;
  },

  async deleteAccount(confirmEmail: string): Promise<void> {
    await unwrap(
      services.auth.DELETE('/api/v1/auth/account', {
        body: { confirm_email: confirmEmail },
      }),
    );
  },

  profile: {
    get: (): Promise<Profile> =>
      unwrap(services.users.GET('/api/v1/users/{user_id}/profile', ME)),
    update: (patch: ProfilePatch): Promise<Profile> =>
      unwrap(
        services.users.PATCH('/api/v1/users/{user_id}/profile', {
          ...ME,
          body: patch,
        }),
      ),
  },

  preferences: {
    get: (): Promise<Preferences> =>
      unwrap(services.users.GET('/api/v1/users/{user_id}/preferences', ME)),
    patch: (patch: { tts_enabled: boolean }): Promise<Preferences> =>
      unwrap(
        services.users.PATCH('/api/v1/users/{user_id}/preferences', {
          ...ME,
          body: patch,
        }),
      ),
  },
};

/** The profile's first name, for greetings ("Hi Sarah"). */
export function firstName(
  user: { profile?: Profile | null } | null | undefined,
): string | null {
  const name = user?.profile?.first_name?.trim();
  return name === undefined || name === '' ? null : name; // an empty name is no name
}

/** First and last name, for the header and the account menu. */
export function displayName(
  user: { profile?: Profile | null } | null | undefined,
): string | null {
  const profile = user?.profile;
  if (!profile) return null;
  const name = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name === '' ? null : name;
}
