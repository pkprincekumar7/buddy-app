import type { Page } from '@playwright/test';
import { CHILD_ID, TODAY, anArea } from '../data/builders';
import { expect, test } from '../fixtures';

// Grow in parent view (e2e/FLOWS.md, GRW-01, GRW-02, GRW-04): the growth map, an area's
// guided reflection (five questions, one save on Finish), then its recommendations,
// generated and polled; the area then shows as done. The areas are a GrowServer's
// (e2e/data/grow.ts): what's saved stays saved.

const C = CHILD_ID;
const SLOW = { timeout: 20_000 };
// everythingDone's child played the Self Care world at 10:00 today.
const LATEST_RUN = `${TODAY}T10:00:00Z`;
const selfCare = (over: Parameters<typeof anArea>[0] = {}) =>
  anArea({
    area_id: 'self_care',
    area_name: 'Self Care',
    status: 'in_progress',
    completed_at: null,
    ...over,
  });
const RECS = [
  { title: 'A bedtime routine', detail: 'Same three steps every night.', source: 'both' as const },
  { title: 'Water bottle', detail: 'Her own bottle, filled each morning.', source: 'you' as const },
  {
    title: 'Wash-up song',
    detail: 'Twenty seconds of song for hand washing.',
    source: 'kid' as const,
  },
];

const sheet = (page: Page) => page.getByRole('dialog', { name: /Self Care/ });

async function openSelfCare(page: Page): Promise<void> {
  await page.goto(`/GrowthAreas/${C}`);
  await page.getByRole('button', { name: /^Self Care/ }).click();
  await expect(sheet(page)).toBeVisible();
}

/** Answer the five reflection questions and press Finish. */
async function reflect(page: Page): Promise<void> {
  for (let q = 1; q <= 5; q++) {
    await expect(
      sheet(page).getByText(`What does Asha do when question ${q} happens?`),
    ).toBeVisible();
    await sheet(page).getByRole('textbox').fill(`Answer ${q}`);
    await sheet(page)
      .getByRole('button', { name: q === 5 ? 'Finish' : 'Next', exact: true })
      .click();
  }
}

test('GRW-01 the map: six areas, the done ones marked', async ({ api, page }) => {
  api.grow([anArea(), selfCare()]);
  await page.goto(`/GrowthAreas/${C}`);
  // Each named by what it shows: the area, the child's world score, then whether it's done.
  await expect(
    page.getByRole('button', { name: /^Life Ambition Kids 90 \(completed\)/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Self Care Kids 60 —/ })).toBeVisible();
  for (const name of ['Critical Thinking', 'Creativity', 'Physical Wellness', 'Social Skills'])
    await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
});

test('GRW-01 an area opens its sheet, and × closes it', async ({ api, page }) => {
  api.grow([anArea(), selfCare()]);
  await openSelfCare(page);
  await expect(sheet(page)).toContainText('Guided Reflection');
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(sheet(page)).toHaveCount(0);
});

test('GRW-02 / GRW-04 five answers saved once, then recommendations, then the area is done', async ({
  api,
  page,
}) => {
  const grow = api.grow([anArea(), selfCare()], { recommendations: RECS, latestRunAt: LATEST_RUN });
  await openSelfCare(page);
  await reflect(page);

  const saves = api.callsTo('PUT /children/{id}/growth-areas/{area_id}');
  expect(saves).toHaveLength(1);
  expect(saves[0]?.params['area_id']).toBe('self_care');
  expect(saves[0]?.body).toMatchObject({
    area_name: 'Self Care',
    step: 'activity_summary',
    answers: expect.objectContaining({ self_care_gq1: 'Answer 1', self_care_gq5: 'Answer 5' }),
  });

  await expect(sheet(page)).toContainText('Growth insights');
  for (const rec of RECS) await expect(sheet(page).getByText(rec.title)).toBeVisible(SLOW);
  expect(grow.startedOf('recommendations')).toBe(1);

  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(
    page.getByRole('button', { name: /^Self Care Kids 60 \(completed\)/ }),
  ).toBeVisible();
});

test('GRW-02 a refused save keeps the answers and stays on the last question', async ({
  api,
  page,
}) => {
  api.grow([anArea(), selfCare()]);
  api.fail('PUT /children/{id}/growth-areas/{area_id}', 500, 'The grow service is down.');
  await openSelfCare(page);
  await reflect(page);
  await expect(page.getByText('The grow service is down.')).toBeVisible();
  await expect(sheet(page).getByText('What does Asha do when question 5 happens?')).toBeVisible();
  await expect(sheet(page).getByRole('textbox')).toHaveValue('Answer 5');
});

test('GRW-02 failed recommendations offer Try again, which writes them', async ({ api, page }) => {
  const grow = api.grow([anArea(), selfCare()], {
    recommendations: RECS,
    latestRunAt: LATEST_RUN,
    outcome: (kind, poll, attempt) =>
      kind === 'recommendations' && attempt === 1
        ? 'failed'
        : poll >= 2
          ? 'completed'
          : 'processing',
  });
  await openSelfCare(page);
  await reflect(page);
  const retry = sheet(page).getByRole('button', { name: /try again/i });
  await expect(retry).toBeVisible(SLOW);
  await retry.click();
  await expect(sheet(page).getByText(RECS[0]!.title)).toBeVisible(SLOW);
  expect(grow.startedOf('recommendations')).toBe(2);
});

test('GRW-02 a done area reopens on its recommendations; Reflection shows its answers', async ({
  api,
  page,
}) => {
  const grow = api.grow([
    selfCare({
      status: 'completed',
      answers: { self_care_gq1: 'Brushes her teeth' },
      ai_three_month_recommendations: RECS,
      recommendations_current: true,
      recommendations_run_at: LATEST_RUN,
    }),
  ]);
  await openSelfCare(page);
  await expect(sheet(page).getByText(RECS[1]!.title)).toBeVisible();
  expect(grow.startedOf('recommendations')).toBe(0);
  await sheet(page).getByRole('tab', { name: 'Reflection' }).click();
  await expect(sheet(page).getByRole('textbox')).toHaveValue('Brushes her teeth');
});

test('GRW-04 recommendations written before the child played again are written anew', async ({
  api,
  page,
}) => {
  const grow = api.grow(
    [
      selfCare({
        status: 'completed',
        answers: { self_care_gq1: 'Brushes her teeth' },
        ai_three_month_recommendations: RECS,
        recommendations_current: true,
        recommendations_run_at: '2026-11-01T10:00:00Z',
      }),
    ],
    { recommendations: RECS, latestRunAt: LATEST_RUN },
  );
  await openSelfCare(page);
  await expect(sheet(page).getByText(RECS[0]!.title)).toBeVisible(SLOW);
  await expect.poll(() => grow.startedOf('recommendations')).toBe(1);
});
