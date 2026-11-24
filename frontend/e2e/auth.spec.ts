import type { Page } from '@playwright/test';
import {
  CHILD_ID,
  aChild,
  aMe,
  aPersonality,
  aToken,
  anAccount,
  anAccountPage,
  anAllowedEmail,
} from './data/builders';
import { expect, test, type Api } from './fixtures';
import { stubGoogle } from './helpers/page';

// Signing in and out, registering, the admin page, and Discover's profile (e2e/FLOWS.md,
// AUTH-01 to AUTH-04, AUTH-07, AUTH-08, ADM-01, ADM-02, DIS-02, DIS-03). No real account,
// password or Google sign-in: the auth service and Google's script are stubbed.

const C = CHILD_ID;
const UNAUTH = { status: 401 as const, body: { detail: 'Not authenticated' } };

/**
 * Signed out now, signed in once `signIn()` runs: /auth/me and the refresh answer 401 until
 * then, and the scenario's own answers after. Returns `signIn`.
 */
function signedOut(api: Api): () => void {
  const me = api.get('GET /auth/me');
  const refresh = api.get('POST /auth/refresh');
  api.set('GET /auth/me', UNAUTH);
  api.set('POST /auth/refresh', UNAUTH);
  api.set('POST /auth/logout', { status: 204, body: null });
  return () => {
    if (me) api.set('GET /auth/me', me);
    if (refresh) api.set('POST /auth/refresh', refresh);
  };
}

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await field(page, 'Username (email)').fill(email);
  await field(page, 'Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('signing in', () => {
  test('AUTH-01 the right password opens Home', async ({ api, page }) => {
    const signIn = signedOut(api);
    api.set('POST /auth/login', () => {
      signIn();
      return { body: aToken() };
    });
    await page.goto('/Login');
    await signInWith(page, '  parent@example.test ', 'correct horse battery');
    await expect(page).toHaveURL('/Home');
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
    expect(api.sent('POST /auth/login')).toEqual([
      { email: 'parent@example.test', password: 'correct horse battery' },
    ]);
  });

  test('AUTH-01 a wrong password says so and stays', async ({ api, page }) => {
    signedOut(api);
    api.fail('POST /auth/login', 401, { code: 'invalid_credentials', msg: 'Invalid' });
    await page.goto('/Login');
    await signInWith(page, 'parent@example.test', 'wrong');
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page).toHaveURL('/Login');
  });

  test('AUTH-01 too many attempts says when to try again', async ({ api, page }) => {
    signedOut(api);
    api.fail('POST /auth/login', 429, { code: 'too_many_attempts', msg: 'Slow down' });
    await page.goto('/Login');
    await signInWith(page, 'parent@example.test', 'wrong');
    await expect(page.getByText(/Wait 15 minutes, then try again\./)).toBeVisible();
  });

  test('AUTH-03 Google: the credential is sent, then Home', async ({ api, page }) => {
    await stubGoogle(page);
    const signIn = signedOut(api);
    api.set('POST /auth/google', () => {
      signIn();
      return { body: aToken() };
    });
    await page.goto('/Login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page).toHaveURL('/Home');
    expect(api.sent('POST /auth/google')).toEqual([{ id_token: 'fake-google-id-token' }]);
  });

  test('AUTH-03 Google, a first sign-in: asks for the country, then signs in', async ({
    api,
    page,
  }) => {
    await stubGoogle(page);
    const signIn = signedOut(api);
    api.set('POST /auth/google', ({ body }) => {
      if (!(body as { country_code?: string }).country_code)
        return {
          status: 422,
          body: { detail: { code: 'country_code_required', msg: 'Country?' } },
        };
      signIn();
      return { body: aToken() };
    });
    await page.goto('/Login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.getByRole('combobox').selectOption({ label: 'India' });
    await page
      .getByRole('button', { name: /continue|sign in|done/i })
      .last()
      .click();
    await expect(page).toHaveURL('/Home');
    expect(api.sent('POST /auth/google')[1]).toEqual({
      id_token: 'fake-google-id-token',
      country_code: 'IN',
    });
  });

  test('AUTH-03 a Google refusal is shown', async ({ api, page }) => {
    await stubGoogle(page);
    signedOut(api);
    api.fail('POST /auth/google', 403, 'This Google account is not allowed.');
    await page.goto('/Login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page.getByText('This Google account is not allowed.')).toBeVisible();
  });

  test('AUTH-04 a protected page when signed out sends you to sign in', async ({ api, page }) => {
    signedOut(api);
    await page.goto(`/LifePathway/${C}`);
    await expect(page).toHaveURL(/\/Login$/);
  });

  test('AUTH-04 after signing in you are back on the page you asked for', async ({ api, page }) => {
    const signIn = signedOut(api);
    api.set('POST /auth/login', () => {
      signIn();
      return { body: aToken() };
    });
    await page.goto(`/Observations/${C}`);
    await expect(page).toHaveURL(/\/Login$/);
    await signInWith(page, 'parent@example.test', 'correct horse battery');
    await expect(page).toHaveURL(`/Observations/${C}`, { timeout: 3000 });
  });
});

test.describe('registering', () => {
  async function toRegister(page: Page): Promise<void> {
    await page.goto('/Login');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  }

  async function fill(
    page: Page,
    { password = 'long enough pw', confirm }: { password?: string; confirm?: string } = {},
  ) {
    await field(page, 'First name').fill('Test');
    await field(page, 'Username (email)').fill('new@example.test');
    await page.getByRole('combobox', { name: 'Country' }).selectOption({ label: 'India' });
    await field(page, 'Password').fill(password);
    await field(page, 'Confirm password').fill(confirm ?? password);
  }

  test('AUTH-02 a new account opens Home, ready to add a first child', async ({ api, page }) => {
    const signIn = signedOut(api);
    api.set('GET /children', { body: [] });
    api.set('POST /auth/register', () => {
      signIn();
      return { status: 201, body: aToken() };
    });
    await toRegister(page);
    await fill(page);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('button', { name: 'Start Your Journey' })).toBeVisible();
    expect(api.sent('POST /auth/register')).toEqual([
      expect.objectContaining({
        email: 'new@example.test',
        password: 'long enough pw',
        country_code: 'IN',
        first_name: 'Test',
        middle_name: null,
      }),
    ]);
  });

  for (const [what, opts, message] of [
    [
      'passwords that differ',
      { confirm: 'something else' },
      'Password and confirmation do not match.',
    ],
    ['a short password', { password: 'short' }, 'Password must be at least 8 characters.'],
  ] as const)
    test(`AUTH-02 ${what} are refused before sending`, async ({ api, page }) => {
      signedOut(api);
      await toRegister(page);
      await fill(page, opts);
      await page.getByRole('button', { name: 'Register' }).click();
      await expect(page.getByText(message)).toBeVisible();
      expect(api.callsTo('POST /auth/register')).toHaveLength(0);
    });

  test('AUTH-02 an email not on the allowlist is told so', async ({ api, page }) => {
    signedOut(api);
    api.fail('POST /auth/register', 403, { code: 'registration_closed', msg: 'Closed' });
    await toRegister(page);
    await fill(page);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(
      page.getByText('This email address is not authorized to register. Please contact support.'),
    ).toBeVisible();
  });

  test("AUTH-02 a country the service isn't offered in says so", async ({ api, page }) => {
    signedOut(api);
    api.fail('POST /auth/register', 403, {
      code: 'country_not_supported',
      msg: 'Superpower is not available in your country yet.',
    });
    await toRegister(page);
    await fill(page);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('Superpower is not available in your country yet.')).toBeVisible();
  });

  test('AUTH-02 a form the service refuses (422) shows its first reason, in plain words', async ({
    api,
    page,
  }) => {
    signedOut(api);
    api.set('POST /auth/register', {
      status: 422,
      body: {
        detail: {
          code: 'validation_failed',
          errors: [
            { loc: ['body', 'first_name'], msg: 'Value error, First name has odd characters' },
            { loc: ['body', 'password'], msg: 'Value error, Too common' },
          ],
        },
      },
    });
    await toRegister(page);
    await fill(page);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('First name has odd characters', { exact: true })).toBeVisible();
    await expect(page.getByText('Too common')).toHaveCount(0);
  });

  test('AUTH-02 /Register opens directly when signed out', async ({ api, page }) => {
    signedOut(api);
    await page.goto('/Register');
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({
      timeout: 3000,
    });
  });
});

test.describe('signing out', () => {
  test('AUTH-07 a second account sees nothing of the first', async ({ api, page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
    // Sign out, then in as another parent with another child.
    api.set('POST /auth/logout', () => {
      api.set('GET /auth/me', UNAUTH);
      api.set('POST /auth/refresh', UNAUTH);
      return { status: 204, body: null };
    });
    await page.getByRole('button', { name: 'Your profile' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/Login$/);
    api.set('POST /auth/login', () => {
      api.set('GET /auth/me', { body: aMe({ id: 'u-two', email: 'two@example.test' }) });
      api.set('POST /auth/refresh', { body: aToken() });
      api.set('GET /children', { body: [aChild({ id: 'c-two', name: 'Ravi' })] });
      return { body: aToken() };
    });
    await signInWith(page, 'two@example.test', 'correct horse battery');
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
    await page.getByRole('button', { name: 'Your profile' }).click();
    const menu = page.getByRole('dialog', { name: 'User profile' });
    await expect(menu.getByRole('button', { name: /^Ravi/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: /^Asha/ })).toHaveCount(0);
  });
});

test.describe('the admin page', () => {
  test.beforeEach(({ api }) => {
    api.use('admin');
  });

  test('AUTH-08 an admin sees only the admin page', async ({ page }) => {
    await page.goto('/Home');
    await expect(page).toHaveURL('/Admin');
    await page.goto(`/LifePathway/${C}`);
    await expect(page).toHaveURL('/Admin');
  });

  test('ADM-01 the allowlist: search finds an email, or says it is not there', async ({
    api,
    page,
  }) => {
    await page.goto('/Admin');
    await page.getByRole('textbox', { name: 'Email to look up' }).fill('friend@example.test');
    await page.getByRole('button', { name: 'Look up the email' }).click();
    await expect(page.getByRole('button', { name: 'Remove f***@example.test' })).toHaveCount(2);
    expect(api.sent('POST /auth/allowed-emails/search')).toEqual([
      { email: 'friend@example.test' },
    ]);

    api.fail('POST /auth/allowed-emails/search', 404, { code: 'not_found' });
    await page.getByRole('textbox', { name: 'Email to look up' }).fill('nobody@example.test');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Not found in allowlist.')).toBeVisible();
  });

  test('ADM-01 adding an email', async ({ api, page }) => {
    await page.goto('/Admin');
    await page.getByRole('button', { name: 'Add email' }).click();
    await page.getByRole('textbox', { name: 'Email to allow' }).fill('friend@example.test');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.sent('POST /auth/allowed-emails')).toEqual([{ email: 'friend@example.test' }]);
  });

  test('ADM-01 a duplicate email is refused with its reason', async ({ api, page }) => {
    api.fail('POST /auth/allowed-emails', 409, { code: 'already_allowed', msg: 'Dup' });
    await page.goto('/Admin');
    await page.getByRole('button', { name: 'Add email' }).click();
    await page.getByRole('textbox', { name: 'Email to allow' }).fill('friend@example.test');
    await page.keyboard.press('Enter');
    await expect(page.getByText('That email is already on the allowlist.')).toBeVisible();
  });

  test('ADM-01 removing an email asks first', async ({ api, page }) => {
    await page.goto('/Admin');
    await page.getByRole('button', { name: 'Remove f***@example.test' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(api.callsTo('DELETE /auth/allowed-emails/{key}')).toHaveLength(0);
    await page.getByRole('button', { name: 'Remove f***@example.test' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect
      .poll(() => api.callsTo('DELETE /auth/allowed-emails/{key}').map((c) => c.params['key']))
      .toEqual([anAllowedEmail().key]);
  });

  test("ADM-02 accounts: lock asks first, then locks in the account's own region", async ({
    api,
    page,
  }) => {
    await page.goto('/Admin');
    await page.getByRole('tab', { name: 'Registered Users' }).click();
    await page.getByRole('button', { name: 'Lock user' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Lock user?');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lock', exact: true }).click();
    await expect.poll(() => api.callsTo('POST /auth/accounts/{id}/lock').length).toBe(1);
    const call = api.callsTo('POST /auth/accounts/{id}/lock')[0]!;
    expect(call.params['id']).toBe('u-other');
    expect(call.query.get('location')).toBe('IN');
  });

  test('ADM-02 a locked account can be unlocked', async ({ api, page }) => {
    api.set('GET /auth/accounts', { body: anAccountPage([anAccount({ locked: true })]) });
    await page.goto('/Admin');
    await page.getByRole('tab', { name: 'Registered Users' }).click();
    await page.getByRole('button', { name: 'Unlock user' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Unlock', exact: true })
      .click();
    await expect.poll(() => api.callsTo('POST /auth/accounts/{id}/unlock').length).toBe(1);
  });

  test('ADM-02 changing a role asks first, then saves it', async ({ api, page }) => {
    await page.goto('/Admin');
    await page.getByRole('tab', { name: 'Registered Users' }).click();
    await page
      .getByRole('combobox', { name: 'Role of someone@example.test' })
      .selectOption('admin');
    await expect(page.getByRole('alertdialog')).toContainText('Make admin?');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Make admin' }).click();
    await expect
      .poll(() => api.sent('PATCH /auth/accounts/{id}/role'))
      .toEqual([{ role: 'admin' }]);
  });

  test('ADM-02 search finds a user, or says there is none', async ({ api, page }) => {
    await page.goto('/Admin');
    await page.getByRole('tab', { name: 'Registered Users' }).click();
    await page.getByRole('textbox', { name: 'User email to look up' }).fill('someone@example.test');
    await page.getByRole('button', { name: 'Look up the user' }).click();
    await expect(page.getByRole('combobox', { name: 'Role of someone@example.test' })).toHaveCount(
      2,
    );
    api.fail('POST /auth/accounts/search', 404, { code: 'not_found' });
    await page.getByRole('textbox', { name: 'User email to look up' }).fill('nobody@example.test');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No registered user found.')).toBeVisible();
  });

  test('ADM-02 refusing to lock the last admin says why', async ({ api, page }) => {
    api.fail('POST /auth/accounts/{id}/lock', 409, { code: 'last_admin', msg: 'Last' });
    await page.goto('/Admin');
    await page.getByRole('tab', { name: 'Registered Users' }).click();
    await page.getByRole('button', { name: 'Lock user' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(
      page.getByText('This is the last active admin: make another admin first.'),
    ).toBeVisible();
  });
});

test('AUTH-08 a parent cannot open the admin page', async ({ page }) => {
  await page.goto('/Admin');
  await expect(page.getByRole('heading', { name: 'Admin' })).toHaveCount(0);
  await expect(page.getByText('Manage allowed emails and registered users.')).toHaveCount(0);
});

test.describe("Discover's profile", () => {
  test('DIS-02 the results: traits, how the mind works, role models, strengths, own words', async ({
    api,
    page,
  }) => {
    api.set('GET /children/{id}/personality', { body: aPersonality() });
    await page.goto(`/PersonalityProfile/${C}`);
    await page.getByRole('button', { name: "See Asha's results" }).click();
    const main = page.locator('body');
    for (const text of [
      'Asha the Thinker',
      'Curious',
      "How Asha's Mind Works",
      /Curiosity\s*92%/,
      'Albert Einstein',
      'Strengths',
      'Asks thoughtful questions',
      "In Asha's Own Words",
    ])
      await expect(main).toContainText(text);
  });

  test('DIS-02 Explore Grow goes on to Grow; Replay the reveal shows it again', async ({
    page,
  }) => {
    await page.goto(`/PersonalityProfile/${C}`);
    await page.getByRole('button', { name: "See Asha's results" }).click();
    await page.getByRole('button', { name: 'Replay the reveal' }).click();
    await expect(page.getByRole('button', { name: "See Asha's results" })).toBeVisible();
    await page.getByRole('button', { name: "See Asha's results" }).click();
    await page.getByRole('button', { name: 'Explore Grow' }).click();
    await expect(page).toHaveURL(`/GrowthAreas/${C}`);
  });

  test('DIS-02 sharing on WhatsApp opens it with the result', async ({ page }) => {
    await page.goto(`/PersonalityProfile/${C}`);
    await page.getByRole('button', { name: "See Asha's results" }).click();
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Share on WhatsApp' }).click();
    const opened = await popup;
    // wa.me forwards to api.whatsapp.com, which writes spaces as +.
    expect(decodeURIComponent(opened.url().replaceAll('+', ' '))).toContain(
      "Asha's personality analysis is in — Thinker!",
    );
    await opened.close();
  });
});
