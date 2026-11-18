import { CHILD_ID } from '../data/builders';
import { expect, test } from '../fixtures';

// The session ending mid-use (e2e/FLOWS.md, AUTH-05 and AUTH-06): an access token that
// expired is refreshed once, silently, and the request retried (api/client.ts,
// api/services.ts); a refresh the auth service refuses ends the session; a locked account
// says why.

const C = CHILD_ID;

test('AUTH-05 an expired token is refreshed and the page loads as if nothing happened', async ({
  api,
  page,
}) => {
  api.expireSession('GET /children/{id}/observations');
  await page.goto(`/Observations/${C}`);
  await expect(page.getByText('Settles better outdoors than indoors')).toBeVisible();
  expect(api.callsTo('POST /auth/refresh')).toHaveLength(1);
  expect(api.callsTo('GET /children/{id}/observations')).toHaveLength(2);
});

test('AUTH-05 an action whose token expired still goes through', async ({ api, page }) => {
  await page.goto(`/PersonalityJourney/${C}/DimensionCircles`);
  await page.getByRole('button', { name: 'Start Again' }).click();
  api.expireSession('DELETE /children/{id}');
  api.set('GET /children', { body: [] });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page).toHaveURL('/Home');
  expect(api.callsTo('DELETE /children/{id}')).toHaveLength(2);
  expect(api.callsTo('POST /auth/refresh')).toHaveLength(1);
});

test('AUTH-05 several requests expiring at once share one refresh', async ({ api, page }) => {
  api.expireSession('GET /children/{id}');
  api.expireSession('GET /children/{id}/observations');
  await page.goto(`/Observations/${C}`);
  await expect(page.getByText('Settles better outdoors than indoors')).toBeVisible();
  expect(api.callsTo('POST /auth/refresh')).toHaveLength(1);
});

test('AUTH-06 a refused refresh ends the session: sign in again', async ({ api, page }) => {
  await page.goto(`/Observations/${C}`);
  await expect(page.getByText('Settles better outdoors than indoors')).toBeVisible();
  api.endSession('GET /children/{id}/observations');
  api.set('GET /auth/me', { status: 401, body: { detail: 'Not authenticated' } });
  api.set('POST /auth/logout', { status: 204, body: null });
  await page.reload();
  await expect(page).toHaveURL(/\/Login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('AUTH-06 mid-use, a refused refresh sends you to sign in', async ({ api, page }) => {
  await page.goto(`/PersonalityJourney/${C}/DimensionCircles`);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeVisible();
  api.endSession('GET /children/{id}/observations');
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page).toHaveURL(/\/Login$/);
});

test('AUTH-06 a locked account is told so', async ({ api, page }) => {
  api.lockAccount('GET /auth/me', 'This account is locked. Contact support.');
  await page.goto(`/Observations/${C}`);
  await expect(page).toHaveURL(/\/Login$/);
  await expect(page.getByText('This account is locked. Contact support.')).toBeVisible();
});
