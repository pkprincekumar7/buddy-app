import { CHILD_ID } from '../data/builders';
import { expect, test } from '../fixtures';
import { overflowing } from '../helpers/page';

// Child view's circles in a phone-width Chrome, against the stubbed API.

test.beforeEach(async ({ api, page }) => {
  await api.childView(page);
});

test.describe('Connect', () => {
  test('KID-08 lists every win: quests, worlds and the badge', async ({ page }) => {
    await page.goto(`/Kids/${CHILD_ID}/connect`);
    const wins = page.getByRole('radiogroup', { name: 'Your wins' }).getByRole('radio');
    await expect(wins).toHaveText([
      'Quest done: Draw your street',
      'Super strong in Life Ambition',
      'Played the Self Care world',
      'Discover badge unlocked',
    ]);
    expect(await overflowing(page)).toEqual([]);
  });

  test('KID-08 says so when the worlds fail to load, and Try again loads them', async ({
    api,
    page,
  }) => {
    const worlds = 'GET /children/{id}/growth-areas/worlds';
    const good = api.get(worlds);
    api.fail(worlds);
    await page.goto(`/Kids/${CHILD_ID}/connect`);
    await expect(page.getByText("We couldn't load all your wins.")).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Your wins' })).toHaveCount(0);

    if (good) api.set(worlds, good);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(
      page.getByRole('radiogroup', { name: 'Your wins' }).getByRole('radio'),
    ).toHaveCount(4);
  });
});

test.describe('Grow', () => {
  test("KID-05 Planet Pattern's planets sit two to a row, as in the prototype", async ({
    page,
  }) => {
    await page.goto(`/Kids/${CHILD_ID}/grow`);
    await page.getByRole('button', { name: /Critical Thinking/ }).click();
    await expect(page.getByRole('heading', { name: 'Planet Pattern' })).toBeVisible();
    await page.getByRole('button', { name: 'Play' }).click();

    const pads = page.locator('.kids-game-pad');
    await expect(pads).toHaveCount(4);
    // Their places in the layout: the pattern lights one planet at a time, scaling it up, so
    // its box on screen depends on when it's measured (more so in a slowed run, SLOWMO).
    const boxes = await pads.evaluateAll((els) =>
      els.map((el) => {
        const h = el as HTMLElement;
        return { x: h.offsetLeft, y: h.offsetTop, w: h.offsetWidth };
      }),
    );
    const [mars, moon, earth, star] = boxes;
    // Two rows of two: Mars and Moon side by side, Earth and Star below them.
    expect(mars?.y).toBe(moon?.y);
    expect(earth?.y).toBe(star?.y);
    expect(earth!.y).toBeGreaterThan(mars!.y);
    expect(moon!.x).toBeGreaterThan(mars!.x + mars!.w / 2);
    expect(earth?.x).toBe(mars?.x);
    expect(await overflowing(page)).toEqual([]);
  });
});
