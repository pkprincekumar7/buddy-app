import type { Page } from '@playwright/test';
import { CHILD_ID, someKidQuests } from '../data/builders';
import { aTransformArea, planFor, someMilestones } from '../data/transform';
import { expect, test } from '../fixtures';
import { overflowing, settled, stubUploads } from '../helpers/page';

// Transform in parent view (e2e/FLOWS.md, TRN-01 to TRN-07): Life Pathway's milestones, the
// Start Journey popup (the ask, the plan, a checkout that charges nothing), the plan built
// while "Subscription active" waits, the dashboard and the step-by-step tracker, and the
// child's quests. The document is a TransformServer's (e2e/data/transform.ts). Nothing here
// reaches a payment service: the checkout is the app's own form, and other hosts are blocked.

const C = CHILD_ID;
const SLOW = { timeout: 20_000 };
const ASK = 'She loves drawing';
const dialog = (page: Page) => page.getByRole('dialog');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const AMBITION = aTransformArea();
const SELF_CARE = aTransformArea({ area_id: 'self_care', area_name: 'Self Care' });
const areaSelect = (page: Page) => page.getByRole('combobox', { name: 'Growth area' });
/** The milestone card's title for `label`'s slot (someMilestones). */
const milestone = (page: Page, text: string) => page.getByText(text, { exact: true });

async function openPopup(page: Page): Promise<void> {
  await page.goto(`/LifePathway/${C}`);
  await page.getByRole('button', { name: /Asha's 90 days/ }).click();
  await expect(dialog(page)).toBeVisible();
}

/** Step 1 → 3 with `ask`, then Start free month by `method` (card, Pay or Link). */
async function subscribe(
  page: Page,
  method: 'Start free month' | 'Pay' | 'Link' = 'Start free month',
) {
  const d = dialog(page);
  await d.getByRole('textbox', { name: /interested in/ }).fill(ASK);
  await d.getByRole('button', { name: 'Continue' }).click();
  await expect(d.getByRole('heading', { name: "Asha's first month is on us." })).toBeVisible();
  await d.getByRole('button', { name: 'Continue' }).click();
  await expect(d.getByRole('textbox', { name: 'CVC' })).toBeVisible();
  await d.getByRole('button', { name: method, exact: method !== 'Start free month' }).click();
}

test.beforeEach(({ api }) => {
  api.use('childMidway');
});

test.describe('Life Pathway', () => {
  test('TRN-01 the milestones: each age shows its own', async ({ api, page }) => {
    api.transform();
    await page.goto(`/LifePathway/${C}`);
    await expect(page.getByText('AGE 10', { exact: false }).first()).toBeVisible();
    const before = await page.locator('main').innerText();
    await page.getByRole('button', { name: 'Age 14' }).click();
    await expect.poll(async () => (await page.locator('main').innerText()) !== before).toBe(true);
    await page.getByRole('button', { name: 'Month 2 · Stretch' }).click();
    await expect(page.getByText(/Days 31–60/)).toBeVisible();
  });

  test("TRN-06 the child's quests show on the parent's page", async ({ api, page }) => {
    api.transform();
    api.set('GET /children/{id}/transform/quests', {
      body: someKidQuests({ logs: { 'drawing:0': 1 }, last_logged: { 'drawing:0': '2026-11-14' } }),
    });
    await page.goto(`/LifePathway/${C}`);
    const quests = page.getByRole('region', { name: "Asha's quests" });
    await expect(quests).toContainText('1/3 quests done');
    await expect(quests).toContainText(/Draw your street\s*Done/);
  });

  test('TRN-06 with no quests logged, it says how they get there', async ({ api, page }) => {
    api.transform();
    await page.goto(`/LifePathway/${C}`);
    await expect(page.getByRole('region', { name: "Asha's quests" })).toContainText(
      'When Asha logs a quest in child view, it shows up here.',
    );
  });
});

test.describe("Life Pathway: each area's milestones", () => {
  test('TRN-01 an area with stored milestones shows them, and nothing is generated', async ({
    api,
    page,
  }) => {
    const tf = api.transform({
      areas: [{ ...AMBITION, life_pathway_milestones: someMilestones('Stored') }],
    });
    await page.goto(`/LifePathway/${C}`);
    await expect(milestone(page, 'Stored milestone y1')).toBeVisible();
    await page.getByRole('button', { name: 'Age 11' }).click();
    await expect(milestone(page, 'Stored milestone y2')).toBeVisible();
    expect(tf.startedOf('life_pathway')).toBe(0);
  });

  test('TRN-01 an area without them generates its own, saying so while it waits', async ({
    api,
    page,
  }) => {
    // Done on the third poll (about 10 s): long enough for the progress note.
    const tf = api.transform(
      { areas: [AMBITION] },
      { outcome: (_k, poll) => (poll >= 3 ? 'completed' : 'processing') },
    );
    await page.goto(`/LifePathway/${C}`);
    await expect(page.getByText('Personalising Life Ambition for Asha…')).toBeVisible();
    await expect(page.getByText('Mapping a personalised journey…')).toBeVisible(SLOW);
    await expect(milestone(page, 'Generated Life Ambition milestone y1')).toBeVisible(SLOW);
    expect(tf.pathwayAreas).toEqual(['life_ambition']);
    expect(api.sent('POST /children/{id}/transform/generation')).toEqual([
      { kind: 'life_pathway', area_id: 'life_ambition' },
    ]);
  });

  test('TRN-01 the dropdown: another area generates only its own milestones', async ({
    api,
    page,
  }) => {
    const tf = api.transform({
      areas: [{ ...AMBITION, life_pathway_milestones: someMilestones('Stored') }, SELF_CARE],
    });
    await page.goto(`/LifePathway/${C}`);
    await expect(milestone(page, 'Stored milestone y1')).toBeVisible();
    await areaSelect(page).selectOption({ label: 'Self Care' });
    await expect(milestone(page, 'Generated Self Care milestone y1')).toBeVisible(SLOW);
    await areaSelect(page).selectOption({ label: 'Life Ambition' });
    await expect(milestone(page, 'Stored milestone y1')).toBeVisible();
    expect(tf.pathwayAreas).toEqual(['self_care']);
  });

  test('TRN-01 one area at a time: an area picked meanwhile waits its turn', async ({
    api,
    page,
  }) => {
    const tf = api.transform({ areas: [AMBITION, SELF_CARE] });
    await page.goto(`/LifePathway/${C}`);
    await expect(page.getByText('Personalising Life Ambition for Asha…')).toBeVisible();
    await areaSelect(page).selectOption({ label: 'Self Care' });
    await expect(page.getByText('Personalising Self Care for Asha…')).toBeVisible();
    expect(tf.pathwayAreas).toEqual(['life_ambition']);
    await expect(milestone(page, 'Generated Self Care milestone y1')).toBeVisible({
      timeout: 30_000,
    });
    expect(tf.pathwayAreas).toEqual(['life_ambition', 'self_care']);
  });

  test("TRN-01 a failed generation shows the area's own built-in milestones, and isn't retried", async ({
    api,
    page,
  }) => {
    const tf = api.transform(
      { areas: [AMBITION, { ...SELF_CARE, life_pathway_milestones: someMilestones('Stored') }] },
      { outcome: () => 'failed' },
    );
    await page.goto(`/LifePathway/${C}`);
    await expect(milestone(page, 'She finishes something for the first time')).toBeVisible(SLOW);
    await areaSelect(page).selectOption({ label: 'Self Care' });
    await expect(milestone(page, 'Stored milestone y1')).toBeVisible();
    await areaSelect(page).selectOption({ label: 'Life Ambition' });
    await expect(milestone(page, 'She finishes something for the first time')).toBeVisible();
    expect(tf.startedOf('life_pathway')).toBe(1);
  });
});

test.describe('the Start Journey popup', () => {
  test('TRN-02 step 1: Continue waits for an answer; a chip fills it in', async ({ api, page }) => {
    api.transform();
    await openPopup(page);
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Step 1 of 3 · About Asha' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await d.getByRole('button', { name: 'Drawing', exact: true }).click();
    await d.getByRole('button', { name: 'Football', exact: true }).click();
    await expect(d.getByRole('textbox', { name: /interested in/ })).toHaveValue(
      'Drawing, Football',
    );
    await d.getByRole('button', { name: 'Football', exact: true }).click();
    await expect(d.getByRole('textbox', { name: /interested in/ })).toHaveValue('Drawing');
    await expect(d.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('TRN-02 / TRN-03 three steps, Start free month, the plan built while it waits, the dashboard', async ({
    api,
    page,
  }) => {
    const tf = api.transform();
    await openPopup(page);
    await subscribe(page);
    await expect(dialog(page).getByRole('heading', { name: 'Subscription active' })).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: "Asha's ninety days" })).toBeVisible(
      SLOW,
    );
    await expect(dialog(page)).toContainText('Built around drawing');
    expect(tf.startedOf('plan')).toBe(1);
    expect(tf.doc.ask).toBe(ASK);
    // The ask was saved before the plan was asked for: it's built from the saved words.
    expect(api.calls.findIndex((c) => c.key === 'PATCH /children/{id}/transform')).toBeLessThan(
      api.calls.findIndex((c) => c.key === 'POST /children/{id}/transform/generation'),
    );
  });

  for (const method of ['Pay', 'Link'] as const)
    test(`TRN-02 the express ${method} button subscribes the same way`, async ({ api, page }) => {
      const tf = api.transform();
      await openPopup(page);
      await subscribe(page, method);
      await expect(dialog(page).getByRole('heading', { name: "Asha's ninety days" })).toBeVisible(
        SLOW,
      );
      expect(tf.startedOf('plan')).toBe(1);
    });

  test('TRN-02 Back from the checkout returns to the plan; Close leaves the popup', async ({
    api,
    page,
  }) => {
    api.transform();
    await openPopup(page);
    const d = dialog(page);
    await d.getByRole('textbox', { name: /interested in/ }).fill(ASK);
    await d.getByRole('button', { name: 'Continue' }).click();
    await d.getByRole('button', { name: 'Continue' }).click();
    await d.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(d.getByRole('heading', { name: 'Step 2 of 3 · Your plan' })).toBeVisible();
    await d.getByRole('button', { name: 'Close' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('TRN-02 the checkout fits a phone: no sideways scrolling', async ({ api, page }) => {
    api.transform({ ask: ASK });
    await openPopup(page);
    await dialog(page).getByRole('button', { name: 'Continue' }).click();
    await dialog(page).getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#journey-pay-cvc')).toBeVisible();
    await settled(page);
    expect(await overflowing(page, '[role="dialog"]')).toEqual([]);
  });

  test('TRN-03 a plan that fails to build still opens the dashboard, on the built-in plan', async ({
    api,
    page,
  }) => {
    const tf = api.transform({}, { outcome: (kind) => (kind === 'plan' ? 'failed' : 'completed') });
    await openPopup(page);
    await subscribe(page);
    await expect(dialog(page).getByRole('heading', { name: "Asha's ninety days" })).toBeVisible(
      SLOW,
    );
    expect(tf.startedOf('plan')).toBe(1);
    expect(tf.doc.plan).toBeNull();
  });

  test('TRN-05 with a plan, the popup opens on the dashboard', async ({ api, page }) => {
    api.transform({ ask: ASK, plan: planFor(ASK) as never });
    await openPopup(page);
    await expect(dialog(page).getByRole('heading', { name: 'Subscription active' })).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: "Asha's ninety days" })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Done for now' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('the dashboard', () => {
  test.beforeEach(({ api }) => {
    api.transform({ ask: ASK, plan: planFor(ASK) as never });
  });

  test('TRN-04 the months, and an activity opens its log', async ({ page }) => {
    await openPopup(page);
    const d = dialog(page);
    await d.getByRole('button', { name: /^Month 2 Stretch/ }).click();
    await expect(d).toContainText(/By day 60/);
    await d.getByRole('button', { name: /^Month 1 Anchor/ }).click();
    await d.getByRole('button', { name: /^Ten minutes, same sketchbook/ }).click();
    await expect(d.getByRole('button', { name: 'Log today' })).toBeVisible();
  });

  test('TRN-04 / TRN-07 logging a day saves its count, once, on the current version', async ({
    api,
    page,
  }) => {
    await openPopup(page);
    const d = dialog(page);
    await d.getByRole('button', { name: /^Ten minutes, same sketchbook/ }).click();
    await d.getByRole('button', { name: 'Log today' }).click();
    await expect(d.getByText('1 / 20')).toBeVisible();
    await expect.poll(() => api.sent('PATCH /children/{id}/transform').length).toBe(1);
    expect(api.sent('PATCH /children/{id}/transform')[0]).toMatchObject({
      version: 1,
      act_counts: expect.any(Object),
    });
  });

  test('TRN-04 the Day 90 target: a chip and a date, saved together', async ({ api, page }) => {
    await openPopup(page);
    const d = dialog(page);
    await expect(d.getByRole('button', { name: 'Set target' })).toBeDisabled();
    await d.getByRole('button', { name: 'School art exhibition' }).click();
    await d.getByRole('textbox', { name: 'Event date' }).fill('2027-02-14');
    await d.getByRole('button', { name: 'Set target' }).click();
    await expect(d).toContainText('Sunday, 14 February 2027');
    await expect
      .poll(() => api.sent('PATCH /children/{id}/transform'))
      .toContainEqual(
        expect.objectContaining({
          event_name: 'School art exhibition',
          event_date: '2027-02-14',
          event_set: true,
        }),
      );
  });

  test('TRN-04 a set target builds the tracker; Track it step by step opens it', async ({
    api,
    page,
  }) => {
    const tf = api.transform({
      ask: ASK,
      plan: planFor(ASK) as never,
      event_name: 'School art exhibition',
      event_date: '2027-02-14',
      event_set: true,
    });
    await openPopup(page);
    const d = dialog(page);
    await expect.poll(() => tf.startedOf('event_tracker'), SLOW).toBe(1);
    await d.getByRole('button', { name: /Track it step by step/ }).click();
    await expect(d.getByRole('button', { name: /Back/ }).first()).toBeVisible();
    await expect(d).toContainText('School art exhibition');
  });

  test('TRN-07 typing the ask saves once, after a pause, with the final words', async ({
    api,
    page,
  }) => {
    api.transform();
    await openPopup(page);
    await dialog(page)
      .getByRole('textbox', { name: /interested in/ })
      .pressSequentially('Loves maps', { delay: 40 });
    await expect
      .poll(() => api.sent('PATCH /children/{id}/transform'))
      .toEqual([{ clear_track_steps: false, ask: 'Loves maps', version: 1 }]);
  });
});

test.describe('the step-by-step tracker', () => {
  const EVENT = {
    ask: ASK,
    plan: planFor(ASK) as never,
    event_name: 'School art exhibition',
    event_date: '2027-02-14',
    event_set: true,
    // The tracker as an event_tracker job stored it: its own first step, the rest built-in.
    track_steps: { steps: [{ title: 'Find the exhibition entry form', short: 'Form' }] },
  };

  async function openTracker(page: Page): Promise<void> {
    await openPopup(page);
    await dialog(page)
      .getByRole('button', { name: /Track it step by step/ })
      .click();
    await expect(
      dialog(page).getByRole('button', { name: 'Back to the ninety days' }),
    ).toBeVisible();
  }

  test('TRN-04 the stored steps, a field and Mark done, each saved', async ({ api, page }) => {
    const tf = api.transform(EVENT);
    await openTracker(page);
    const d = dialog(page);
    await expect(d).toContainText('Find the exhibition entry form');
    expect(tf.startedOf('event_tracker')).toBe(0);
    await d.getByLabel('Which competition').fill('Young Artists 2027');
    await expect(d.getByRole('heading', { name: 'Young Artists 2027' })).toBeVisible();
    await d.getByRole('button', { name: 'Mark done' }).click();
    await expect.poll(() => tf.doc.track_done).toEqual({ '0': true });
    expect(tf.doc.track_inputs).toMatchObject({ comp: 'Young Artists 2027' });
    // Done moves the tracker on: the next step is the one shown.
    await expect(d).toContainText('Next: read the brief.');
    // On step 2 now: Next to 3, then Back twice to the first, where Back stops.
    await d.getByRole('button', { name: 'Next', exact: true }).click();
    await d.getByRole('button', { name: 'Back', exact: true }).click();
    await d.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(d).toContainText('Find the exhibition entry form');
    await expect(d.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  });

  test('TRN-04 a photo: presigned, uploaded, saved by its key; Remove takes it off', async ({
    api,
    page,
  }) => {
    const uploads = await stubUploads(page);
    const tf = api.transform(EVENT);
    await openTracker(page);
    const d = dialog(page);
    await d
      .getByRole('button', { name: /Three rough ideas|Ideas/ })
      .first()
      .click();
    await d.getByLabel('Import the rough sketches').setInputFiles({
      name: 'sketch.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(
      d.getByRole('img', { name: 'Imported for Import the rough sketches' }),
    ).toHaveAttribute('src', 'https://uploads.example.test/photos/c-test/1.jpg');
    expect(api.sent('POST /children/{id}/transform/photos/presign')).toEqual([
      { field_key: 'ideas', content_type: 'image/png' },
    ]);
    // The upload, then the saved photo shown from where it was uploaded.
    expect(uploads[0]).toBe('https://uploads.example.test/photos');
    await expect
      .poll(() => tf.doc.photos['ideas']?.map((p) => p.key))
      .toEqual(['photos/c-test/1.jpg']);

    await d.getByRole('button', { name: 'Remove photo' }).click();
    await expect(d.getByRole('img', { name: /^Imported for/ })).toHaveCount(0);
    await expect.poll(() => tf.doc.photos['ideas']).toEqual([]);
  });

  test("TRN-04 a photo that doesn't upload says so, and isn't kept", async ({ api, page }) => {
    await stubUploads(page, 403);
    const tf = api.transform(EVENT);
    await openTracker(page);
    const d = dialog(page);
    await d
      .getByRole('button', { name: /Three rough ideas|Ideas/ })
      .first()
      .click();
    await d.getByLabel('Import the rough sketches').setInputFiles({
      name: 'sketch.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByText('The photo upload failed (403).')).toBeVisible();
    await expect(d.getByRole('img', { name: /^Imported for/ })).toHaveCount(0);
    expect(tf.patches.filter((p) => 'photos' in p)).toEqual([]);
  });

  test("TRN-04 a file that isn't a photo is refused before any upload", async ({ api, page }) => {
    api.transform(EVENT);
    await openTracker(page);
    const d = dialog(page);
    await d
      .getByRole('button', { name: /Three rough ideas|Ideas/ })
      .first()
      .click();
    await d.getByLabel('Import the rough sketches').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a photo'),
    });
    await expect(
      page.getByText('That file doesn’t look like a photo. Try a JPEG, PNG, WEBP or GIF.'),
    ).toBeVisible();
    expect(api.callsTo('POST /children/{id}/transform/photos/presign')).toHaveLength(0);
  });
});

test.describe('two devices', () => {
  test.beforeEach(({ api }) => {
    api.transform({ ask: ASK, plan: planFor(ASK) as never });
  });

  const logToday = async (page: Page) => {
    const d = dialog(page);
    await d.getByRole('button', { name: 'Log today' }).click();
  };

  test('TRN-07 a save after another device saved: both changes kept, and it says so', async ({
    api,
    page,
  }) => {
    const tf = api.transform({ ask: ASK, plan: planFor(ASK) as never });
    await openPopup(page);
    await dialog(page)
      .getByRole('button', { name: /^Ten minutes, same sketchbook/ })
      .click();
    tf.otherDevice({ act_counts: { 'from-the-phone': 4 } });
    await logToday(page);
    await expect(page.getByText('Updated on another device')).toBeVisible();
    await expect.poll(() => tf.patches.length).toBe(2);
    expect(tf.patches.map((p) => p['version'])).toEqual([1, 2]);
    expect(tf.doc.version).toBe(3);
    expect(Object.values(tf.doc.act_counts).sort()).toEqual([1, 4]);
    await expect(dialog(page).getByText('1 / 20')).toBeVisible();
  });

  test('TRN-07 a first save after a generation made the plan: the ask is saved on its version', async ({
    api,
    page,
  }) => {
    // No plan when the page opens (version 0). The area's milestones generation makes one,
    // at version 1, so the page's first save is on an old version: 409, then saved again.
    // The order is the page's own: the popup's plan is read on mount, and the milestones
    // wait for the splash (LifePathway's `enabled`).
    const tf = api.transform({ version: 0, areas: [AMBITION] }, { outcome: () => 'processing' });
    await page.goto(`/LifePathway/${C}`);
    await expect.poll(() => tf.startedOf('life_pathway')).toBe(1);
    await page.getByRole('button', { name: /Asha's 90 days/ }).click();
    await dialog(page)
      .getByRole('textbox', { name: /interested in/ })
      .fill('Building things');
    await expect.poll(() => tf.patches.length).toBe(2);
    expect(tf.patches.map((p) => p['version'])).toEqual([0, 1]);
    expect(tf.doc.ask).toBe('Building things');
    expect(tf.doc.version).toBe(2);
    // Nothing of the parent's changed meanwhile, so there's nothing to say.
    await expect(page.getByText('Updated on another device')).toHaveCount(0);
  });

  test("TRN-07 where both changed the same thing, the other device's change stays", async ({
    api,
    page,
  }) => {
    const tf = api.transform({ ask: ASK, plan: planFor(ASK) as never });
    await openPopup(page);
    await dialog(page)
      .getByRole('button', { name: /^Ten minutes, same sketchbook/ })
      .click();
    await logToday(page);
    await expect.poll(() => tf.doc.version).toBe(2);
    const [key] = Object.keys(tf.doc.act_counts);
    tf.otherDevice({ act_counts: { [key!]: 5 } });
    await logToday(page);
    await expect(dialog(page).getByText('5 / 20')).toBeVisible();
    expect(tf.doc.act_counts[key!]).toBe(5);
    // Nothing of this device's was left to send again.
    expect(tf.patches.map((p) => p['version'])).toEqual([1, 2]);
  });
});

test.describe('a save that fails', () => {
  const PATCH = 'PATCH /children/{id}/transform' as const;

  const openActivity = async (page: Page) => {
    await openPopup(page);
    await dialog(page)
      .getByRole('button', { name: /^Ten minutes, same sketchbook/ })
      .click();
  };

  test('TRN-07 a save the service can take later: one toast, the change kept and sent again', async ({
    api,
    page,
  }) => {
    const tf = api.transform({ ask: ASK, plan: planFor(ASK) as never });
    const server = api.get(PATCH);
    if (typeof server !== 'function') throw new Error('the stand-in answers PATCH');
    // Down for the first two tries (no message of its own), then saved.
    api.set(PATCH, (call) =>
      call.count <= 2 ? { status: 503, body: { detail: { code: 'unavailable' } } } : server(call),
    );
    await openActivity(page);
    await dialog(page).getByRole('button', { name: 'Log today' }).click();
    const toast = page.getByText('Could not save your progress. We’ll keep trying.');
    await expect(toast).toBeVisible();
    // Sent again after 2 s (failing again, with no second toast), then 4 s: saved.
    await expect.poll(() => api.sent(PATCH).length).toBe(2);
    await expect(toast).toHaveCount(1);
    await expect.poll(() => tf.patches.length, { timeout: 15_000 }).toBe(1);
    expect(api.sent(PATCH)).toHaveLength(3);
    expect(Object.values(tf.doc.act_counts)).toEqual([1]);
    await expect(dialog(page).getByText('1 / 20')).toBeVisible();
  });

  test("TRN-07 a save that's refused as it is says why, shows the saved plan, and isn't sent again", async ({
    api,
    page,
  }) => {
    const tf = api.transform({ ask: ASK, plan: planFor(ASK) as never });
    api.failOnce(PATCH, 413, { code: 'plan_too_large', msg: 'Too large' });
    await openActivity(page);
    await dialog(page).getByRole('button', { name: 'Log today' }).click();
    await expect(
      page.getByText('That’s too much to save. Please shorten your notes.'),
    ).toBeVisible();
    // The plan read again, without the refused change.
    await expect(dialog(page).getByText('0 / 20')).toBeVisible();
    expect(api.callsTo('GET /children/{id}/transform').length).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(2500);
    expect(api.sent(PATCH)).toHaveLength(1);
    expect(tf.doc.act_counts).toEqual({});
  });
});

test.describe('a generation', () => {
  test('TRN-03 a plan still building when the page opens is joined, and shows when done', async ({
    api,
    page,
  }) => {
    const tf = api.transform({ ask: ASK, generating: ['plan'] });
    await page.goto(`/LifePathway/${C}`);
    await expect.poll(() => tf.doc.plan, SLOW).not.toBeNull();
    expect(tf.startedOf('plan')).toBe(1);
    await page.getByRole('button', { name: /Asha's 90 days/ }).click();
    await expect(dialog(page).getByRole('heading', { name: "Asha's ninety days" })).toBeVisible(
      SLOW,
    );
    await expect(dialog(page)).toContainText('Built around drawing');
  });

  test("TRN-03 a plan that can't start says why, and the dashboard still opens", async ({
    api,
    page,
  }) => {
    const tf = api.transform();
    api.fail('POST /children/{id}/transform/generation', 429, {
      code: 'llm_limit',
      msg: 'Rate limited',
    });
    await openPopup(page);
    await subscribe(page);
    await expect(
      page.getByText('Lots of requests right now. Please try again in a little while.'),
    ).toBeVisible(SLOW);
    await expect(dialog(page).getByRole('heading', { name: "Asha's ninety days" })).toBeVisible(
      SLOW,
    );
    expect(tf.doc.plan).toBeNull();
    expect(tf.doc.ask).toBe(ASK);
  });
});
