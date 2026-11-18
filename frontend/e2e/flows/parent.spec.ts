import type { Page } from '@playwright/test';
import {
  CHILD_ID,
  TODAY,
  aChild,
  aDoneKidActivity,
  aKidActivity,
  someKidQuests,
  someObservations,
  someWorlds,
} from '../data/builders';
import { expect, test } from '../fixtures';

// Release, Connect and Account settings in parent view (e2e/FLOWS.md, REL-02, REL-03,
// CON-01 to CON-03, ACC-01 to ACC-05), each write checked against what the app sent.

const C = CHILD_ID;

test.describe('Release', () => {
  test('REL-02 watching patterns: pick them and a span, then Start tracking saves both', async ({
    api,
    page,
  }) => {
    const items = someObservations().items;
    api.set('PATCH /children/{id}/observations', ({ body }) => ({
      body: someObservations(body as { watching: string[]; span: string }),
    }));
    await page.goto(`/Observations/${C}`);
    await expect(page.getByText('Nothing selected yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start tracking' })).toBeDisabled();
    await page.getByRole('checkbox', { name: `Watch ${items[0]!.title}` }).click();
    await page.getByRole('checkbox', { name: `Watch ${items[2]!.title}` }).click();
    await page.getByRole('button', { name: /^2 months/ }).click();
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await expect
      .poll(() => api.sent('PATCH /children/{id}/observations'))
      .toEqual([
        expect.objectContaining({ watching: [items[0]!.id, items[2]!.id], span: '2 months' }),
      ]);
  });

  test('REL-02 a pattern can be un-watched before saving', async ({ page }) => {
    const items = someObservations().items;
    await page.goto(`/Observations/${C}`);
    const box = page.getByRole('checkbox', { name: `Watch ${items[1]!.title}` });
    await box.click();
    await expect(
      page.getByRole('checkbox', { name: `Stop watching ${items[1]!.title}` }),
    ).toBeChecked();
    await page.getByRole('checkbox', { name: `Stop watching ${items[1]!.title}` }).click();
    await expect(page.getByText('Nothing selected yet')).toBeVisible();
  });

  test("REL-03 the child's recent moods: the last 14 days and the streak", async ({ page }) => {
    // The moods are dated TODAY (data/builders.ts): the page's day must be that one, or a
    // run on a later day sees an old mood and no streak.
    await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
    await page.goto(`/Observations/${C}`);
    const moods = page.getByRole('list', { name: "Asha's moods, the last 14 days" });
    await expect(moods.getByRole('listitem')).toHaveCount(14);
    await expect(moods).toContainText(/Good/);
    await expect(page.getByText(/1-day streak/)).toBeVisible();
    // The mood only: the child's note is theirs.
    await expect(page.getByText('Played outside')).toHaveCount(0);
  });
});

test.describe('Connect', () => {
  test('CON-01 wins the child chose to show come first, marked as theirs', async ({
    api,
    page,
  }) => {
    api.kids({
      ...aDoneKidActivity(),
      shown: { 'badge:discover': { title: 'Discover badge unlocked', at: `${TODAY}T09:00:00Z` } },
    });
    await page.goto(`/Connect/${C}`);
    const first = page.getByRole('button', { name: /^Discover badge unlocked/ });
    await expect(first).toBeVisible();
    await expect(page.getByText('From Asha').first()).toBeVisible();
    await expect(
      page.getByText('Asha chose to show you this in child view.').first(),
    ).toBeVisible();
  });

  test('CON-01 tapping a win loads it onto the card', async ({ page }) => {
    await page.goto(`/Connect/${C}`);
    await page.getByRole('button', { name: /^Super strong in Life Ambition/ }).click();
    await expect(page.locator('main')).toContainText(
      /Super strong in Life Ambition[\s\S]*Customise card/,
    );
  });

  for (const channel of ['WhatsApp', 'Instagram', 'Twitter'] as const)
    test(`CON-02 the ${channel} share opens with the card, and closes`, async ({ page }) => {
      await page.goto(`/Connect/${C}`);
      await page.getByRole('button', { name: channel, exact: true }).click();
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await expect(modal).toContainText('Quest done: Draw your street');
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
    });

  for (const channel of ['WhatsApp', 'Instagram', 'Twitter'] as const)
    test(`CON-02 the ${channel} share opens from the keyboard`, async ({ page }) => {
      // It opened and closed at once: Enter's own action pressed the modal's ×.
      await page.goto(`/Connect/${C}`);
      await page.getByRole('button', { name: channel, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText('Quest done: Draw your street');
    });

  test('CON-03 the visit is recorded once', async ({ api, page }) => {
    await page.goto(`/Connect/${C}`);
    await expect(page.getByRole('heading', { name: 'Share Asha’s wins' })).toBeVisible();
    await page.getByRole('button', { name: /^Super strong in Life Ambition/ }).click();
    expect(api.callsTo('POST /children/{id}/connect/visit')).toHaveLength(1);
  });

  test("CON-01 the list is the child's own: quests, worlds and the badge, nothing made up", async ({
    page,
  }) => {
    await page.goto(`/Connect/${C}`);
    for (const win of [
      'Quest done: Draw your street',
      'Super strong in Life Ambition',
      'Played the Self Care world',
      'Discover badge unlocked',
    ])
      await expect(page.getByRole('button', { name: new RegExp(`^${win}`) })).toBeVisible();
    await expect(page.getByText(/district relay|\bhis time\b/)).toHaveCount(0);
  });

  test('CON-01 a win the child showed is listed once, as theirs', async ({ api, page }) => {
    api.kids({
      ...aDoneKidActivity(),
      shown: { 'badge:discover': { title: 'Discover badge unlocked', at: `${TODAY}T09:00:00Z` } },
    });
    await page.goto(`/Connect/${C}`);
    await expect(page.getByRole('button', { name: /^Discover badge unlocked/ })).toHaveCount(1);
  });

  test('CON-01 with no wins yet, the page says how they get here', async ({ api, page }) => {
    api.kids(aKidActivity());
    api.set('GET /children/{id}/transform/quests', { body: someKidQuests() });
    api.set('GET /children/{id}/growth-areas/worlds', { body: someWorlds() });
    await page.goto(`/Connect/${C}`);
    await expect(page.getByRole('heading', { name: 'No wins to share yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'WhatsApp', exact: true })).toHaveCount(0);
  });
});

test.describe('Account settings', () => {
  const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

  test('ACC-01 Save waits for a change, then saves only what changed', async ({ api, page }) => {
    await page.goto('/AccountSettings');
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await field(page, 'Middle name (optional)').fill('Q');
    await field(page, 'Address line 1').fill('1 Test Street');
    await save.click();
    await expect
      .poll(() => api.sent('PATCH /users/{user_id}/profile'))
      .toEqual([{ middle_name: 'Q', address_line_one: '1 Test Street' }]);
    await expect(page.getByText('Profile saved.')).toBeVisible();
  });

  test('ACC-01 a first name is required: the form does not send', async ({ api, page }) => {
    await page.goto('/AccountSettings');
    await field(page, 'First name').fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    // The browser's own check (the field is `required`) stops the submit.
    const missing = await field(page, 'First name').evaluate(
      (el) => (el as HTMLInputElement).validity.valueMissing,
    );
    expect(missing).toBe(true);
    expect(api.callsTo('PATCH /users/{user_id}/profile')).toHaveLength(0);
  });

  test('ACC-01 a refused save says so', async ({ api, page }) => {
    api.fail('PATCH /users/{user_id}/profile', 500, 'The users service is down.');
    await page.goto('/AccountSettings');
    await field(page, 'Last name (optional)').fill('Parent-Smith');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('The users service is down.')).toBeVisible();
  });

  test('ACC-02 the voice preference is saved, and stays after a reload', async ({ api, page }) => {
    await page.goto('/AccountSettings');
    await page.getByRole('button', { name: 'Turn on voice' }).click();
    await expect
      .poll(() => api.sent('PATCH /users/{user_id}/preferences'))
      .toEqual([{ tts_enabled: true }]);
    api.set('GET /users/{user_id}/preferences', { body: { tts_enabled: true } });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Turn off voice' })).toBeVisible();
  });

  test('ACC-03 Sign out of all devices asks first, then ends every session', async ({
    api,
    page,
  }) => {
    await page.goto('/AccountSettings');
    await page.getByRole('button', { name: 'Sign out of all devices' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Sign out of all devices?');
    // Signed out from the call on.
    api.set('POST /auth/logout-all', () => {
      api.set('GET /auth/me', { status: 401, body: { detail: 'Not authenticated' } });
      api.set('POST /auth/refresh', { status: 401, body: { detail: 'Not authenticated' } });
      return { status: 204, body: null };
    });
    await confirm.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page).toHaveURL(/\/Login$/);
    expect(api.callsTo('POST /auth/logout-all')).toHaveLength(1);
  });

  test('ACC-03 Cancel keeps you signed in', async ({ api, page }) => {
    await page.goto('/AccountSettings');
    await page.getByRole('button', { name: 'Sign out of all devices' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(api.callsTo('POST /auth/logout-all')).toHaveLength(0);
  });

  test('ACC-04 deleting the account: type the email, DELETE, signed out', async ({ api, page }) => {
    await page.goto('/AccountSettings');
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Delete your account?');
    const confirm = dialog.getByRole('button', { name: 'Delete account' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Your email').fill('someone-else@example.test');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Your email').fill(' Parent@Example.test ');
    await expect(confirm).toBeEnabled();
    api.set('DELETE /auth/account', () => {
      api.set('GET /auth/me', { status: 401, body: { detail: 'Not authenticated' } });
      api.set('POST /auth/refresh', { status: 401, body: { detail: 'Not authenticated' } });
      return { status: 202, body: { status: 'deleting' } };
    });
    await confirm.click();
    await expect(page).toHaveURL(/\/Login$/);
    expect(api.sent('DELETE /auth/account')).toEqual([{ confirm_email: 'Parent@Example.test' }]);
  });

  test("ACC-04 the server's refusal is shown and the dialog stays", async ({ api, page }) => {
    api.fail('DELETE /auth/account', 400, { code: 'confirmation_mismatch', msg: 'No' });
    await page.goto('/AccountSettings');
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Your email').fill('parent@example.test');
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await expect(dialog.getByRole('alert')).toHaveText("The email doesn't match your account.");
    await expect(page).toHaveURL('/AccountSettings');
  });

  test('ACC-04 Cancel deletes nothing', async ({ api, page }) => {
    await page.goto('/AccountSettings');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(api.callsTo('DELETE /auth/account')).toHaveLength(0);
  });

  test('ACC-05 deleting a child: confirm, DELETE, gone from the menu', async ({ api, page }) => {
    api.use('twoChildren');
    await page.goto('/');
    await page.getByRole('button', { name: 'Your profile' }).click();
    await page
      .getByRole('dialog', { name: 'User profile' })
      .getByRole('button', { name: 'Delete Ben' })
      .click();
    api.set('GET /children', { body: [aChild()] });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(api.callsTo('DELETE /children/{id}').map((c) => c.params['id'])).toEqual(['c-ben']);
    await page.getByRole('button', { name: 'Your profile' }).click();
    await expect(
      page.getByRole('dialog', { name: 'User profile' }).getByRole('button', { name: /^Ben/ }),
    ).toHaveCount(0);
  });
});
