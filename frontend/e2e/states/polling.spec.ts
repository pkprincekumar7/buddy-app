import {
  CHILD_ID,
  aJob,
  aPersonality,
  anArea,
  someAreas,
  someObservations,
} from '../data/builders';
import { expect, test } from '../fixtures';

// Generations that start a job and poll it (e2e/FLOWS.md, DIS-01, GRW-03, REL-01): the page
// waits while it runs, shows the result when it's done, and says so when it fails, with a
// Try again that starts it again. Polls start 2 s apart (api/polling.ts), in real time.

const C = CHILD_ID;
const SLOW = { timeout: 20_000 };
const generating = aPersonality({ status: 'generating', view_model: null, job_id: 'job-1' });

test.describe('Discover: the personality', () => {
  test('DIS-01 the orb waits while it generates, then opens', async ({ api, page }) => {
    let ready = false;
    api.set('GET /children/{id}/personality', () => ({
      body: ready ? aPersonality() : generating,
    }));
    api.set('GET /children/{id}/personality/generation/{job_id}', ({ count }) => {
      if (count >= 2) ready = true;
      return { body: aJob('personality', count >= 2 ? 'completed' : 'processing') };
    });
    await page.goto(`/PersonalityJourney/${C}`);
    await expect(page.getByRole('button', { name: 'Analysing your answers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter the circles' })).toBeVisible(SLOW);
    expect(api.callsTo('GET /children/{id}/personality/generation/{job_id}')).toHaveLength(2);
  });

  test('DIS-01 a failed personality says so, and Try again generates it again', async ({
    api,
    page,
  }) => {
    let started = false;
    api.set('GET /children/{id}/personality', () => ({
      body: started ? aPersonality() : aPersonality({ status: 'failed', view_model: null }),
    }));
    api.set('POST /children/{id}/personality/generation', () => {
      started = true;
      return { status: 202, body: { job_id: 'job-2', status: 'pending' } };
    });
    await page.goto(`/PersonalityJourney/${C}`);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(api.callsTo('POST /children/{id}/personality/generation')).toHaveLength(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Enter the circles' })).toBeVisible(SLOW);
    expect(api.callsTo('POST /children/{id}/personality/generation')).toHaveLength(1);
  });
});

test.describe('Release: the observations', () => {
  test('REL-01 none yet: they generate, then show', async ({ api, page }) => {
    let done = false;
    api.set('GET /children/{id}/observations', () => ({
      body: done ? someObservations() : someObservations({ status: 'not_started', items: [] }),
    }));
    api.set('GET /children/{id}/observations/generation/{job_id}', ({ count }) => {
      if (count >= 2) done = true;
      return { body: aJob('observations', count >= 2 ? 'completed' : 'processing') };
    });
    await page.goto(`/Observations/${C}`);
    await expect(page.getByText('Settles better outdoors than indoors')).toBeVisible(SLOW);
    expect(api.callsTo('POST /children/{id}/observations/generation')).toHaveLength(1);
  });

  test('REL-01 a failed generation says so, and Try again runs it again', async ({ api, page }) => {
    let tries = 0;
    api.set('GET /children/{id}/observations', () => ({
      body:
        tries >= 2 ? someObservations() : someObservations({ status: 'not_started', items: [] }),
    }));
    api.set('POST /children/{id}/observations/generation', () => {
      tries += 1;
      return { status: 202, body: { job_id: `job-${tries}`, status: 'pending' } };
    });
    api.set('GET /children/{id}/observations/generation/{job_id}', ({ params }) => ({
      body: aJob(
        'observations',
        params['job_id'] === 'job-1' ? 'failed' : 'completed',
        params['job_id'],
      ),
    }));
    await page.goto(`/Observations/${C}`);
    const retry = page.getByRole('button', { name: /try again/i });
    await expect(retry.first()).toBeVisible(SLOW);
    await expect(page.getByText('Settles better outdoors than indoors')).toHaveCount(0);
    await retry.first().click();
    await expect(page.getByText('Settles better outdoors than indoors')).toBeVisible(SLOW);
    expect(tries).toBe(2);
  });

  test('REL-01 a busy status check (429) waits longer and checks again, not failing', async ({
    api,
    page,
  }) => {
    let done = false;
    api.set('GET /children/{id}/observations', () => ({
      body: done ? someObservations() : someObservations({ status: 'not_started', items: [] }),
    }));
    api.set('GET /children/{id}/observations/generation/{job_id}', ({ count }) => {
      if (count === 1) return { status: 429, body: { detail: { code: 'rate_limited' } } };
      done = true;
      return { body: aJob('observations', 'completed') };
    });
    await page.goto(`/Observations/${C}`);
    await expect(page.getByText('Settles better outdoors than indoors')).toBeVisible(SLOW);
    expect(api.callsTo('GET /children/{id}/observations/generation/{job_id}')).toHaveLength(2);
    expect(api.callsTo('POST /children/{id}/observations/generation')).toHaveLength(1);
  });

  test('REL-01 a generation still running after 5 minutes stops, and offers Try again', async ({
    api,
    page,
  }) => {
    await page.clock.install();
    api.set('GET /children/{id}/observations', {
      body: someObservations({ status: 'not_started', items: [] }),
    });
    api.set('GET /children/{id}/observations/generation/{job_id}', {
      body: aJob('observations', 'processing'),
    });
    await page.goto(`/Observations/${C}`);
    const retry = page.getByRole('button', { name: /try again/i }).first();
    // Polls every 5 s at most: run the clock on until the deadline has passed.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(6000);
          return retry.isVisible();
        },
        { timeout: 20_000, intervals: [50] },
      )
      .toBe(true);
    // It polled until the deadline, not stopping early (a minute's polls are ~12). Each poll's
    // reply lands in real time, outside the clock, so a slow run (coverage) gets one per 6 s
    // step: 50 over the 5 minutes, and more on a quick one. At least 45, whichever it was.
    const polls = api.callsTo('GET /children/{id}/observations/generation/{job_id}').length;
    expect(polls).toBeGreaterThanOrEqual(45);
    await page.clock.runFor(30_000);
    expect(api.callsTo('GET /children/{id}/observations/generation/{job_id}')).toHaveLength(polls);
  });

  test('REL-01 a set that failed before waits for Try again', async ({ api, page }) => {
    api.set('GET /children/{id}/observations', {
      body: someObservations({ status: 'failed', items: [] }),
    });
    await page.goto(`/Observations/${C}`);
    await expect(
      page.getByText('Something went wrong on our side. Your answers are safe.'),
    ).toBeVisible();
    expect(api.callsTo('POST /children/{id}/observations/generation')).toHaveLength(0);
  });
});

test.describe("Grow: an area's questions", () => {
  const withQuestions = someAreas([
    anArea(),
    anArea({
      area_id: 'self_care',
      area_name: 'Self Care',
      status: 'in_progress',
      completed_at: null,
    }),
  ]);

  test('GRW-03 opening an area with no questions generates them', async ({ api, page }) => {
    let done = false;
    api.set('GET /children/{id}/growth-areas', () => ({
      body: done ? withQuestions : someAreas([anArea()]),
    }));
    api.set('GET /children/{id}/growth-areas/{area_id}/generation/{job_id}', ({ count }) => {
      if (count >= 2) done = true;
      return { body: aJob('parent_questions', count >= 2 ? 'completed' : 'processing') };
    });
    await page.goto(`/GrowthAreas/${C}`);
    await page
      .getByRole('button', { name: /Self Care/ })
      .first()
      .click();
    await expect(page.getByText('What does Asha do when question 1 happens?')).toBeVisible(SLOW);
    const started = api.callsTo('POST /children/{id}/growth-areas/{area_id}/generation');
    expect(started).toHaveLength(1);
    expect(started[0]?.params['area_id']).toBe('self_care');
    expect(started[0]?.body).toMatchObject({ kind: 'parent_questions' });
  });

  test('GRW-03 a failed generation offers Try again, which runs it again', async ({
    api,
    page,
  }) => {
    let tries = 0;
    api.set('GET /children/{id}/growth-areas', () => ({
      body: tries >= 2 ? withQuestions : someAreas([anArea()]),
    }));
    api.set('POST /children/{id}/growth-areas/{area_id}/generation', () => {
      tries += 1;
      return { status: 202, body: { job_id: `job-${tries}`, status: 'pending' } };
    });
    api.set('GET /children/{id}/growth-areas/{area_id}/generation/{job_id}', ({ params }) => ({
      body: aJob(
        'parent_questions',
        params['job_id'] === 'job-1' ? 'failed' : 'completed',
        params['job_id'],
      ),
    }));
    await page.goto(`/GrowthAreas/${C}`);
    await page
      .getByRole('button', { name: /Self Care/ })
      .first()
      .click();
    const retry = page.getByRole('button', { name: /try again/i });
    await expect(retry.first()).toBeVisible(SLOW);
    await retry.first().click();
    await expect(page.getByText('What does Asha do when question 1 happens?')).toBeVisible(SLOW);
    expect(tries).toBe(2);
  });
});
