import type { Page } from '@playwright/test';
import { CHILD_ID, aKidActivity, someWorlds } from '../data/builders';
import { expect, test } from '../fixtures';
import { RANDOM, growGame, pauseClock, playGrow, type Quality } from '../helpers/games';
import { freezeRandom, overflowing } from '../helpers/page';

// Grow in child view (e2e/FLOWS.md, KID-04 and KID-05): pick a world, its three games in
// order, the result after each and the world's report; the run saved once. Every game type
// is played to its end with a good and a poor score, on a paused clock with Math.random
// fixed (helpers/games.ts), so the outcome is the same every run.

const GROW = `/Kids/${CHILD_ID}/grow`;
const DONE_DISCOVER = aKidActivity({
  flipped_powers: [0, 1, 2, 3, 4, 5, 6],
  discover_badge: true,
  circles_done: { discover: true, grow: false, transform: false, release: false, connect: false },
});

test.beforeEach(async ({ api, page }) => {
  await api.childView(page);
  await freezeRandom(page, RANDOM);
  await page.clock.install();
  api.kids(DONE_DISCOVER);
  api.set('GET /children/{id}/growth-areas/worlds', { body: someWorlds() });
});

/** Open the world that has `title`, on its first game's intro. */
async function openGame(page: Page, title: string): Promise<void> {
  const g = growGame(title);
  const first = someWorlds().worlds[g.world]!.games[0]!;
  await page.goto(GROW);
  await page.getByRole('button', { name: new RegExp(g.worldName) }).click();
  await expect(page.getByRole('heading', { name: first.title })).toBeVisible();
  await expect(page.getByText('Game 1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByText(first.how)).toBeVisible();
}

const resultCard = (page: Page) => page.getByRole('status').filter({ hasText: 'Well done!' });

/** The three games of `title`'s world. */
const worldGames = (title: string) => someWorlds().worlds[growGame(title).world]!.games;

/** Press Play and play `title` to its end. */
async function play(page: Page, title: string, quality: Quality): Promise<void> {
  // Paused before Play, so the game starts on the paused clock: after it, a slow run
  // (SLOWMO) lets the game run on before the clock stops, and the taps land off the beat.
  await pauseClock(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await playGrow(page, title, quality);
  await page.clock.resume();
  await expect(resultCard(page)).toBeVisible();
}

test.describe('the worlds', () => {
  test('KID-04 the six worlds; played ones say so', async ({ api, page }) => {
    api.set('GET /children/{id}/growth-areas/worlds', {
      body: someWorlds({ '1': [{ total: 72, scores: [70, 72, 74], at: '2026-11-10T10:00:00Z' }] }),
    });
    await page.goto(GROW);
    await expect(page.getByRole('heading', { name: 'Pick a world' })).toBeVisible();
    for (const w of someWorlds().worlds)
      await expect(page.getByRole('button', { name: new RegExp(w.name) })).toBeVisible();
    await expect(page.getByRole('button', { name: /Self Care/ })).toContainText('Last: 72');
    await expect(page.getByRole('button', { name: /Life Ambition/ })).not.toContainText(
      'Completed',
    );
    expect(await overflowing(page)).toEqual([]);
  });

  test('KID-04 a world: its three games in order, the report, the run saved once', async ({
    api,
    page,
  }) => {
    const [first, second, third] = worldGames('Planet Pattern').map((g) => g.title);
    await openGame(page, 'Planet Pattern');
    await expect(page.getByRole('img', { name: 'Game 1 of 3' })).toBeVisible();
    await play(page, first!, 'good');
    await expect(resultCard(page)).toContainText('Super strong');
    await page.getByRole('button', { name: 'Next game' }).click();

    await expect(page.getByRole('heading', { name: second })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Game 2 of 3' })).toBeVisible();
    await play(page, second!, 'good');
    await page.getByRole('button', { name: 'Next game' }).click();

    await expect(page.getByRole('heading', { name: third })).toBeVisible();
    await play(page, third!, 'good');
    await expect(page.getByRole('button', { name: 'Next game' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish world' }).click();

    await expect(page.getByText('Critical Thinking report')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'World complete!' })).toBeVisible();
    const report = page.getByRole('status').filter({ hasText: 'Super strong' });
    await expect(report).toBeVisible();
    for (const t of [first, second, third])
      await expect(page.getByText(t!, { exact: true })).toBeVisible();
    const runs = api.callsTo('POST /children/{id}/growth-areas/worlds/{world}/runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.params['world']).toBe('2');
    expect((runs[0]?.body as { scores: number[] }).scores).toHaveLength(3);
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
    await page.getByRole('button', { name: 'Pick another world' }).click();
    await expect(page.getByRole('heading', { name: 'Pick a world' })).toBeVisible();
  });

  test('KID-04 Try again replays the game; Back to worlds leaves it', async ({ page }) => {
    await openGame(page, 'Dream Catcher');
    await play(page, 'Dream Catcher', 'poor');
    await expect(resultCard(page)).toContainText('Keep practising');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(resultCard(page)).toHaveCount(0);
    await pauseClock(page);
    await playGrow(page, 'Dream Catcher', 'good');
    await page.clock.resume();
    await expect(resultCard(page)).toContainText('Super strong');
    await page.getByRole('button', { name: 'Back to worlds' }).click();
    await expect(page.getByRole('heading', { name: 'Pick a world' })).toBeVisible();
  });

  test("KID-04 a world that doesn't save says so, and Finish world tries again", async ({
    api,
    page,
  }) => {
    api.failOnce('POST /children/{id}/growth-areas/worlds/{world}/runs');
    const games = worldGames('Light Painting').map((g) => g.title);
    await openGame(page, 'Light Painting');
    for (const [i, t] of games.entries()) {
      await play(page, t, 'poor');
      if (i < 2) await page.getByRole('button', { name: 'Next game' }).click();
    }
    await page.getByRole('button', { name: 'Finish world' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      "That world didn't save. Tap Finish world to try again.",
    );
    await page.getByRole('button', { name: 'Finish world' }).click();
    await expect(page.getByRole('heading', { name: 'World complete!' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Keep practising' })).toBeVisible();
    expect(api.callsTo('POST /children/{id}/growth-areas/worlds/{world}/runs')).toHaveLength(2);
  });
});

test.describe('every game type', () => {
  // One game per type; a good and a poor score each.
  const BY_TYPE = [
    ['catch', 'Healthy Catch'],
    ['catch (even numbers)', 'Even Catch'],
    ['sort', 'Fact or Opinion'],
    ['memory', 'Planet Pattern'],
    ['timing', 'Calm Breaths'],
    ['dash', 'Dream Catcher'],
    ['react', 'Lightning Reflex'],
    ['spark', 'Light Painting'],
  ] as const;

  for (const [type, title] of BY_TYPE) {
    for (const quality of ['good', 'poor'] as const) {
      test(`KID-05 ${type} (${title}): a ${quality} score`, async ({ page }) => {
        const g = growGame(title);
        await openGame(page, title);
        // Get to the game: earlier games in its world are skipped by playing them badly.
        for (const earlier of worldGames(title).slice(0, g.step)) {
          await play(page, earlier.title, 'poor');
          await page.getByRole('button', { name: 'Next game' }).click();
        }
        await expect(page.getByRole('heading', { name: title })).toBeVisible();
        await play(page, title, quality);
        const card = resultCard(page);
        const score = Number(await card.locator('p.text-kids-gold').innerText());
        if (quality === 'good') {
          expect(score).toBeGreaterThanOrEqual(80);
          await expect(card).toContainText('Super strong');
        } else {
          expect(score).toBeLessThan(55);
          await expect(card).toContainText('Keep practising');
        }
      });
    }
  }
});
