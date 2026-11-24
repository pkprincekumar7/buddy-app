import type { Page } from '@playwright/test';
import { CHILD_ID } from './data/builders';
import type { ScenarioName } from './data/scenarios';
import { expect, test } from './fixtures';
import { axe, overflowing, settled } from './helpers/page';

// Every page at phone, tablet and desktop widths (e2e/FLOWS.md, ALL-01, ALL-02, ALL-05):
// no sideways scrolling, no serious or critical accessibility problems (axe), and no
// console errors. Runs in the layout-* projects (playwright.config.ts), once per width.

const C = CHILD_ID;

interface PageCase {
  name: string;
  path: string;
  /** Something only the loaded page has: measured once it's there. */
  ready: (page: Page) => ReturnType<Page['getByText']>;
  scenario?: ScenarioName;
  childView?: boolean;
  /** axe rules failing here for a known gap: checked by a test.fail of their own. */
  gaps?: string[];
}

export const PAGES: PageCase[] = [
  {
    name: 'Login',
    path: '/Login',
    scenario: 'signedOut',
    ready: (p) => p.getByRole('heading', { name: 'Sign in' }),
  },
  {
    name: 'Home',
    path: '/',
    ready: (p) => p.getByRole('button', { name: 'Continue Your Journey' }),
  },
  {
    name: 'Home, no children',
    path: '/',
    scenario: 'newParent',
    ready: (p) => p.getByRole('button', { name: 'Start Your Journey' }),
  },
  {
    name: 'the profile form',
    path: `/Onboarding/${C}`,
    ready: (p) => p.getByText('Tell us about your child'),
  },
  {
    name: 'the chat',
    path: `/ConversationalOnboarding/${C}`,
    scenario: 'childInSetup',
    ready: (p) => p.getByText(/Mention the top 3 strengths/),
  },
  {
    name: 'the orb',
    path: `/PersonalityJourney/${C}`,
    ready: (p) => p.getByRole('button', { name: 'Enter the circles' }),
  },
  {
    name: 'the circles',
    path: `/PersonalityJourney/${C}/DimensionCircles`,
    ready: (p) => p.getByText('Tap the center HUD to return home'),
  },
  {
    name: 'Discover',
    path: `/PersonalityProfile/${C}`,
    ready: (p) => p.getByRole('button', { name: "See Asha's results" }),
  },
  {
    name: 'Grow',
    path: `/GrowthAreas/${C}`,
    ready: (p) => p.getByText('Choose an area to explore'),
  },
  {
    name: 'Transform',
    path: `/LifePathway/${C}`,
    ready: (p) => p.getByRole('button', { name: /Asha's 90 days/ }),
  },
  {
    name: 'Release',
    path: `/Observations/${C}`,
    ready: (p) => p.getByText('Settles better outdoors than indoors'),
  },
  {
    name: 'Connect',
    path: `/Connect/${C}`,
    ready: (p) => p.getByRole('heading', { name: 'Share Asha’s wins' }),
  },
  {
    name: 'Account settings',
    path: '/AccountSettings',
    ready: (p) => p.getByRole('heading', { name: 'Account settings' }),
  },
  {
    name: 'Admin',
    path: '/Admin',
    scenario: 'admin',
    ready: (p) => p.getByText('f***@example.test'),
  },
  { name: '404', path: '/no-such-page', ready: (p) => p.getByText(/404|not found/i).first() },
  {
    name: 'child view: Discover',
    path: `/Kids/${C}/discover`,
    childView: true,
    ready: (p) => p.getByText('7 superpowers unlocked'),
  },
  {
    name: 'child view: Grow',
    path: `/Kids/${C}/grow`,
    childView: true,
    ready: (p) => p.getByRole('heading', { name: 'Pick a world' }),
  },
  {
    name: 'child view: Transform',
    path: `/Kids/${C}/transform`,
    childView: true,
    ready: (p) => p.getByRole('heading', { name: 'Your quests' }),
  },
  {
    name: 'child view: Release',
    path: `/Kids/${C}/release`,
    childView: true,
    ready: (p) => p.getByRole('heading', { name: 'How do you feel today?' }),
  },
  {
    name: 'child view: Connect',
    path: `/Kids/${C}/connect`,
    childView: true,
    ready: (p) => p.getByRole('heading', { name: 'Your wins' }),
  },
  {
    name: 'child view: the circles',
    path: `/PersonalityJourney/${C}/DimensionCircles`,
    childView: true,
    ready: (p) => p.getByRole('button', { name: 'Start Again Completed' }),
  },
];

for (const pc of PAGES) {
  test.describe(pc.name, () => {
    test.beforeEach(async ({ api, page }) => {
      if (pc.scenario) api.use(pc.scenario);
      if (pc.childView) await api.childView(page);
      await page.goto(pc.path);
      await expect(pc.ready(page)).toBeVisible();
      await settled(page);
    });

    test('ALL-01 no sideways scrolling', async ({ page }) => {
      expect(await overflowing(page)).toEqual([]);
    });

    test('ALL-02 no serious accessibility problems', async ({ page }) => {
      expect(await axe(page, pc.gaps)).toEqual([]);
    });

    for (const rule of pc.gaps ?? [])
      test(`ALL-02 gap: ${rule}`, async ({ page }) => {
        test.fail(true, `known gap (FLOWS.md ALL-02): ${rule} on ${pc.name}`);
        const all = await axe(page);
        expect(all.filter((line) => line.startsWith(`${rule} `))).toEqual([]);
      });

    test('ALL-05 no console errors', async ({ consoleErrors }) => {
      // A signed-out start logs its failed account check on purpose.
      expect(consoleErrors.filter((e) => !e.startsWith('Auth check failed'))).toEqual([]);
    });
  });
}
