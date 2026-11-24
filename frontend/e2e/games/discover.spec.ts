import { CHILD_ID, aKidActivity } from '../data/builders';
import { expect, test } from '../fixtures';
import {
  POWER_OF,
  RANDOM,
  openPower,
  pauseClock,
  power,
  winDiscover,
  type DiscoverGame,
} from '../helpers/games';
import { freezeRandom } from '../helpers/page';

// Discover in child view (e2e/FLOWS.md, KID-02 and KID-03): the seven powers, each opening
// its game; the first open flips it, all seven earn the badge; each game to a win, its time
// against the saved best. The activity is the KidServer's (e2e/data/kid.ts).

const DISCOVER = `/Kids/${CHILD_ID}/discover`;
const CIRCLES = `/PersonalityJourney/${CHILD_ID}/DimensionCircles`;
const FRESH = {
  circles_done: { discover: false, grow: false, transform: false, release: false, connect: false },
};

test.beforeEach(async ({ api, page }) => {
  await api.childView(page);
  await freezeRandom(page, RANDOM);
  // The real clock's pace (installed, not paused) until a test pauses it (helpers/games.ts).
  await page.clock.install();
});

test.describe('the powers', () => {
  test('KID-02 the seven powers, none opened yet', async ({ api, page }) => {
    api.kids(aKidActivity(FRESH));
    await page.goto(DISCOVER);
    await expect(page.getByText('You are The Thinker')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /: play its game \(not opened yet\)$/ }),
    ).toHaveCount(7);
  });

  test('KID-02 opening a power opens its game and flips it, once', async ({ api, page }) => {
    const kid = api.kids(aKidActivity(FRESH));
    await page.goto(DISCOVER);
    await openPower(page, 'Focus');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Tap the light 5 times. It moves fast!');
    await expect.poll(() => kid.events).toEqual([{ type: 'flip_power', power: 0 }]);
    await expect(page.getByRole('button', { name: 'Focus: play its game' })).toBeVisible();
    expect(kid.state.stars).toBe(1);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await openPower(page, 'Focus');
    await expect(dialog).toBeVisible();
    expect(kid.events).toHaveLength(1);
  });

  test('KID-02 the seventh power earns the badge, and Grow opens', async ({ api, page }) => {
    const kid = api.kids(aKidActivity({ ...FRESH, stars: 6, flipped_powers: [0, 1, 2, 3, 4, 5] }));
    await page.goto(CIRCLES);
    await expect(page.getByRole('button', { name: 'Grow', exact: true })).toBeDisabled();
    await page.goto(DISCOVER);
    await openPower(page, 'Energy');
    await expect.poll(() => kid.state.discover_badge).toBe(true);
    expect(kid.state.stars).toBe(10); // +1 for the power, +3 for the badge
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(CIRCLES);
    await expect(page.getByRole('button', { name: 'Grow', exact: true })).toBeEnabled();
  });
});

test.describe('the games', () => {
  for (const game of Object.keys(POWER_OF) as DiscoverGame[]) {
    test(`KID-03 ${game}: a first win shows the time and saves it as the best`, async ({
      api,
      page,
    }) => {
      const kid = api.kids(aKidActivity({ flipped_powers: [0, 1, 2, 3, 4, 5, 6] }));
      await page.goto(DISCOVER);
      await openPower(page, POWER_OF[game]);
      await winDiscover(page, game);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('First try!');
      await expect(dialog).toContainText(/\d+\.\d\s*sec/);
      await expect.poll(() => kid.events.map((e) => e.type)).toEqual(['game_best']);
      expect(kid.state.best_times[game]).toBeGreaterThan(0);
    });
  }

  test('KID-03 beating the saved best says "New best!" and saves it', async ({ api, page }) => {
    const kid = api.kids(
      aKidActivity({ flipped_powers: [0, 1, 2, 3, 4, 5, 6], best_times: { order: 99 } }),
    );
    await page.goto(DISCOVER);
    await openPower(page, 'Order');
    await winDiscover(page, 'order');
    await expect(page.getByRole('dialog')).toContainText('New best!');
    await expect.poll(() => kid.state.best_times['order']).toBeLessThan(99);
  });

  test('KID-03 a slower time shows the best so far and saves nothing', async ({ api, page }) => {
    const kid = api.kids(
      aKidActivity({ flipped_powers: [0, 1, 2, 3, 4, 5, 6], best_times: { order: 0.5 } }),
    );
    await page.goto(DISCOVER);
    await openPower(page, 'Order');
    await winDiscover(page, 'order');
    await expect(page.getByRole('dialog')).toContainText('Best: 0.5s');
    expect(kid.events).toEqual([]);
  });

  test('KID-03 Play again starts a new round; Done closes', async ({ api, page }) => {
    api.kids(aKidActivity({ flipped_powers: [0, 1, 2, 3, 4, 5, 6] }));
    await page.goto(DISCOVER);
    await openPower(page, 'Order');
    await winDiscover(page, 'order');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Play again' }).click();
    await expect(dialog.getByRole('button', { name: 'Star 1' })).toBeVisible();
    await expect(dialog.getByText('You did it!')).toHaveCount(0);
    await winDiscover(page, 'order');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('KID-03 × and Escape close a game mid-round', async ({ api, page }) => {
    api.kids(aKidActivity({ flipped_powers: [0, 1, 2, 3, 4, 5, 6] }));
    await page.goto(DISCOVER);
    const dialog = page.getByRole('dialog');
    await openPower(page, 'Determination');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await openPower(page, 'Determination');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('KID-03 a wrong star flashes and the count stays', async ({ api, page }) => {
    api.kids(aKidActivity({ flipped_powers: [0, 1, 2, 3, 4, 5, 6] }));
    await page.goto(DISCOVER);
    await openPower(page, 'Order');
    const dialog = page.getByRole('dialog');
    // Paused, so the 400 ms flash is still there to see, however slowly the run goes.
    await pauseClock(page);
    await dialog.getByRole('button', { name: 'Star 3' }).dispatchEvent('pointerdown');
    await expect(dialog.getByRole('button', { name: 'Star 3' })).toHaveClass(
      /kids-game-node-wrong/,
    );
    await expect(dialog.getByRole('button', { name: 'Star 1' })).toHaveClass(/kids-game-node-next/);
  });
});
