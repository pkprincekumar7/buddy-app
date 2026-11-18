import { CHILD_ID } from './data/builders';
import { expect, test } from './fixtures';

// One test per scenario (e2e/data/scenarios.ts): its main page renders from the stubs,
// with no request left unanswered (the fixture's teardown) and no console errors. A
// scenario that stops matching what the app reads fails here first.

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !e.includes('Auth check failed'))).toEqual([]);
});

test('newParent: Home offers to start the journey', async ({ api, page }) => {
  api.use('newParent');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Your Journey' })).toBeVisible();
});

test('childInSetup: the chat picks up with the first question', async ({ api, page }) => {
  api.use('childInSetup');
  await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
  await expect(page.getByText(/Mention the top 3 strengths that Asha has/)).toBeVisible();
});

test('childDiscovered: the profile shows the personality', async ({ api, page }) => {
  api.use('childDiscovered');
  await page.goto(`/PersonalityProfile/${CHILD_ID}`);
  await expect(page.getByText(/Asha is a\s*Thinker/)).toBeVisible();
});

test('childMidway: Life Pathway opens with no plan', async ({ api, page }) => {
  api.use('childMidway');
  await page.goto(`/LifePathway/${CHILD_ID}`);
  await expect(page.getByRole('button', { name: /Start Asha's 90 days/ })).toBeVisible();
});

test('childWithPlan: Life Pathway opens', async ({ api, page }) => {
  api.use('childWithPlan');
  await page.goto(`/LifePathway/${CHILD_ID}`);
  await expect(page.getByText('ASHA · AGE 9', { exact: false })).toBeVisible();
});

test('everythingDone: Home shows the child view news', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
  await expect(page.getByText("From Asha's child view")).toBeVisible();
});

test('everythingDone: the child view hub opens', async ({ api, page }) => {
  await api.childView(page);
  await page.goto(`/Kids/${CHILD_ID}/discover`);
  await expect(page.getByText('7 superpowers unlocked')).toBeVisible();
});

test('tenChildren: Home offers each of the ten children', async ({ api, page }) => {
  api.use('tenChildren');
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Continue with Child \d+$/ })).toHaveCount(10);
});

test('admin: the admin page lists the allowed emails', async ({ api, page }) => {
  api.use('admin');
  await page.goto('/');
  await expect(page).toHaveURL(/\/Admin$/);
  await expect(page.getByText('f***@example.test')).toBeVisible();
});

test('signedOut: a protected page sends you to sign in', async ({ api, page }) => {
  api.use('signedOut');
  await page.goto(`/Connect/${CHILD_ID}`);
  await expect(page).toHaveURL(/\/Login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
