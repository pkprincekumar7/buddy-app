import { CHILD_ID, aTransform } from '../data/builders';
import { expect, test } from '../fixtures';
import { overflowing, settled } from '../helpers/page';

// Life Pathway's "Start <name>'s 90 days" popup at phone width: each step fits the screen
// (Step 3, the checkout, scrolled sideways once: its expiry and CVC inputs kept the
// browser's ~180px default in ~134px columns). Nothing here pays or makes a plan: the
// steps are walked with Continue only, and the stubbed API takes no writes.

test.beforeEach(({ api }) => {
  api.use('childMidway');
  api.set('GET /children/{id}/personality', {
    body: { status: 'failed', view_model: null, job_id: null, finalised_at: null, viewed_at: null },
  });
  // No plan yet (the popup starts at step 1), with step 1's answer already saved, so
  // Continue is on.
  api.set('GET /children/{id}/transform', { body: aTransform({ ask: 'She loves drawing.' }) });
});

test('TRN-02 each step of the popup fits a phone screen', async ({ page }) => {
  await page.goto(`/LifePathway/${CHILD_ID}`);
  await page.getByRole('button', { name: /Start Asha's 90 days/ }).click();
  const dialog = page.getByRole('dialog');

  // Each step and a field only it has: the title changes before the old step has animated
  // out, so the layout is measured once the new one's content is in.
  const steps = [
    ['Step 1 of 3', dialog.getByRole('button', { name: 'Continue' })],
    ['Step 2 of 3', dialog.getByRole('button', { name: 'Continue' })],
    ['Step 3 of 3', page.locator('#journey-pay-cvc')],
  ] as const;
  for (const [step, content] of steps) {
    await expect(dialog).toContainText(step);
    await expect(content).toBeVisible();
    // The steps fade in; measure the settled layout.
    await settled(page);
    expect(await overflowing(page, '[role="dialog"]'), step).toEqual([]);
    if (step !== 'Step 3 of 3') await dialog.getByRole('button', { name: 'Continue' }).click();
  }
  // The checkout's card row: expiry and CVC share it, each inside its own half.
  for (const id of ['journey-pay-expiry', 'journey-pay-cvc']) {
    const fits = await page.locator(`#${id}`).evaluate((input) => {
      const own = input.getBoundingClientRect();
      const cell = input.parentElement!.getBoundingClientRect();
      return own.left >= cell.left - 0.5 && own.right <= cell.right + 0.5;
    });
    expect(fits, `${id} inside its column`).toBe(true);
  }
});
