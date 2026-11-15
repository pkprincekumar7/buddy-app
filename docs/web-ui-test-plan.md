# Web UI test suite — plan

A plan for automated tests that cover the web app's (`frontend/`) UI flows end to end, so a
small change no longer needs the whole stack started and clicked through by hand. Nothing here
is built yet; a first version was set up and removed on 2026-11-15, and what it taught is folded
in below (section 11).

Contents

1. Goal and scope
2. Two kinds of test
3. Tools and versions
4. Layout and configuration
5. The stubbed API
6. Helpers
7. Conventions
8. Flow inventory (every route, state and action)
9. Phases, tests and estimates
10. Coverage measurement
11. Pitfalls already found
12. CI and `check.sh`
13. Keeping it up to date

---

## 1. Goal and scope

**Goal.** Every user-visible flow of the web app has a test that runs without the backend, a
database, an account or the LLM, and writes nothing real. The whole suite runs in a few minutes
locally and in CI. Coverage is measured, not claimed (section 10): the target is **85–90% of the
lines in `frontend/src`** run by the tests, and **every row of the flow inventory** (section 8)
pointing at a test.

**In scope.** All 22 routes in `frontend/src/App.tsx`; their loading, empty, error and locked
states; every action that changes something (checked against what the app sends); the child
view's circles and all 14 games; sign-in and account; the admin page; layout at phone, tablet
and desktop widths; basic accessibility.

**Out of scope** (each needs another tool or can't be automated honestly):

| Not covered | Why | What covers it instead |
|---|---|---|
| The mobile app (`frontend-app/`) | React Native, not a browser | Its Jest suite today; a device-level tool (Maestro) would be a separate plan |
| Real Google sign-in | Google's page can't be driven in tests | A stubbed Google Identity Services script (section 6) |
| Real LLM output | Different every run, costs money | Fixed sample answers in the stubs; the backend's own tests and `scripts/e2e` |
| Sound and video actually playing | A headless browser has no ears | Tests check the media is requested and the page moves on |
| Exact look (colours, fonts) | Screenshot comparisons are flaky across machines | Layout checks (section 6); optional screenshots later |
| Real-device touch timing | Emulators and real phones differ | Manual check on a phone |

---

## 2. Two kinds of test

| | Component tests | Browser tests |
|---|---|---|
| Tool | Vitest + Testing Library, in jsdom | Playwright, in Chromium |
| What runs | One component or hook, its hooks stubbed with `vi.mock` | The real app, served by Vite, with the API stubbed at the network |
| Speed | ~2 s for dozens | ~1–3 s per test, run in parallel |
| Good for | Logic and states: what a component shows for given data, what a click calls | Flows across pages, layout and sizes, routing, timers, anything visual |
| Can't do | Layout (jsdom has no sizes), real routing across pages | Fine-grained branches deep inside a hook (use a component test) |
| Lives in | `frontend/src/**/*.test.ts(x)`, next to the code | `frontend/e2e/**/*.spec.ts` |
| Command | `npm test` / `npm run test:watch` | `npm run test:e2e` |

Rule of thumb: if it's about **where things are or how they flow between pages**, it's a
browser test; if it's about **what one component does with some data**, it's a component test.
Pure functions in `src/lib` (wins, streaks, game scoring, plans) get plain unit tests in Vitest.

---

## 3. Tools and versions

Pin exact versions (`--save-exact`) and use releases **at least two weeks old**. What worked on
2026-11-15 (Vite 8, React 19, Node 22/24):

| Package | Version | For |
|---|---|---|
| `vitest` | 5.0.5 | component and unit tests (peer: Vite ^6–^8) |
| `jsdom` | 30.1.3 | the DOM for Vitest (needs Node ^22.22.2 or ^24.15) |
| `@testing-library/react` | 16.3.3 | rendering (React 18/19) |
| `@testing-library/dom` | 10.4.2 | its peer |
| `@testing-library/jest-dom` | 7.0.1 | `toBeInTheDocument()` and friends |
| `@testing-library/user-event` | 14.6.8 | realistic clicks and typing |
| `@playwright/test` | 1.64.1 | browser tests |
| `monocart-reporter` (phase 0) | pick a ≥2-week-old release | coverage report from the browser tests |
| `@axe-core/playwright` (phase 6) | pick a ≥2-week-old release | accessibility checks |

Install (from `frontend/`; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` skips the browser, installed
separately below):

```bash
cd frontend
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --save-dev --save-exact \
  vitest@5.0.5 jsdom@30.1.3 @testing-library/react@16.3.3 @testing-library/dom@10.4.2 \
  @testing-library/jest-dom@7.0.1 @testing-library/user-event@14.6.8 @playwright/test@1.64.1
```

The browser, **always from `frontend/`** so it matches the project's Playwright (from the repo
root, `npx` fetches the newest Playwright and the wrong Chromium build; section 11):

```bash
cd frontend && npx playwright install chromium   # ~290 MB, once per Playwright upgrade
```

Locally the tests can use the installed Google Chrome instead (`channel: 'chrome'`), so the
download is only needed to run them as CI does (`CI=1 npm run test:e2e`).

`npm audit` after installing showed only the existing moderate `typescript-eslint`/`minimatch`
and `fast-uri` findings; CI's audit fails only on high/critical. Runtime dependencies: 0.

---

## 4. Layout and configuration

```
frontend/
  vitest.config.ts          component/unit test config
  playwright.config.ts      browser test config
  tsconfig.e2e.json         type checking for e2e/ and playwright.config.ts
  src/test/setup.ts         jest-dom matchers, cleanup
  src/**/X.test.tsx         component tests, next to X.tsx
  e2e/
    fixtures.ts             the `test` with the stubbed API (section 5)
    data/                   typed builders and scenarios (section 5)
    helpers/                layout, motion, clock, media, Google stubs (section 6)
    nav.spec.ts             phase 1
    games/discover.spec.ts  phase 2
    games/grow.spec.ts
    states/*.spec.ts        phase 3
    flows/*.spec.ts         phase 4
    auth.spec.ts            phase 5
    layout.spec.ts          phase 6
    FLOWS.md                the flow inventory, kept with the tests (section 8)
```

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Component and logic tests (`npm test`): jsdom, no browser, no server, no API.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
```

`frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

`frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// Browser tests (`npm run test:e2e`): the real app in Chrome against a stubbed API.
const PORT = 5288;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The installed Chrome locally; CI installs Playwright's own Chromium.
    channel: process.env['CI'] ? undefined : 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    // Phase 6 adds: tablet 768x1024 and desktop 1280x800, for the layout specs only
    // (`testMatch: /layout\.spec/`), so the flow tests don't run three times.
  ],
  webServer: {
    // --host: Vite on Node 24 listens on ::1 for "localhost"; the URL check uses 127.0.0.1.
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
```

`frontend/tsconfig.e2e.json` (also add it to `tsconfig.json`'s `references`, and
`vitest.config.ts` to `tsconfig.node.json`'s `include`):

```json
{
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.e2e.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["e2e", "playwright.config.ts"]
}
```

`frontend/package.json` scripts:

```json
"typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.e2e.json --noEmit",
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"test:e2e:coverage": "COVERAGE=1 playwright test"
```

`frontend/.gitignore` additions: `test-results/`, `playwright-report/`, `blob-report/`,
`coverage/`.

Component tests live under `src/`, so ESLint (`src/**`) and the CI Prettier check
(`src/**/*.{ts,tsx,css}`) already cover them; run Prettier on `e2e/` too (add it to the CI
Prettier step). Tests are never imported by the app, so the bundle doesn't change (checked:
main bundle unchanged, no test library in `dist/`).

---

## 5. The stubbed API

Every browser test runs the real app with **every `/api/v1` request answered by the test**
(`page.route`). This is what makes the suite fast, repeatable and safe.

### 5.1 The fixture

`e2e/fixtures.ts` exports a `test` (Playwright's, extended) whose `api` fixture:

- installs one route for `**/api/v1/**` and looks each request up as `"METHOD /path"` (the path
  after `/api/v1`, without the query), e.g. `GET /children/c-test/kids`;
- answers from a table of **stubs**: a fixed reply `{ status?, body }` or a handler
  `(request, url) => reply` for replies that depend on the query, the body or a call count;
- **records every call** (method, path, query, JSON body) so tests can assert what was sent;
- **fails the test** (in teardown) when a request had no stub, naming it: a page that starts
  calling a new endpoint shows up at once instead of hanging on a spinner;
- aborts `**/app-assets/**` (avatar videos and images): a failed video ends `StageSplash` at
  once (`onError` → `onReady`), so the circles' entry videos don't slow every test;
- offers `api.childView(page)`: writes `superpower.view = {"userId","childId"}` to
  `localStorage` before the app loads (`lib/ViewModeContext.tsx`), which is how the app knows
  it's in child view.

The core that worked (expand it as below):

```ts
await page.route('**/app-assets/**', (route) => route.abort());
await page.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url());
  const key = `${route.request().method()} ${url.pathname.replace(/^\/api\/v1/, '')}`;
  const stub = stubs[key];
  const reply = typeof stub === 'function' ? stub(route, url) : stub;
  if (!reply) {
    missing.push(key);
    return route.fulfill({ status: 501, json: { detail: `no stub for ${key}` } });
  }
  calls.push({ key, query: url.search, body: route.request().postDataJSON() });
  await route.fulfill({ status: reply.status ?? 200, json: reply.body });
});
```

### 5.2 Typed data builders (`e2e/data/`)

Write the stub bodies with the **generated API types** the app itself uses
(`frontend/src/api/generated/*.ts`, from `backend/openapi/*.json`), so a backend schema change
breaks the tests at type-check time, not at run time:

```ts
import type { components } from '../../src/api/generated/children';
type Child = components['schemas']['ChildOut']; // the schema name in that file

export const aChild = (over: Partial<Child> = {}): Child => ({ id: 'c-test', name: 'Asha', ... , ...over });
```

One builder per response the app reads (about 25; the full endpoint list is in section 8.3),
each with safe defaults and an override. Use **made-up people only** (Asha, Test Parent,
`parent@example.test`); never copy real responses, which carry real children's details.

Catalogue data that is the app's own content may be read from the repo instead of copied:
the Grow worlds and bands from `backend/grow/app/worlds.json`, and the quest catalogue and
the 90-day plan shapes from the transform service's data and its tests
(`backend/transform/tests/test_transform.py` has sample `plan`, milestones and areas).

### 5.3 Scenarios

Named starting points, each a full stub table, so a test says where it starts in one line:

| Scenario | The parent and child |
|---|---|
| `newParent` | Signed in, no children (Home's empty state, Add Child) |
| `childInSetup` | One child, profile saved, chat not finished (`progress.conversation: false`) |
| `childDiscovered` | Chat done, personality `ready`, other circles locked |
| `childMidway` | Discover and Grow done, Transform open, no plan |
| `childWithPlan` | Everything through Transform, a 90-day plan, a tracker |
| `everythingDone` | All circles done, wins shown, moods, quests logged |
| `tenChildren` | The 10-child limit |
| `admin` | `role: 'admin'`: only the admin page |
| `signedOut` | `/auth/me` 401, refresh 401 |

Each scenario also offers the **child-view** side (`circles_done`, stars, flipped powers,
best times, moods, quests, world runs) at matching progress.

### 5.4 Failure tools

Helpers on `api` so every page's error paths are one line:

- `api.fail(key, status = 500)`; `api.failOnce(key)` (then the normal reply, for Try again);
- `api.locked(key)`: 403 `{ detail: { code: 'circle_locked', msg } }` (pages redirect);
- `api.notFound(key)`: 404 `{ detail: { code: 'child_not_found' } }`;
- `api.expireSession()`: next call 401, `POST /auth/refresh` 200, the retry succeeds
  (`api/client.ts` refreshes once and retries); `api.endSession()`: refresh 401 too, the app
  fires `superpower:auth-expired` and goes to /Login;
- `api.lockAccount()`: refresh 403 `{ code: 'account_locked', msg }` (the message is shown);
- `api.slow(key, ms)`: hold a reply, to see loading states;
- `page.context().setOffline(true)` for offline.

### 5.5 Jobs that are polled

Personality, growth-area, transform and observation generations start a job (`POST …/generation`
→ `{ job_id }`) and poll `GET …/generation/{job_id}` (`api/polling.ts`, slowing from
`intervalMs` to `maxIntervalMs`). Stub the poll with a handler that answers `running` for the
first N calls and then `done`/`failed`; drive the poll timer with Playwright's clock
(section 6) rather than waiting in real time.

---

## 6. Helpers (`e2e/helpers/`)

| Helper | What it does | Notes |
|---|---|---|
| `overflowing(page, within?)` | Lists elements that make the page or a box scroll sideways: wider than the page, or content hidden by an `overflow: hidden` box | Skips 1px `sr-only` text and anything inside a box meant to scroll (`overflow-x: auto/scroll/hidden`). Caught the checkout bug ("div hides 42px sideways") with no test written for it |
| `settled(page)` | Waits until every animation that **ends** has ended | Ignore infinite ones (`effect.getComputedTiming().endTime === Infinity`): pulses and twinkles never finish |
| `freezeRandom(page, values)` | Replaces `Math.random` with a fixed sequence before the app loads (`addInitScript`) | Makes the games' light spots, bubbles, words and patterns the same every run |
| `page.clock` | Playwright's fake clock: `install()`, `runFor(ms)`, `fastForward()` | For timed games (Focus moves every 1.3 s, Climb slides every 60 ms, Grow rounds of 15–20 s), polling, debounced saves (600 ms), splash timers |
| `stubMedia(page)` | `HTMLMediaElement.play` resolves; `speechSynthesis.speak` records the text; `getUserMedia`/`MediaRecorder` give a silent stream | For the ambient track, read-aloud (TTS) and voice input (`components/shared/VoiceInput.tsx`, `/speech/transcriptions`) |
| `stubGoogle(page)` | Answers `accounts.google.com/gsi/client` with a fake `window.google.accounts.id` that calls the app's callback with a fake credential | Login's Google button; the app then calls `POST /auth/google`, which is stubbed |
| `stubUploads(page)` | Answers the presigned S3 PUT (`POST …/presign` → `{ url, fields? }`) | Child avatar, plan photos |
| `axe(page)` (phase 6) | Runs `@axe-core/playwright`, fails on serious/critical | Accessibility |

Game helpers (phase 2), one per mechanic, so each game test is a few lines:
`tapWhenVisible(locator)`, `holdFor(locator, ms)` (Brave Voice), `drawLine(page, box, points)`
(Imagination, Light Painting: `mouse.down/move/up`), `dragBasket(page, xPct)` (catch games),
`answerSort(left|right)`, `repeatPattern(pads)` (memory, reading the lit order from the
frozen random sequence).

---

## 7. Conventions

- **Find things the way a person does**: `getByRole('button', { name })`, `getByLabel`,
  `getByText`. Add a `data-testid` only where nothing accessible exists (game canvases), and
  prefer fixing the accessibility gap instead.
- **Never sleep.** Wait for content (`expect(locator).toBeVisible()`), for a request
  (`page.waitForRequest`), or move the fake clock. A page change in this app renders the new
  title before the old step has animated out: wait for something only the new step has.
- **One behaviour per test**, named for what a person sees: "Connect says so when the worlds
  fail to load, and Try again loads them".
- **Assert what was sent** for every write: `expect(api.calls).toContainEqual({ key: 'PATCH
  /children/c-test/transform', body: expect.objectContaining({ ask: '…' }) })`.
- **Stub only what the test needs to change**; scenarios hold the rest.
- **No real data**, ever: no copied responses, no real names, emails or photos.
- **Tests are independent**: any one can run alone (`npm run test:e2e -- -g "Connect"`).
- **A test that fails once in CI and passes on retry is a bug to fix**, not to retry: the
  report marks it flaky.
- Comments say why (a timing, a quirk), not what the next line does.

---

## 8. Flow inventory

The checklist the suite is measured against. Kept in `e2e/FLOWS.md` once tests exist, with
each row's test name; a row with no test is a known gap. IDs are used in the test titles
(`test('NAV-03 …')`) so a failure points back here.

### 8.1 Routes (from `frontend/src/App.tsx`)

| Route | Page | Who | Notes |
|---|---|---|---|
| `/Login`, `/Register` | Login, Register | signed out | Google sign-in on Login; signed-in users are sent on |
| `/` and the main page | Home | parent | hero, Continue Your Journey, child-view news (`ChildViewNews`) |
| `/Onboarding/:childId` (and `/Onboarding`, `state.forceNew`) | Onboarding | parent | child profile form, avatar upload |
| `/ConversationalOnboarding/:childId` | ConversationalOnboarding | parent | the chat, voice input |
| `/PersonalityJourney/:childId` | PersonalityJourney | parent | the orb (single circle), warp |
| `/PersonalityJourney/:childId/DimensionCircles` | PersonalityJourney | parent | the seven circles |
| `/PersonalityProfile/:childId` | PersonalityProfile | parent | Discover |
| `/GrowthAreas/:childId` | GrowthAreas | parent | Grow: growth map, area sheet, activity overlay |
| `/GrowthAreas/:childId/Activity/:activity[/Game\|/GreatInsights]` | redirect | — | old links → the growth map |
| `/LifePathway/:childId` | LifePathway | parent | Transform: milestones, Start Journey popup, plan, tracker, quests |
| `/Observations/:childId` | Observations | parent | Release: observations, moods |
| `/Connect/:childId` | Connect | parent | Connect: wins, share modals (Instagram, Twitter, WhatsApp) |
| `/Kids/:childId/:area` | KidsMode | child view | discover, grow, transform, release, connect |
| `/AccountSettings` | AccountSettings | parent | profile, preferences, sign out everywhere, delete account |
| `/Admin` | AdminAllowedEmails | admin | allowed emails, accounts, lock/unlock, role |
| `*` | PageNotFound | any | |

### 8.2 Flows by area

**Auth (AUTH)**
- AUTH-01 log in with email and password → Home; wrong password shows the error
- AUTH-02 register → first child onboarding; email not allowed shows the message
- AUTH-03 Google sign-in (stubbed script) → Home; Google error shown
- AUTH-04 a protected page when signed out → /Login, then back to that page after signing in
- AUTH-05 session expires mid-use → silent refresh, the action still works
- AUTH-06 refresh refused → /Login with "Session expired"; locked account → its message
- AUTH-07 sign out → /Login, the cache cleared (a second account sees nothing of the first)
- AUTH-08 admin signs in → only /Admin; a parent can't open /Admin

**Navigation (NAV)**
- NAV-01 Home → Continue Your Journey → orb → seven circles
- NAV-02 each circle (Discover, Grow, Transform, Release, Connect) → its page, and Back returns
  to the circles without the stack slide replaying
- NAV-03 a circle not yet open is locked (no navigation, the lock shown)
- NAV-04 Start Again (from the circles) asks to confirm; cancel keeps everything
- NAV-05 profile menu: open/close, Home, Account settings, Sign out, the child rows
- NAV-06 profile menu → a finished child → child view; a child in setup → onboarding; the
  pencil → profile form; × → delete confirmation
- NAV-07 child view hub → each circle → Home; locked circles; Back to parent view
- NAV-08 the header hides during the warp and the circle videos, and comes back after
- NAV-09 stale GrowthAreas Activity links redirect to the map; an unknown path shows 404
- NAV-10 deep links: opening any page directly (reload) works; a missing child → Home

**Onboarding (ONB)**
- ONB-01 Add Child → profile form: required fields, age, validation messages
- ONB-02 avatar upload: presign, the S3 PUT, the preview; a failed upload shown
- ONB-03 save → the chat; edit an existing child → the form filled, save keeps the chat
- ONB-04 the chat: welcome, each question, typed answers, quick replies, progress
- ONB-05 voice input: record → transcription → text in the box; mic refused shown
- ONB-06 finishing the chat → personality generation (polled) → the journey
- ONB-07 leaving mid-chat and coming back resumes where it was
- ONB-08 the 10-child limit disables Add Child

**Discover (DIS)**
- DIS-01 PersonalityProfile: generating → ready; failed → Try again
- DIS-02 the profile's sections, the "viewed" call made once
- DIS-03 the seven powers, their descriptions

**Grow, parent (GRW)**
- GRW-01 growth map: areas, done/not done, the area sheet opens and closes
- GRW-02 an area's activity overlay: the parent's reflections, the handoff, the child's
  rounds, the result (constellation, recommendations)
- GRW-03 an area's generation (polled); failure and retry
- GRW-04 completing an area marks it done and unlocks what follows

**Transform (TRN)**
- TRN-01 Life Pathway: area dropdown, milestones (generated, or the built-in ones), the chart
- TRN-02 Start Journey popup: step 1 (the ask, chips, own words), step 2 (the plan), step 3
  (checkout: Apple Pay, Link, card form, country, postal code), "Start free month"
- TRN-03 the plan generates (polled) while the "Subscription active" step waits; failure
- TRN-04 the dashboard: months, habits, "Done for now"; the tracker ("Track it step by
  step"): days, logging, the target event (name, date), photos (presign, upload)
- TRN-05 reopening the popup with a plan goes straight to the dashboard
- TRN-06 the child's quests on the parent's page (`ChildQuests`)
- TRN-07 the ask and the tracker save after a pause (600 ms debounce), once, with the version

**Release (REL)**
- REL-01 observations: generating → shown; failed → retry
- REL-02 editing an observation saves (PATCH)
- REL-03 recent moods from child view

**Connect, parent (CON)**
- CON-01 wins, including those the child chose to show ("From Asha")
- CON-02 each share modal (Instagram, Twitter, WhatsApp): opens, the text, copy, closes
- CON-03 the visit is recorded once (`POST …/connect/visit`)

**Child view (KID)**
- KID-01 hub: the circles, stars, Start Again, the voice toggle
- KID-02 Discover: the seven powers; opening a power flips it (+1 star the first time);
  all seven → the badge, Grow opens
- KID-03 each Discover game (section 8.4) to a win: "You did it!", the time, "New best!"
  against a saved best, the best saved only when better; Play again; Done; × and Escape
- KID-04 Grow: pick a world, three games in order, the dots, Back to worlds; the result
  (total, band, rows); the run saved once (`POST …/worlds/{n}/runs`); Try again, Next game
- KID-05 each Grow game type (section 8.4) to its end, with a good and a poor score
- KID-06 Transform: pick an interest, the quests, "I did it today" logs once a day
- KID-07 Release: pick a mood, add a note, save; today's mood shown; the streak
- KID-08 Connect: the wins list, pick one, the card, "Show my grown-up" (shown ✓); the
  "couldn't load all your wins" card when worlds or quests fail, Try again fetches only those
- KID-09 Read to me speaks the circle's line (TTS stubbed)
- KID-10 each circle's entry video plays once, not when coming back

**Account (ACC)**
- ACC-01 profile edit and save; validation
- ACC-02 voice preference toggle saves and applies everywhere
- ACC-03 sign out everywhere (`POST /auth/logout-all`)
- ACC-04 delete account: confirm, `DELETE /auth/account`, signed out
- ACC-05 delete a child: confirm, `DELETE /children/{id}`, gone from the menu

**Admin (ADM)**
- ADM-01 allowed emails: list, search, add, remove (with confirm)
- ADM-02 accounts: search, lock, unlock, change role

**Everywhere (ALL)**
- ALL-01 every page at 375, 768 and 1280 px: no sideways scrolling (`overflowing`)
- ALL-02 every page: no serious accessibility problems (axe)
- ALL-03 every page: a 500 on its main request shows its error, not a blank page
- ALL-04 every dialog: focus moves in, Escape closes, focus returns
- ALL-05 no console errors on any page

### 8.3 Endpoints the stubs must cover

From `frontend/src/api` (57 plus `/auth/refresh`); each needs a builder (section 5.2).

- auth: `GET /auth/me`, `POST /auth/login`, `POST /auth/register`, `POST /auth/google`,
  `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `DELETE /auth/account`,
  `GET/POST /auth/allowed-emails`, `POST /auth/allowed-emails/search`,
  `DELETE /auth/allowed-emails/{key}`, `GET /auth/accounts`, `POST /auth/accounts/search`,
  `POST /auth/accounts/{id}/lock`, `…/unlock`, `PATCH /auth/accounts/{id}/role`
- users: `GET/PATCH /users/me/profile`, `GET/PATCH /users/me/preferences`, `GET /users/profiles`
- children: `GET/POST /children`, `GET/PATCH/DELETE /children/{id}`,
  `POST /children/{id}/avatar/presign`, `POST /children/{id}/connect/visit`,
  `GET /children/{id}/kids`, `POST /children/{id}/kids/events`
- onboarding: `GET/PUT /children/{id}/onboarding`
- discover: `GET /children/{id}/personality`, `POST …/personality/generation`,
  `GET …/personality/generation/{job_id}`, `GET …/personality/powers`, `POST …/personality/viewed`
- grow: `GET /children/{id}/growth-areas`, `PUT …/growth-areas/{area_id}`,
  `POST …/{area_id}/generation`, `GET …/{area_id}/generation/{job_id}`,
  `GET …/growth-areas/worlds`, `POST …/worlds/{world}/runs`
- transform: `GET/PATCH /children/{id}/transform`, `POST …/transform/generation`,
  `GET …/transform/generation/{job_id}`, `POST …/transform/photos/presign`,
  `GET …/transform/quests`, `PUT …/transform/quests/current`, `POST …/transform/quests/log`
- release: `GET/PATCH /children/{id}/observations`, `POST …/observations/generation`,
  `GET …/observations/generation/{job_id}`
- shared: `POST /speech/transcriptions`, `GET /downloads/apk`

### 8.4 The games

Discover (`components/kids/KidsGames.tsx`, rules in `lib/kidsGames.ts`): **focus** (catch the
light 5 times; it moves every 1.3 s), **curious** (open the 9 boxes, find 3 planets),
**order** (tap stars 1–6; a wrong one), **draw** (draw 700 units of line), **climb** (tap
fast; it slides back every 60 ms), **voice** (press and hold until full), **energy** (pop 10
rising bubbles).

Grow (`components/kids/GrowGames.tsx`, rules in `lib/kidsGrow.ts`, content in
`backend/grow/app/worlds.json`): **catch** (drag the basket, good vs bad items, 20 s),
**sort** (left/right cards), **memory** (repeat the lit pattern, 2 lives), **timing** (tap when
the rings meet), **dash** (tap the targets), **react** (wait, then tap; too soon counts),
**spark** (paint the sky, 15 s). Each world has three; all six worlds are in `worlds.json`.

For each game: a win (or a good score), a loss (or a poor score), the result's text, and
for timed ones the clock driven with `page.clock`. With `freezeRandom` the positions are
known, so taps can be aimed (the earlier manual testing found aiming at a moving light
without that unreliable).

---

## 9. Phases, tests and estimates

Each phase ends green (lint, prettier, typecheck, build, both test commands) and is a
natural commit point. Estimates are coding time.

| Phase | Contents | Inventory rows | Tests (about) | Time |
|---|---|---|---|---|
| 0. Foundation | Install (section 3), configs (4), fixture with call log and missing-stub failure (5.1), typed builders for all endpoints (5.2), scenarios (5.3), failure tools (5.4), helpers (6), coverage (10), `FLOWS.md`, CI (12) | — | a smoke test per scenario | 1.5–2 h |
| 1. Navigation | NAV-01…10, KID-01, KID-10 | 12 | ~30 | 1.5 h |
| 2. Games | KID-02…05, the 14 games (8.4) | 4 + 14 | ~35 | 2–3 h |
| 3. States | ALL-03, the loading/empty/error/locked/not-found states of every page, AUTH-05/06, offline, polling success/failure (DIS-01, GRW-03, TRN-03, REL-01, ONB-06) | ~12 | ~40 | 2 h |
| 4. Writes | ONB-01…08, GRW-02/04, TRN-02…07, REL-02, CON-01…03, KID-06…09, ACC-01…05, each asserting what was sent | ~30 | ~35 | 2–3 h |
| 5. Auth and admin | AUTH-01…08, ADM-01/02 | 10 | ~15 | 1 h |
| 6. Layout and a11y | ALL-01, ALL-02, ALL-04, ALL-05 at three widths | 4 | ~25 (parametrised over routes) | 1 h |
| **Total** | | | **~200** | **11–14 h** |

Expected run time: component tests a few seconds; browser tests 2–4 minutes in CI with the
default workers (shard later with `--shard` if it grows).

Suggested order inside each phase: the happy path first, then each failure; write the
inventory row's test name into `FLOWS.md` as each test lands.

---

## 10. Coverage measurement

"Covered" must be a number, not a feeling.

- **Browser tests**: collect V8 coverage from Chromium (`page.coverage.startJSCoverage()` in
  the fixture when `COVERAGE=1`), map it back to `src/` through Vite's source maps, and write
  an HTML and a summary report. `monocart-reporter` does this as a Playwright reporter
  (`coverage: { entryFilter, sourceFilter: (p) => p.includes('/src/'), reports: ['v8',
  'console-summary'] }`). Run with `npm run test:e2e:coverage`; open `coverage/index.html`.
- **Component tests**: `vitest run --coverage` with `@vitest/coverage-v8` (same version as
  Vitest), if wanted; the browser report is the main number.
- **Targets**: lines 85–90%, and every inventory row with a test. Look at the report for
  unrun branches after each phase; each is either a missing test or dead code.
- Don't gate CI on the percentage until phase 4 is done; then fail below the reached level
  (a ratchet), so it can only go up.

---

## 11. Pitfalls already found

From the first setup (2026-11-15); each cost time once.

| Problem | Cause | Fix |
|---|---|---|
| `webServer` timed out after 120 s | Vite (Node 24) listened on `::1` for "localhost"; Playwright checked `127.0.0.1` | `--host 127.0.0.1` in the command |
| Waiting for animations never ended | Pulses and twinkles loop forever | Wait only for animations with a finite end (`settled`, section 6) |
| A layout check passed on a broken step | The popup's title changes before the old step animates out (`AnimatePresence`), so it measured a half-empty dialog | Wait for an element only the new step has, then `settled` |
| `overflowing` flagged hidden labels | Tailwind's `sr-only` is a 1px clipped box | Skip boxes ≤ 1px wide |
| CI-mode run found no browser | `npx playwright install` run from the repo root fetched the newest Playwright (1.65.1, Chromium 1255); the project's 1.64.1 needs 1248 | Install from `frontend/` |
| The circles' entry videos slowed tests | `StageSplash` waits for the video | Abort `/app-assets/**`; a failed video ends the splash |
| `/Kids/…` redirected to the parent's pages | Child view lives in `localStorage` (`superpower.view`) | `api.childView(page)` before `goto` |
| Lint errors in tests | `consistent-type-imports` forbids `import('…')` types; the security plugin forbids `new RegExp(variable)` | `import type * as M from '…'` + `importActual<typeof M>()`; match names with a function |
| `vi.mock` couldn't see test variables | Mocks are hoisted above the imports | Create the mocks' functions in `vi.hoisted(() => …)` |
| Aiming taps at moving game pieces failed | Positions are random and the pieces glide | `freezeRandom` + `page.clock` (section 6) |

What the first version proved: the 4 browser tests ran in ~10 s (also as CI does, with
Playwright's Chromium), and undoing the checkout fix made the layout test fail with "div
hides 42px sideways", so the approach catches real regressions.

---

## 12. CI and `check.sh`

In `.github/workflows/check.yml`, job **Frontend Lint**, after "Bundle size budget" (pinned
actions as the rest of the workflow; `actionlint` passed on this):

```yaml
      - name: Component tests (Vitest)
        run: npm test

      - name: Playwright version
        id: playwright
        run: echo "version=$(node -p "require('@playwright/test/package.json').version")" >> "$GITHUB_OUTPUT"

      - name: Cache Playwright's Chromium
        id: playwright-cache
        uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5.1.0
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-${{ runner.os }}-${{ steps.playwright.outputs.version }}

      - name: Install Playwright's Chromium
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      - name: Chromium's system libraries
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - name: Browser tests (Playwright)
        run: npm run test:e2e

      - name: Upload Playwright screenshots and traces
        if: failure()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: playwright-results
          path: frontend/test-results/
          retention-days: 7
          if-no-files-found: ignore
```

Also extend the job's Prettier step to `e2e/` and the config files. `check.sh` mirrors CI, so
add the same two commands there (`npm test`, `npm run test:e2e`), the browser tests skipped
with a message when no Chromium is installed.

---

## 13. Keeping it up to date

- A change to a page updates its tests in the same change; a new page or flow adds its rows
  to `FLOWS.md` and their tests.
- A new endpoint gets a builder; the missing-stub failure says so the first time it's called.
- A backend schema change shows up as a type error in the builders (they use the generated
  types): fix the builder, not the test.
- A bug found by hand gets a test that fails without the fix before the fix lands.
- Run locally: `npm test` (seconds), `npm run test:e2e` (minutes); watch a run with
  `npm run test:e2e -- --ui` (step through, rewind) or `--headed --workers=1`; replay a failure
  with `npx playwright show-trace test-results/<test>/trace.zip`.
