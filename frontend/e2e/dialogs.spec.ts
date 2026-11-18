import type { Locator, Page } from '@playwright/test';
import { CHILD_ID } from './data/builders';
import { planFor } from './data/transform';
import type { ScenarioName } from './data/scenarios';
import { expect, test, type Api } from './fixtures';
import { openPower } from './helpers/games';

// Every dialog (e2e/FLOWS.md, ALL-04): opening it moves focus into it, Escape closes it,
// and focus goes back to what opened it, so a keyboard user is never left on a page with
// nothing focused.

const C = CHILD_ID;

interface DialogCase {
  name: string;
  path: string;
  scenario?: ScenarioName;
  childView?: boolean;
  setup?: (api: Api) => void;
  /** The control that opens it. */
  opener: (page: Page) => Locator;
  /** Open it (defaults to pressing Enter on the opener, as a keyboard user would). */
  open?: (page: Page) => Promise<void>;
  dialog: (page: Page) => Locator;
  /** A known gap: the reason, for test.fail. */
  gap?: string;
}

const CASES: DialogCase[] = [
  {
    name: 'the profile menu',
    path: `/Connect/${C}`,
    opener: (p) => p.getByRole('button', { name: 'Your profile' }),
    dialog: (p) => p.getByRole('dialog', { name: 'User profile' }),
  },
  {
    name: 'Start Again',
    path: `/PersonalityJourney/${C}/DimensionCircles`,
    opener: (p) => p.getByRole('button', { name: 'Start Again' }),
    dialog: (p) => p.getByRole('alertdialog'),
  },
  {
    name: "the header's Start Over",
    path: `/Connect/${C}`,
    opener: (p) => p.getByRole('button', { name: 'Start Over' }),
    dialog: (p) => p.getByRole('alertdialog'),
  },
  {
    name: 'a Discover game',
    path: `/Kids/${C}/discover`,
    childView: true,
    opener: (p) => p.getByRole('button', { name: /^Order: play its game/ }),
    open: (p) => openPower(p, 'Order'),
    dialog: (p) => p.getByRole('dialog'),
  },
  {
    name: "a Grow area's sheet",
    path: `/GrowthAreas/${C}`,
    opener: (p) => p.getByRole('button', { name: /^Life Ambition/ }),
    dialog: (p) => p.getByRole('dialog', { name: /Life Ambition/ }),
  },
  {
    name: 'the Start Journey popup',
    path: `/LifePathway/${C}`,
    setup: (api) =>
      void api.transform({ ask: 'She loves drawing', plan: planFor('She loves drawing') as never }),
    opener: (p) => p.getByRole('button', { name: /Asha's 90 days/ }),
    dialog: (p) => p.getByRole('dialog'),
  },
  ...(['WhatsApp', 'Instagram', 'Twitter'] as const).map(
    (channel): DialogCase => ({
      name: `Connect's ${channel} share`,
      path: `/Connect/${C}`,
      opener: (p) => p.getByRole('button', { name: channel, exact: true }),
      dialog: (p) => p.getByRole('dialog'),
    }),
  ),
  {
    name: 'Sign out of all devices',
    path: '/AccountSettings',
    opener: (p) => p.getByRole('button', { name: 'Sign out of all devices' }),
    dialog: (p) => p.getByRole('alertdialog'),
  },
  {
    name: "the admin's Add email",
    path: '/Admin',
    scenario: 'admin',
    opener: (p) => p.getByRole('button', { name: 'Add email' }),
    dialog: (p) => p.getByRole('dialog'),
  },
  {
    name: "the admin's Remove",
    path: '/Admin',
    scenario: 'admin',
    opener: (p) => p.getByRole('button', { name: 'Remove f***@example.test' }),
    dialog: (p) => p.getByRole('alertdialog'),
  },
];

for (const dc of CASES) {
  test(`ALL-04 ${dc.name}: focus moves in, Escape closes, focus returns`, async ({ api, page }) => {
    if (dc.gap) test.fail(true, `known gap (FLOWS.md ALL-04): ${dc.gap}`);
    if (dc.scenario) api.use(dc.scenario);
    dc.setup?.(api);
    if (dc.childView) await api.childView(page);
    await page.goto(dc.path);
    const opener = dc.opener(page);
    await expect(opener).toBeVisible();
    await opener.focus();
    if (dc.open) await dc.open(page);
    else await page.keyboard.press('Enter');
    const dialog = dc.dialog(page);
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)), { timeout: 3000 })
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        () =>
          opener.evaluate(
            (o) => o === document.activeElement || o.contains(document.activeElement),
          ),
        {
          timeout: 3000,
        },
      )
      .toBe(true);
  });
}
