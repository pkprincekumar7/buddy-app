import { CHILD_ID, aDoneKidActivity, someKidQuests } from '../data/builders';
import type { TransformSchemas } from '../data/routes';
import { expect, test, type Api } from '../fixtures';
import { spoken, stubMedia } from '../helpers/page';

// Child view's Transform, Release and Connect, and Read to me (e2e/FLOWS.md, KID-06 to
// KID-09), each write checked against what the app sent.

const C = CHILD_ID;
type KidQuests = TransformSchemas['schemas']['KidQuests'];

/** The child's day, as the app works it out: the browser's local date. */
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.beforeEach(async ({ api, page }) => {
  await api.childView(page);
});

test.describe('Transform: the quests', () => {
  /** Quests that log as transform does: a count per quest, once a day. */
  function questServer(api: Api, start: Partial<KidQuests> = {}) {
    let q = someKidQuests({ logs: {}, last_logged: {}, ...start });
    api.set('GET /children/{id}/transform/quests', () => ({ body: q }));
    api.set('POST /children/{id}/transform/quests/log', ({ body }) => {
      const { interest, quest } = body as { interest: string; quest: number };
      const key = `${interest}:${quest}`;
      q = {
        ...q,
        logs: { ...q.logs, [key]: (q.logs[key] ?? 0) + 1 },
        last_logged: { ...q.last_logged, [key]: localDay() },
        logged_today: [...q.logged_today, key],
      };
      return { body: q };
    });
    api.set('PUT /children/{id}/transform/quests/current', ({ body }) => {
      const interest = (body as { interest: KidQuests['interests'][number] }).interest;
      q = { ...q, current: interest, interests: [...new Set([...q.interests, interest])] };
      return { body: q };
    });
  }

  test('KID-06 "I did it today" logs the quest once, then says so', async ({ api, page }) => {
    questServer(api);
    await page.goto(`/Kids/${C}/transform`);
    await expect(page.getByRole('heading', { name: 'Your quests' })).toBeVisible();
    await page.getByRole('button', { name: 'I did it today' }).first().click();
    await expect(page.getByRole('img', { name: '1 of 1 done' })).toBeVisible();
    expect(api.sent('POST /children/{id}/transform/quests/log')).toEqual([
      { interest: 'drawing', quest: 0 },
    ]);
  });

  test("KID-06 a quest logged today can't be logged again today", async ({ api, page }) => {
    questServer(api, { logs: { 'drawing:1': 1 }, logged_today: ['drawing:1'] });
    await page.goto(`/Kids/${C}/transform`);
    await expect(page.getByRole('img', { name: '1 of 3 done' })).toBeVisible();
    const draws = page.getByRole('button', { name: 'I did it today' });
    // Quest 2 is done for today: only quests 1 and 3 can be logged.
    await expect(draws).toHaveCount(2);
  });

  test('KID-06 adding an interest switches to its quests', async ({ api, page }) => {
    questServer(api);
    await page.goto(`/Kids/${C}/transform`);
    await page.getByRole('button', { name: 'Add another' }).click();
    await page.getByRole('button', { name: /Football/ }).click();
    await expect(page.getByRole('heading', { name: 'Ten kick-ups' })).toBeVisible();
    expect(api.sent('PUT /children/{id}/transform/quests/current')).toEqual([
      { interest: 'football' },
    ]);
  });
});

test.describe('Release: the check-in', () => {
  test('KID-07 pick a mood, add a note, Save: sent once, then thanked', async ({ api, page }) => {
    const kid = api.kids(aDoneKidActivity());
    await page.goto(`/Kids/${C}/release`);
    await page.getByRole('radio', { name: 'Great' }).click();
    await expect(page.getByRole('radio', { name: 'Great' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('status')).toHaveText('You feel great today.');
    await page.getByLabel('What happened today?').fill('  Won at football  ');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved. Thanks for telling us.');
    expect(kid.events).toEqual([{ type: 'mood', mood: 'great', note: 'Won at football' }]);
  });

  test('KID-07 no note is sent as none', async ({ api, page }) => {
    const kid = api.kids(aDoneKidActivity());
    await page.goto(`/Kids/${C}/release`);
    await page.getByRole('radio', { name: 'Okay' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => kid.events).toEqual([{ type: 'mood', mood: 'okay' }]);
  });

  test("KID-07 today's mood shows when Release opens again", async ({ api, page }) => {
    api.kids({ ...aDoneKidActivity(), moods: { [localDay()]: { mood: 'low', note: null } } });
    await page.goto(`/Kids/${C}/release`);
    await expect(page.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true');
  });

  test('KID-07 the streak counts the days in a row', async ({ api, page }) => {
    const day = (back: number) => {
      const d = new Date();
      d.setDate(d.getDate() - back);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    api.kids({
      ...aDoneKidActivity(),
      moods: Object.fromEntries([1, 2, 3].map((b) => [day(b), { mood: 'good', note: null }])),
    });
    await page.goto(`/Kids/${C}/release`);
    await expect(page.getByText('3-day streak')).toBeVisible();
  });
});

test.describe('Connect: show my grown-up', () => {
  test('KID-08 pick a win, the card shows it, and Show my grown-up keeps it', async ({
    api,
    page,
  }) => {
    const kid = api.kids(aDoneKidActivity());
    await page.goto(`/Kids/${C}/connect`);
    await page.getByRole('radio', { name: 'Discover badge unlocked' }).click();
    await expect(page.getByRole('radio', { name: 'Discover badge unlocked' })).toBeChecked();
    await expect(page.locator('main')).toContainText(/Discover badge unlocked[\s\S]*Asha, age 9/);
    await page.getByRole('button', { name: 'Show my grown-up' }).click();
    await expect
      .poll(() => kid.events)
      .toEqual([{ type: 'show_win', key: 'badge:discover', title: 'Discover badge unlocked' }]);
    await expect(page.getByRole('button', { name: 'Your grown-up can see it' })).toBeDisabled();
    await expect(
      page.getByRole('radio', { name: /Discover badge unlocked/ }).getByLabel('Shown'),
    ).toBeVisible();
  });
});

test.describe('Read to me', () => {
  test.beforeEach(async ({ page }) => {
    await stubMedia(page);
  });

  for (const area of ['grow', 'transform', 'release', 'connect'] as const)
    test(`KID-09 ${area}: Read to me reads the circle's line`, async ({ page }) => {
      await page.goto(`/Kids/${C}/${area}`);
      await page.getByRole('button', { name: 'Read to me' }).click();
      await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
    });

  test("KID-09 Discover reads the child's own result", async ({ page }) => {
    await page.goto(`/Kids/${C}/discover`);
    await page.getByRole('button', { name: 'Read to me' }).click();
    await expect.poll(async () => (await spoken(page)).join(' ')).toContain('Thinker');
  });
});
