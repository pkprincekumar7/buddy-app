import type { Page } from '@playwright/test';
import { CHILD_ID } from '../data/builders';
import type { RouteKey } from '../data/routes';
import { expect, test, type Api } from '../fixtures';

// Each page's error, locked, not-found and loading states (e2e/FLOWS.md, ALL-03): a failed
// main request shows its error, not a blank page, and Try again loads it; a circle not open
// yet sends you back to the journey; a child that's gone sends you Home.

const C = CHILD_ID;

/** Fail `key` until the page shows `error`, then let it through and press `retry`. */
async function failThenRetry(
  api: Api,
  page: Page,
  {
    path,
    key,
    error,
    retry,
    loaded,
  }: {
    path: string;
    key: RouteKey;
    error: string | RegExp;
    retry: string | RegExp;
    loaded: string | RegExp;
  },
): Promise<void> {
  const good = api.get(key);
  api.fail(key);
  await page.goto(path);
  await expect(page.getByText(error).first()).toBeVisible();
  if (good) api.set(key, good);
  await page.getByRole('button', { name: retry }).click();
  await expect(page.getByText(loaded).first()).toBeVisible();
}

test.describe('a failed main request shows its error, and Try again loads the page', () => {
  test('ALL-03 Home: the children', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: '/',
      key: 'GET /children',
      error: 'We could not load your account. Please try again.',
      retry: 'Try again',
      loaded: 'Continue Your Journey',
    });
  });

  test('ALL-03 the journey: the child', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: `/PersonalityJourney/${C}/DimensionCircles`,
      key: 'GET /children/{id}',
      error: 'Something went wrong',
      retry: 'Try again',
      loaded: 'Tap the center HUD to return home',
    });
  });

  test('ALL-03 Grow: the growth areas', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: `/GrowthAreas/${C}`,
      key: 'GET /children/{id}/growth-areas',
      error: 'We could not load this page. Please try again.',
      retry: 'Try again',
      loaded: 'Choose an area to explore',
    });
  });

  test('ALL-03 Transform: the life pathway', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: `/LifePathway/${C}`,
      key: 'GET /children/{id}/transform',
      error: 'We couldn’t load the life pathway.',
      retry: /try again/i,
      loaded: /Start Asha's 90 days|Asha's 90 days/,
    });
  });

  test('ALL-03 Release: the observations', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: `/Observations/${C}`,
      key: 'GET /children/{id}/observations',
      error: 'We could not load this page. Please try again.',
      retry: /try again/i,
      loaded: 'Settles better outdoors than indoors',
    });
  });

  test('ALL-03 Connect: the child', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: `/Connect/${C}`,
      key: 'GET /children/{id}',
      error: 'We could not load this page. Please try again.',
      retry: 'Try again',
      loaded: 'Share Asha’s wins',
    });
  });

  test('ALL-03 signing in: the account check', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: '/',
      key: 'GET /auth/me',
      error: 'Something went wrong',
      retry: 'Retry',
      loaded: 'Continue Your Journey',
    });
  });

  test('ALL-03 the profile: an error and Go Back', async ({ api, page }) => {
    await page.goto('/');
    api.fail('GET /children/{id}/personality');
    await page.goto(`/PersonalityProfile/${C}`);
    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible();
    await page.getByRole('button', { name: 'Go Back' }).click();
    await expect(page).not.toHaveURL(/PersonalityProfile/);
  });

  test('ALL-03 Account settings: the profile, with Try again', async ({ api, page }) => {
    await failThenRetry(api, page, {
      path: '/AccountSettings',
      key: 'GET /users/{user_id}/profile',
      error: 'Something went wrong',
      retry: 'Try again',
      loaded: 'Sign out of all devices',
    });
  });
});

test.describe('child view: each circle says what failed, and loads again', () => {
  test.beforeEach(async ({ api, page }) => {
    await api.childView(page);
  });

  for (const [area, key, error, retry, loaded] of [
    [
      'discover',
      'GET /children/{id}/kids',
      "We couldn't load this.",
      'Try again',
      '7 superpowers unlocked',
    ],
    [
      'discover',
      'GET /children/{id}/personality/powers',
      "We couldn't load your powers.",
      'Look again',
      '7 superpowers unlocked',
    ],
    [
      'grow',
      'GET /children/{id}/growth-areas/worlds',
      "We couldn't load the worlds.",
      'Try again',
      'Pick a world',
    ],
    [
      'transform',
      'GET /children/{id}/transform/quests',
      "We couldn't load your quests.",
      'Try again',
      'Draw your street',
    ],
  ] as const) {
    test(`ALL-03 ${area}: ${key.split('/').pop()}`, async ({ api, page }) => {
      await failThenRetry(api, page, { path: `/Kids/${C}/${area}`, key, error, retry, loaded });
    });
  }

  test('ALL-03 release: a failed activity read says so (not that Release is locked)', async ({
    api,
    page,
  }) => {
    await failThenRetry(api, page, {
      path: `/Kids/${C}/release`,
      key: 'GET /children/{id}/kids',
      error: "We couldn't load this.",
      retry: 'Try again',
      loaded: 'How do you feel today?',
    });
    await expect(page.getByText('Release opens later')).toHaveCount(0);
  });
});

test.describe('a circle not open yet sends you back to the journey', () => {
  for (const [name, path, key] of [
    ['Grow', `/GrowthAreas/${C}`, 'GET /children/{id}/growth-areas'],
    ['Transform', `/LifePathway/${C}`, 'GET /children/{id}/transform'],
    ['Release', `/Observations/${C}`, 'GET /children/{id}/observations'],
    ['Connect', `/Connect/${C}`, 'POST /children/{id}/connect/visit'],
  ] as const) {
    test(`ALL-03 ${name} answers circle_locked → the journey`, async ({ api, page }) => {
      api.locked(key);
      await page.goto(path);
      await expect(page).toHaveURL(`/PersonalityJourney/${C}`);
      await expect(page.getByRole('button', { name: 'Enter the circles' })).toBeVisible();
    });
  }
});

test.describe('a child that no longer exists sends you Home', () => {
  for (const [name, path, key] of [
    ['Grow', `/GrowthAreas/${C}`, 'GET /children/{id}/growth-areas'],
    ['Transform', `/LifePathway/${C}`, 'GET /children/{id}/transform'],
    ['Release', `/Observations/${C}`, 'GET /children/{id}/observations'],
    ['Connect', `/Connect/${C}`, 'POST /children/{id}/connect/visit'],
    ['child view', `/Kids/${C}/grow`, 'GET /children/{id}/kids'],
  ] as const) {
    test(`ALL-03 ${name}`, async ({ api, page }) => {
      if (name === 'child view') await api.childView(page);
      api.set('GET /children', { body: [] });
      api.notFound('GET /children/{id}');
      api.notFound(key);
      await page.goto(path);
      await expect(page).toHaveURL('/Home');
      await expect(page.getByRole('button', { name: 'Start Your Journey' })).toBeVisible();
    });
  }
});

test.describe('loading', () => {
  test('ALL-03 a slow page shows the loader, then the page', async ({ api, page }) => {
    api.slow('GET /children/{id}/growth-areas', 1500);
    await page.goto(`/GrowthAreas/${C}`);
    // The spinner shows after 0.3 s, so a quick load never blinks it.
    await expect(page.locator('.page-loader-spin')).toBeVisible();
    await expect(page.getByText('Choose an area to explore')).toHaveCount(0);
    await expect(page.getByText('Choose an area to explore')).toBeVisible();
    await expect(page.locator('.page-loader-spin')).toHaveCount(0);
  });

  test('ALL-03 Home waits for the children', async ({ api, page }) => {
    api.slow('GET /children', 1500);
    await page.goto('/');
    await expect(page.locator('.page-loader-spin')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
  });
});

test.describe('offline', () => {
  test('ALL-03 offline, opening a page not loaded yet shows the app error; a reload recovers', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
    await page.context().setOffline(true);
    // The journey's code loads on demand: offline it can't, and the app's error screen shows.
    await page.getByRole('button', { name: 'Continue Your Journey' }).click();
    await expect(page.getByText('Something went wrong. Please refresh the page.')).toBeVisible();
    await page.context().setOffline(false);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Enter the circles' })).toBeVisible();
  });

  test("ALL-03 the app error's Try again recovers a page whose code failed to load", async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
    await page.context().setOffline(true);
    await page.getByRole('button', { name: 'Continue Your Journey' }).click();
    await expect(page.getByText('Something went wrong. Please refresh the page.')).toBeVisible();
    await page.context().setOffline(false);
    // React.lazy keeps the failed import: Try again reloads the page for it.
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Enter the circles' })).toBeVisible();
  });
});

test.describe('setup pages that fail to load', () => {
  test('ALL-03 the profile form: a child that fails to load says so, with Try again', async ({
    api,
    page,
  }) => {
    await failThenRetry(api, page, {
      path: `/Onboarding/${C}`,
      key: 'GET /children/{id}',
      error: 'Something went wrong',
      retry: 'Try again',
      loaded: 'Tell us about your child',
    });
  });

  test('ALL-03 the chat: saved answers that fail to load say so (not a fresh start)', async ({
    api,
    page,
  }) => {
    // Starting afresh would mean re-answering, and the save that follows overwrites the answers.
    api.use('childInSetup');
    await failThenRetry(api, page, {
      path: `/ConversationalOnboarding/${C}`,
      key: 'GET /children/{id}/onboarding',
      error: "We couldn't load your answers. Please try again.",
      retry: 'Try again',
      loaded: /Mention the top 3 strengths/,
    });
  });

  test('ALL-03 the chat: no answers saved yet (404) still starts at the first question', async ({
    api,
    page,
  }) => {
    api.use('childInSetup');
    api.fail('GET /children/{id}/onboarding', 404, { code: 'not_found', msg: 'None' });
    await page.goto(`/ConversationalOnboarding/${C}`);
    await expect(page.getByText(/Mention the top 3 strengths/)).toBeVisible();
  });
});
