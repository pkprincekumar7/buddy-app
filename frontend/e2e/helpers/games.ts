// Drivers for child view's games (docs/web-ui-test-plan.md, section 6): one per mechanic, so
// a game test is a few lines. Discover's games run in real time and are driven through their
// keyboard and pointer handlers. Grow's run on Playwright's paused clock (`pauseClock`), with
// Math.random fixed (`RANDOM`), so every beat, wait and countdown can be stepped exactly.

import { expect, type Locator, type Page } from '@playwright/test';
import { someWorlds } from '../data/builders';
import { settled } from './page';

/**
 * The fixed Math.random for the games (freezeRandom): catch spawns a good word at x≈17 on
 * every tick (Even Catch's number is 2), dash's words all fly in from the left, react's light
 * waits 956 ms, and memory's pattern is always the first pad.
 */
export const RANDOM = [0.04];

// ── Discover ──────────────────────────────────────────────────────────────────

export type DiscoverGame = 'focus' | 'curious' | 'order' | 'draw' | 'climb' | 'voice' | 'energy';

/** The power names the default powers (builders' somePowers) give each game. */
export const POWER_OF: Record<DiscoverGame, string> = {
  focus: 'Focus',
  curious: 'Curiosity',
  order: 'Order',
  draw: 'Imagination',
  climb: 'Determination',
  voice: 'Brave voice',
  energy: 'Energy',
};

export const power = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}: play its game`) });

/** Open a power's game. The powers unfold from the centre and then float without end, so a
 *  click can land on another one: press Enter on it instead, as a keyboard user would. */
export async function openPower(page: Page, name: string): Promise<void> {
  await power(page, name).press('Enter');
  await expect(page.getByRole('dialog', { name })).toBeVisible();
}

/** Win a Discover game in the open game dialog. */
export async function winDiscover(page: Page, game: DiscoverGame): Promise<void> {
  const dialog = page.getByRole('dialog');
  const won = dialog.getByText('You did it!');
  const tap = (l: Locator) => l.dispatchEvent('pointerdown');
  switch (game) {
    case 'focus':
      for (let i = 0; i < 5; i++) await tap(dialog.getByRole('button', { name: 'The light' }));
      break;
    case 'curious':
      for (let i = 1; i <= 9 && !(await won.isVisible()); i++) {
        const box = dialog.getByRole('button', { name: `Box ${i}` });
        if (await box.count()) await tap(box);
      }
      break;
    case 'order':
      for (let i = 1; i <= 6; i++) await tap(dialog.getByRole('button', { name: `Star ${i}` }));
      break;
    case 'draw':
      await drawZigzag(page, dialog.getByRole('img', { name: 'Draw here' }), 9);
      break;
    case 'climb':
      // On a paused clock with one slide (60 ms) between taps, however slowly the taps come
      // (SLOWMO): on the real clock, a slow run slides back more than each tap climbs.
      await pauseClock(page);
      for (let i = 0; i < 40 && !(await won.isVisible()); i++) {
        await tap(dialog.getByRole('button', { name: 'Climb' }));
        await page.clock.runFor(60);
      }
      await page.clock.resume();
      break;
    case 'voice':
      await dialog.getByRole('button', { name: 'Press and hold' }).focus();
      await page.keyboard.down(' ');
      await expect(won).toBeVisible({ timeout: 10_000 });
      await page.keyboard.up(' ');
      break;
    case 'energy':
      for (let popped = 0; popped < 10; ) {
        const bubbles = await dialog.getByRole('button', { name: 'A bubble' }).all();
        for (const b of bubbles.slice(0, 10 - popped)) {
          await tap(b).catch(() => undefined); // gone already
          popped += 1;
        }
        if (!bubbles.length) await page.waitForTimeout(50); // the next bubble rises
      }
      break;
  }
  await expect(won).toBeVisible();
}

/** Drag the mouse across `area` in `rows` passes, top to bottom. */
export async function drawZigzag(page: Page, area: Locator, rows: number): Promise<void> {
  // A mouse off the screen draws nothing: the game box must be in view and done moving in.
  await area.scrollIntoViewIfNeeded();
  await settled(page);
  const box = await area.boundingBox();
  if (!box) throw new Error('nothing to draw on');
  const x0 = box.x + box.width * 0.04;
  const x1 = box.x + box.width * 0.96;
  await page.mouse.move(x0, box.y + box.height * 0.06);
  await page.mouse.down();
  for (let r = 0; r < rows; r++) {
    const y = box.y + box.height * (0.06 + (0.88 * r) / Math.max(1, rows - 1));
    await page.mouse.move(r % 2 ? x0 : x1, y, { steps: 24 });
  }
  await page.mouse.up();
}

// ── Grow ──────────────────────────────────────────────────────────────────────

const CATALOG = someWorlds();
export type GrowGameType = (typeof CATALOG.worlds)[number]['games'][number]['type'];

/** A world's index and game by the game's title (e.g. "Planet Pattern"). */
export function growGame(title: string) {
  for (const [w, world] of CATALOG.worlds.entries()) {
    const game = world.games.find((g) => g.title === title);
    if (game) return { world: w, worldName: world.name, step: world.games.indexOf(game), ...game };
  }
  throw new Error(`no Grow game "${title}"`);
}

/** Stop the page's clock: from now on time moves only with `tick`. */
export async function pauseClock(page: Page): Promise<void> {
  // A little ahead of the page's time: after a resume the clock's own time can be past it.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 250);
}

/** Move the paused clock on `ms`, in steps, letting the page render between them (a state
 *  update queued by one timer must land before the next timer reads it). */
export async function tick(page: Page, ms: number, step = 200): Promise<void> {
  for (let left = ms; left > 0; left -= step) await page.clock.runFor(Math.min(step, left));
}

export type Quality = 'good' | 'poor';

/**
 * Play the Grow game on screen (its Play already pressed) to its end, scoring well or
 * badly. Needs `freezeRandom(page, RANDOM)` before the page loaded and `pauseClock`.
 */
export async function playGrow(page: Page, title: string, quality: Quality): Promise<void> {
  const g = growGame(title);
  const cfg = g.cfg as Record<string, unknown>;
  const game = page.locator('.kids-game').first();
  const good = quality === 'good';
  switch (g.type) {
    case 'catch': {
      // RANDOM spawns every word at x≈17: the basket goes left to meet them, or right.
      await game.focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press(good ? 'ArrowLeft' : 'ArrowRight');
      await tick(page, 20_500);
      break;
    }
    case 'sort': {
      const items = cfg['items'] as { text: string; right: boolean }[];
      for (let n = 0; n < 8; n++) {
        const text = (await page.locator('.kids-game-card').innerText()).trim();
        const item = items.find((it) => it.text === text);
        if (!item) throw new Error(`unknown card "${text}"`);
        const side = item.right === good ? `${String(cfg['right'])} →` : `← ${String(cfg['left'])}`;
        await page.getByRole('button', { name: side }).click();
        await tick(page, 600);
      }
      break;
    }
    case 'memory': {
      const pads = cfg['pads'] as string[];
      const pad = (i: number) => page.getByRole('button', { name: pads[i], exact: true });
      const turn = page.getByText('Your turn!');
      if (good) {
        for (let level = 2; level <= 8; level++) {
          await tick(page, 700 + level * 660 + 100, 100);
          await expect(turn).toBeVisible();
          for (let k = 0; k < level; k++) {
            await pad(0).click();
            await tick(page, 200, 100);
          }
          await tick(page, 700, 100);
        }
      } else {
        for (let life = 0; life < 2; life++) {
          await tick(page, 700 + 2 * 660 + 1000, 100);
          await expect(turn).toBeVisible();
          await pad(1).click(); // the pattern is all pad 0
        }
      }
      await tick(page, 1000, 100);
      break;
    }
    case 'timing': {
      const n = Number(cfg['n']);
      const per = Number(cfg['per']);
      const target = page.getByRole('button', { name: /tap when the rings meet/ });
      if (good) {
        await tick(page, 900 + per, 50);
        for (let b = 0; b < n; b++) {
          await target.press('Enter');
          if (b < n - 1) await tick(page, 380 + per, 50);
        }
        await tick(page, 600, 50);
      } else {
        await tick(page, 900 + n * (380 + per * 1.35 + 60) + 600, 100);
      }
      break;
    }
    case 'dash': {
      // 7 a word and 8 a kind: RANDOM sends one word, so 12 grabs score 92.
      let grabbed = 0;
      for (let t = 0; t < 20_500; t += 1000) {
        await tick(page, 1000, 50);
        if (!good || grabbed >= 12) continue;
        for (const b of (await game.getByRole('button').all()).slice(0, 3)) {
          await b.dispatchEvent('pointerdown').catch(() => undefined);
          grabbed += 1;
        }
      }
      break;
    }
    case 'react': {
      const n = Number(cfg['n']);
      const light = page.getByRole('button', { name: String(cfg['label']), exact: true });
      for (let r = 0; r < n; r++) {
        if (!good) await game.dispatchEvent('pointerdown'); // too soon
        await tick(page, 1000, 50); // RANDOM's wait is 956 ms
        await expect(light).toBeVisible();
        if (!good) await tick(page, 2000, 100); // slow
        await light.press('Enter');
      }
      await tick(page, 600, 50);
      break;
    }
    case 'spark': {
      const sky = page.getByRole('img', { name: 'Paint here' });
      if (good) await drawZigzag(page, sky, 16);
      else {
        const box = await sky.boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await tick(page, Number(cfg['time'] ?? 15) * 1000 + 500);
      break;
    }
  }
}
