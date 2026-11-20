import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices, type ReporterDescription } from '@playwright/test';
import { coverageOptions, E2E_PORT } from './e2e/coverage-options.mjs';

// Browser tests (`npm run test:e2e`): the real web app in Chrome against a stubbed API
// (e2e/fixtures.ts), so no backend, database, LLM or account is needed and nothing real is
// written. The app is served by its own Vite dev server on PORT. docs/web-ui-test-plan.md.
const PORT = E2E_PORT;
const CI = !!process.env['CI'];
const COVERAGE = !!process.env['COVERAGE'];
// Playwright's own headless Chromium when it's installed (`npx playwright install chromium`
// from frontend/; CI always): steadier than Google Chrome with several workers on macOS,
// where Chrome's instances stalled (a route call timing out). Without it, the installed Chrome.
const BUNDLED = CI || existsSync(chromium.executablePath());

/**
 * The flow tests' page size: a phone's (375 × 812) unless VIEWPORT says otherwise, to watch
 * a headed run at another size. VIEWPORT=1280x800 sets one; VIEWPORT=full fills the browser
 * window (with --headed). Some tests expect the phone layout, so another size can fail them;
 * CI never sets it.
 */
function flowViewport(): { width: number; height: number } | null {
  const asked = process.env['VIEWPORT'];
  if (!asked) return { width: 375, height: 812 };
  if (asked === 'full') return null;
  const m = /^(\d+)x(\d+)$/.exec(asked);
  if (!m) throw new Error(`VIEWPORT must be WIDTHxHEIGHT (e.g. 1280x800) or full, not "${asked}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}
const VIEWPORT = flowViewport();
/**
 * The pause before each action, in ms. A run you start yourself pauses 800 ms, so each step
 * can be followed (in --ui or --headed); SLOWMO=300 sets another pause, SLOWMO=0 none. The
 * checks don't pause: CI, and `npm run test:e2e:ci` (check.yml and check.sh), which sets
 * SLOWMO=0. Set as SLOWMO here so the test workers (other processes) read the same value.
 */
if (process.env['SLOWMO'] === undefined && !CI) process.env['SLOWMO'] = '800';
const SLOW_MO = Number(process.env['SLOWMO'] ?? 0);
if (!Number.isFinite(SLOW_MO) || SLOW_MO < 0) throw new Error('SLOWMO must be a number of ms');

const reporters: ReporterDescription[] = [[CI ? 'github' : 'list']];
if (COVERAGE) {
  // V8 coverage from Chromium (collected in e2e/fixtures.ts), mapped back to src/ through
  // Vite's source maps: `npm run test:e2e:coverage`, then open coverage/index.html. The
  // settings are in e2e/coverage-options.mjs, which the shard merge uses too. COVERAGE_RAW
  // also keeps the raw data (coverage/raw): check.yml's shards, merged by
  // e2e/coverage-merge.mjs.
  reporters.push([
    'monocart-reporter',
    {
      name: 'Web UI tests',
      outputFile: './test-results/report.html',
      coverage: coverageOptions({ raw: !!process.env['COVERAGE_RAW'] }),
    },
  ]);
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Every core in CI (Playwright's default is half): ~450 tests took 5 min on 7 workers.
  workers: CI ? '100%' : undefined,
  reporter: reporters,
  // A paused run takes far longer than the default 30 s per test (a Grow world is ~100 taps).
  timeout: SLOW_MO ? 600_000 : 30_000,
  // Coverage instruments every script, which slows the app's timed intros past the default.
  expect: { timeout: COVERAGE ? 15_000 : 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: BUNDLED ? undefined : 'chrome',
    // The pause above (SLOW_MO): on for a run you start, off for CI and test:e2e:ci.
    launchOptions: { slowMo: SLOW_MO },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // A phone's width (iPhone 13 class), where most layout bugs show.
    {
      name: 'phone',
      testIgnore: /layout\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORT,
        // Filling the window: no fixed size or scale, and a maximized window to fill (a
        // project's launchOptions replace the top-level ones, so slowMo comes along).
        ...(VIEWPORT === null && {
          deviceScaleFactor: undefined,
          launchOptions: { slowMo: SLOW_MO, args: ['--start-maximized'] },
        }),
      },
    },
    // The layout checks run at three widths; the flow tests run once, at phone width.
    {
      name: 'layout-phone',
      testMatch: /layout\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'layout-tablet',
      testMatch: /layout\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'layout-desktop',
      testMatch: /layout\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // --host: Vite on Node 24 listens on ::1 for "localhost"; the URL check uses 127.0.0.1.
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
    // Shell variables win over .env.local: same-origin API calls (stubbed by page.route)
    // and a Google button to click (stubGoogle answers its script).
    env: { VITE_API_URL: '', VITE_GOOGLE_CLIENT_ID: 'test-client-id.apps.example.test' },
  },
});
