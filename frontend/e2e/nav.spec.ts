import type { Page, Route } from '@playwright/test';
import { CHILD_ID, CHILD_NAME, aChild, aKidActivity } from './data/builders';
import { expect, test } from './fixtures';

// Navigation (e2e/FLOWS.md, NAV and KID-01/KID-10): Home → the orb → the seven circles →
// each circle's page and back; locks, Start Again, the profile menu, child view, the header
// hidden during the warp and the circle videos, old links, 404 and deep links.

const CIRCLES = `/PersonalityJourney/${CHILD_ID}/DimensionCircles`;
const appBar = (page: Page) => page.getByRole('navigation');
// Hidden is opacity 0 (it fades back in), which Playwright still counts as visible.
const HIDDEN = /\bapp-bar-hidden\b/;
const circle = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Hold every /app-assets/ request (the circle videos) until `release()` (then it fails,
 *  which ends a splash at once, as the fixture's default does). */
async function holdVideos(page: Page): Promise<{ release: () => Promise<void>; urls: string[] }> {
  const held: Route[] = [];
  const urls: string[] = [];
  let open = false;
  await page.route('**/app-assets/**', async (route) => {
    urls.push(route.request().url());
    if (open) return route.abort();
    held.push(route);
  });
  return {
    urls,
    release: async () => {
      open = true;
      await Promise.all(held.splice(0).map((r) => r.abort()));
    },
  };
}

test.describe('the journey', () => {
  test('NAV-01 Home → Continue Your Journey → the orb → the seven circles', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue Your Journey' }).click();
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`);
    await expect(
      page.getByRole('heading', { name: /begin your child's transformation/ }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Enter the circles' }).click();
    // The warp runs 3.35 s before the circles open.
    await expect(page).toHaveURL(CIRCLES, { timeout: 10_000 });
    for (const name of ['Discover', 'Grow', 'Transform', 'Release', 'Connect'])
      await expect(circle(page, name)).toBeVisible();
  });

  for (const [name, path] of [
    ['Grow', `/GrowthAreas/${CHILD_ID}`],
    ['Transform', `/LifePathway/${CHILD_ID}`],
    ['Release', `/Observations/${CHILD_ID}`],
    ['Connect', `/Connect/${CHILD_ID}`],
  ] as const) {
    test(`NAV-02 ${name} opens its page, and Back returns to the circles`, async ({ page }) => {
      await page.goto(CIRCLES);
      await circle(page, name).click();
      await expect(page).toHaveURL(path);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(CIRCLES);
      await expect(circle(page, name)).toBeVisible();
    });
  }

  test("NAV-02 a child's page names the child opposite Back; a page of no child doesn't", async ({
    page,
  }) => {
    for (const path of [
      `/PersonalityProfile/${CHILD_ID}`,
      `/GrowthAreas/${CHILD_ID}`,
      `/LifePathway/${CHILD_ID}`,
      `/Observations/${CHILD_ID}`,
      `/Connect/${CHILD_ID}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
      await expect(page.getByTestId('page-child')).toContainText(`Child: ${CHILD_NAME}`);
    }
    await page.goto('/AccountSettings');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await expect(page.getByTestId('page-child')).toHaveCount(0);
  });

  test('NAV-02 the child chip is 28 px, inside the Back button, so the row keeps its height', async ({
    page,
  }) => {
    // As on mobile (PageBackRow): a taller chip would push the page down by the difference.
    await page.goto(`/LifePathway/${CHILD_ID}`);
    await expect(page.getByTestId('page-child')).toBeVisible();
    const chip = await page.getByTestId('page-child').boundingBox();
    const back = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
    expect(chip?.height).toBe(28);
    expect(chip!.height).toBeLessThanOrEqual(back!.height);
    // Centred on Back.
    expect(Math.abs(chip!.y + chip!.height / 2 - (back!.y + back!.height / 2))).toBeLessThan(1);
  });

  test('NAV-02 Discover plays its video, then opens the profile; Back returns', async ({
    page,
  }) => {
    await page.goto(CIRCLES);
    await circle(page, 'Discover').click();
    await expect(page).toHaveURL(`/PersonalityProfile/${CHILD_ID}`);
    await expect(page.getByText(/Asha is a\s*Thinker/)).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(CIRCLES);
  });

  test('NAV-02 passing the Discover reveal the first time records it as viewed', async ({
    api,
    page,
  }) => {
    api.use('childDiscovered');
    const child = { ...(await import('./data/builders')).aChild() };
    api.set('GET /children/{id}', {
      body: { ...child, progress: { ...child.progress, discover: false, grow: false } },
    });
    await page.goto(CIRCLES);
    await circle(page, 'Discover').click();
    await expect(page).toHaveURL(`/PersonalityProfile/${CHILD_ID}`);
    expect(api.callsTo('POST /children/{id}/personality/viewed')).toHaveLength(1);
  });

  test('NAV-03 a circle not open yet is locked: no navigation', async ({ api, page }) => {
    api.use('childDiscovered');
    await page.goto(CIRCLES);
    await expect(circle(page, 'Grow')).toBeEnabled();
    for (const name of ['Transform', 'Release', 'Connect']) {
      await expect(circle(page, name)).toBeDisabled();
      await circle(page, name).click({ force: true });
    }
    await expect(page).toHaveURL(CIRCLES);
  });

  test('NAV-03 each circle opens once the one before is done', async ({ api, page }) => {
    api.use('childMidway');
    await page.goto(CIRCLES);
    await expect(circle(page, 'Transform')).toBeEnabled();
    await expect(circle(page, 'Release')).toBeDisabled();
    await expect(circle(page, 'Connect')).toBeDisabled();
  });

  test('NAV-04 Start Again asks first; Cancel keeps everything', async ({ api, page }) => {
    await page.goto(CIRCLES);
    await page.getByRole('button', { name: 'Start Again' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText("Delete Asha's journey?");
    await expect(dialog).toContainText('This cannot be undone.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(CIRCLES);
    expect(api.callsTo('DELETE /children/{id}')).toHaveLength(0);
  });

  test('NAV-04 Start Again, confirmed, deletes the child and goes Home', async ({ api, page }) => {
    await page.goto(CIRCLES);
    await page.getByRole('button', { name: 'Start Again' }).click();
    api.set('GET /children', { body: [] });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page).toHaveURL('/Home');
    expect(api.callsTo('DELETE /children/{id}').map((c) => c.params['id'])).toEqual([CHILD_ID]);
  });

  test("NAV-04 the header's Start Over asks the same", async ({ api, page }) => {
    await page.goto(`/Connect/${CHILD_ID}`);
    await page.getByRole('button', { name: 'Start Over' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText("Delete Asha's journey?");
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(api.callsTo('DELETE /children/{id}')).toHaveLength(0);
  });
});

test.describe('the profile menu', () => {
  const menu = (page: Page) => page.getByRole('dialog', { name: 'User profile' });
  const openMenu = async (page: Page) => {
    await page.getByRole('button', { name: 'Your profile' }).click();
    await expect(menu(page)).toBeVisible();
  };

  test('NAV-05 opens and closes: the button, Escape, a click outside', async ({ page }) => {
    await page.goto(`/Connect/${CHILD_ID}`);
    const button = page.getByRole('button', { name: 'Your profile' });
    await openMenu(page);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toContainText('Test Parent');
    await button.click();
    await expect(menu(page)).toHaveCount(0);

    await openMenu(page);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);

    await openMenu(page);
    await page.mouse.click(10, 700);
    await expect(menu(page)).toHaveCount(0);
  });

  test('NAV-05 Home and Account settings', async ({ page }) => {
    await page.goto(`/Connect/${CHILD_ID}`);
    await openMenu(page);
    await menu(page).getByRole('link', { name: 'Account settings' }).click();
    await expect(page).toHaveURL('/AccountSettings');
    await expect(menu(page)).toHaveCount(0);
    await openMenu(page);
    await menu(page).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL('/Home');
    await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
  });

  test('NAV-05 Sign out ends the session and opens sign-in', async ({ api, page }) => {
    await page.goto('/');
    await openMenu(page);
    api.set('GET /auth/me', { status: 401, body: { detail: 'Not authenticated' } });
    api.set('POST /auth/refresh', { status: 401, body: { detail: 'Not authenticated' } });
    await menu(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/Login$/);
    expect(api.callsTo('POST /auth/logout')).toHaveLength(1);
  });

  test('NAV-06 a finished child opens their child view', async ({ api, page }) => {
    api.use('twoChildren');
    await page.goto('/');
    await openMenu(page);
    await menu(page)
      .getByRole('button', { name: /^Asha Child · age 9$/ })
      .click();
    await expect(page).toHaveURL(CIRCLES);
    const view = await page.evaluate(() => localStorage.getItem('superpower.view'));
    expect(JSON.parse(view ?? '{}')).toMatchObject({ childId: CHILD_ID });
    await openMenu(page);
    await expect(menu(page).getByRole('button', { name: 'Back to parent view' })).toBeVisible();
  });

  test('NAV-06 a child in setup opens their onboarding', async ({ api, page }) => {
    api.use('twoChildren');
    await page.goto('/');
    await openMenu(page);
    await menu(page)
      .getByRole('button', { name: /^Ben Child · setting up$/ })
      .click();
    await expect(page).toHaveURL('/Onboarding/c-ben');
  });

  test("NAV-06 the pencil opens the child's profile form", async ({ api, page }) => {
    api.use('twoChildren');
    await page.goto('/');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Asha's profile" }).click();
    await expect(page).toHaveURL(`/Onboarding/${CHILD_ID}`);
    await expect(page.getByText('Tell us about your child')).toBeVisible();
  });

  test("NAV-06 another child's pencil, from the open form, fills it with that child", async ({
    api,
    page,
  }) => {
    api.use('twoChildren');
    await page.goto('/');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Asha's profile" }).click();
    const name = page.getByLabel("Child's Name");
    await expect(name).toHaveValue('Asha');
    // An edit not saved: it's Asha's, and doesn't follow to Ben's form.
    await name.fill('Asha Rose');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Ben's profile" }).click();
    await expect(page).toHaveURL('/Onboarding/c-ben');
    await expect(name).toHaveValue('Ben');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Asha's profile" }).click();
    await expect(name).toHaveValue('Asha');
  });

  test('NAV-06 See chat answers follows the child: only a finished chat, and its own', async ({
    api,
    page,
  }) => {
    api.use('twoChildren');
    const answers = page.getByRole('button', { name: 'See chat answers' });
    await page.goto('/');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Asha's profile" }).click();
    await expect(answers).toBeVisible();
    // Ben is still in setup: no chat to see, though Asha's form was open a moment ago.
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Ben's profile" }).click();
    await expect(page.getByLabel("Child's Name")).toHaveValue('Ben');
    await expect(answers).toHaveCount(0);
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Asha's profile" }).click();
    await answers.click();
    await expect(page).toHaveURL(`/ConversationalOnboarding/${CHILD_ID}`);
  });

  test("NAV-06 See chat answers, after another child's pencil, opens that child's chat", async ({
    api,
    page,
  }) => {
    api.use('tenChildren'); // all finished: Child 1 is CHILD_ID, Child 2 is c-1
    await page.goto('/');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Child 1's profile" }).click();
    await expect(page.getByLabel("Child's Name")).toHaveValue('Child 1');
    await openMenu(page);
    await menu(page).getByRole('button', { name: "Edit Child 2's profile" }).click();
    await expect(page.getByLabel("Child's Name")).toHaveValue('Child 2');
    await page.getByRole('button', { name: 'See chat answers' }).click();
    await expect(page).toHaveURL('/ConversationalOnboarding/c-1');
    // The chat loads Child 2's answers, not Child 1's.
    await expect
      .poll(() => api.callsTo('GET /children/{id}/onboarding').at(-1)?.params['id'])
      .toBe('c-1');
  });

  test('NAV-06 × asks before deleting a child; Cancel keeps them', async ({ api, page }) => {
    api.use('twoChildren');
    await page.goto('/');
    await openMenu(page);
    await menu(page).getByRole('button', { name: 'Delete Ben' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Delete Ben?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.callsTo('DELETE /children/{id}')).toHaveLength(0);
  });
});

test.describe('child view', () => {
  test.beforeEach(async ({ api, page }) => {
    await api.childView(page);
  });

  for (const area of ['discover', 'grow', 'transform', 'release', 'connect'] as const) {
    const name = area[0]!.toUpperCase() + area.slice(1);
    test(`NAV-07 the ${name} circle opens its page; Home returns to the circles`, async ({
      page,
    }) => {
      await page.goto(CIRCLES);
      await circle(page, name).click();
      await expect(page).toHaveURL(`/Kids/${CHILD_ID}/${area}`);
      await page.getByRole('button', { name: 'Back to home' }).click();
      await expect(page).toHaveURL(CIRCLES);
    });
  }

  test("NAV-07 circles follow the child's own progress: only the next is open", async ({
    api,
    page,
  }) => {
    api.set('GET /children/{id}/kids', {
      body: aKidActivity({
        circles_done: {
          discover: true,
          grow: false,
          transform: false,
          release: false,
          connect: false,
        },
      }),
    });
    await page.goto(CIRCLES);
    await expect(circle(page, 'Grow')).toBeEnabled();
    await expect(circle(page, 'Transform')).toBeDisabled();
    await expect(circle(page, 'Connect')).toBeDisabled();
  });

  test('NAV-07 a locked circle opened directly says so', async ({ api, page }) => {
    api.set('GET /children/{id}/kids', { body: aKidActivity() });
    await page.goto(`/Kids/${CHILD_ID}/release`);
    await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Release opens later');
  });

  test("NAV-07 the profile button and menu show the child's photo; without one, the initial", async ({
    api,
    page,
  }) => {
    const photo = 'https://uploads.example.test/avatars/asha.png';
    api.set('GET /children', { body: [aChild({ avatar_url: photo })] });
    await page.goto(CIRCLES);
    const button = page.getByRole('button', { name: /Your profile/ });
    await expect(button.locator('img')).toHaveAttribute('src', photo);
    await button.click();
    const panel = page.getByRole('dialog', { name: 'User profile' });
    await expect(panel.locator('img')).toHaveAttribute('src', photo);
    // No photo: the cyan dot with the initial, as before.
    api.set('GET /children', { body: [aChild()] });
    await page.reload();
    await expect(button.locator('img')).toHaveCount(0);
    await expect(button).toContainText(CHILD_NAME.charAt(0));
  });

  test('NAV-07 Back to parent view leaves child view', async ({ page }) => {
    await page.goto(CIRCLES);
    await page.getByRole('button', { name: 'Your profile' }).click();
    await page.getByRole('button', { name: 'Back to parent view' }).click();
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`);
    expect(await page.evaluate(() => localStorage.getItem('superpower.view'))).toBeNull();
    // Parent view again: the parent pages' Start Over is back.
    await expect(page.getByRole('button', { name: 'Start Over' })).toBeVisible();
  });

  test('KID-01 the hub: the circles, Start Again done, no Start Over or Back', async ({ page }) => {
    await page.goto(CIRCLES);
    for (const name of ['Discover', 'Grow', 'Transform', 'Release', 'Connect'])
      await expect(circle(page, name)).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Start Again Completed' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start Over' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  });

  test("NAV-07 child view doesn't name the child: every page is the child's own", async ({
    page,
  }) => {
    // The two pages child view opens (a parent page goes to the circles), each without it.
    await page.goto(CIRCLES);
    await expect(circle(page, 'Grow')).toBeVisible();
    await expect(page.getByTestId('page-child')).toHaveCount(0);
    await page.goto(`/Kids/${CHILD_ID}/grow`);
    await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible();
    await expect(page.getByTestId('page-child')).toHaveCount(0);
  });

  test('KID-01 the voice toggle saves the preference', async ({ api, page }) => {
    await page.goto(CIRCLES);
    await page.getByRole('button', { name: 'Turn on voice' }).click();
    await expect(page.getByRole('button', { name: 'Turn off voice' })).toBeVisible();
    await expect
      .poll(() => api.sent('PATCH /users/{user_id}/preferences'))
      .toEqual([{ tts_enabled: true }]);
  });

  // The video plays on each entry from the circles. useStageSplash would skip it when a page
  // is reached with `fromBack` state, but nothing sets that yet (see FLOWS.md, KID-10).
  test("KID-10 a circle's entry video plays once on entry, then the page shows", async ({
    page,
  }) => {
    const videos = await holdVideos(page);
    await page.goto(CIRCLES);
    await circle(page, 'Grow').click();
    await expect(page).toHaveURL(`/Kids/${CHILD_ID}/grow`);
    await expect.poll(() => videos.urls.filter((u) => u.includes('stage-07')).length).toBe(1);
    // The page is hidden behind the video until it ends.
    await expect(page.locator('.kids-page')).toHaveCSS('opacity', '0');
    await videos.release();
    await expect(page.locator('.kids-page')).toHaveCSS('opacity', '1');
    expect(videos.urls.filter((u) => u.includes('stage-07'))).toHaveLength(1);
  });

  test('KID-10 circles without an entry video open at once', async ({ page }) => {
    const videos = await holdVideos(page);
    await page.goto(CIRCLES);
    await circle(page, 'Release').click();
    await expect(page.locator('.kids-page')).toHaveCSS('opacity', '1');
    expect(videos.urls.filter((u) => u.includes('/avatars/stage-'))).toEqual([]);
  });
});

test.describe('the header', () => {
  test('NAV-08 hides during the warp and comes back with the circles', async ({ page }) => {
    await page.goto(`/PersonalityJourney/${CHILD_ID}`);
    await expect(appBar(page)).toBeVisible();
    await expect(appBar(page)).not.toHaveClass(HIDDEN);
    await page.getByRole('button', { name: 'Enter the circles' }).click();
    await expect(appBar(page)).toHaveClass(HIDDEN);
    await expect(page).toHaveURL(CIRCLES, { timeout: 10_000 });
    // The warp ends 5.7 s after the tap.
    await expect(appBar(page)).not.toHaveClass(HIDDEN, { timeout: 10_000 });
  });

  test("NAV-08 hides while a circle's video plays and comes back after", async ({ page }) => {
    const videos = await holdVideos(page);
    await page.goto(CIRCLES);
    await circle(page, 'Grow').click();
    await expect(page).toHaveURL(`/GrowthAreas/${CHILD_ID}`);
    await expect.poll(() => videos.urls.length).toBeGreaterThan(0);
    await expect(appBar(page)).toHaveClass(HIDDEN);
    await videos.release();
    await expect(appBar(page)).not.toHaveClass(HIDDEN);
    await expect(page.getByText('Choose an area to explore')).toBeVisible();
  });
});

test.describe('links', () => {
  for (const old of [
    'Activity/life_ambition',
    'Activity/life_ambition/Game',
    'Activity/life_ambition/GreatInsights',
  ])
    test(`NAV-09 an old Grow link (${old}) opens the growth map`, async ({ page }) => {
      await page.goto(`/GrowthAreas/${CHILD_ID}/${old}`);
      await expect(page).toHaveURL(`/GrowthAreas/${CHILD_ID}`);
      await expect(page.getByText('Choose an area to explore')).toBeVisible();
    });

  test('NAV-09 an unknown path shows the 404 page', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page.getByText(/404|not found/i).first()).toBeVisible();
  });

  for (const path of [
    `/PersonalityProfile/${CHILD_ID}`,
    `/GrowthAreas/${CHILD_ID}`,
    `/LifePathway/${CHILD_ID}`,
    `/Observations/${CHILD_ID}`,
    `/Connect/${CHILD_ID}`,
    `/AccountSettings`,
  ])
    test(`NAV-10 ${path} opens directly and survives a reload`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
      await page.reload();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole('navigation')).toBeVisible();
    });

  test('NAV-10 a child that no longer exists sends you Home', async ({ page }) => {
    await page.goto('/PersonalityJourney/c-gone');
    await expect(page).toHaveURL('/Home');
  });
});
