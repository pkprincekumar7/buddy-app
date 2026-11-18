# Running the tests

Every command to run the web app's tests, and the mobile app's. None of them needs the
backend, a database, an account or the LLM, and none writes anything real: the browser
tests answer every API call themselves (`e2e/fixtures.ts`). How the tests are built and why:
[docs/web-ui-test-plan.md](../docs/web-ui-test-plan.md); every flow and its tests:
[e2e/FLOWS.md](e2e/FLOWS.md).

Run the web commands from `frontend/`:

```bash
cd ~/Documents/Study/Extra/Application_Code/buddy-app/frontend
```

## Before the first run

```bash
npm ci                              # the packages, exactly as package-lock.json says
npx playwright install chromium     # Playwright's own Chromium (a download, once)
```

Without Playwright's Chromium the tests use the installed Google Chrome, which stalls with
several workers on macOS. Run the install from `frontend/` so it matches the project's
Playwright version.

## The whole suite

| What | Command | Time |
|---|---|---|
| Every browser test (~475), with the pause | `npm run test:e2e` | ~6 min |
| Every browser test, full speed | `SLOWMO=0 npm run test:e2e` | ~5 min |
| The same as CI: full speed, with coverage, then the floor check (90% of lines) | `npm run test:e2e:ci` | ~5 min |
| With coverage, no floor check | `npm run test:e2e:coverage` | ~6 min |
| Component and logic tests (Vitest, jsdom) | `npm test` | seconds |
| Both kinds | `npm test && npm run test:e2e:ci` | ~5 min |

After a coverage run, open `coverage/index.html` (by file and line) or
`test-results/report.html` (by test).

## Watching the tests run

| What | Command |
|---|---|
| Playwright's UI: pick tests, watch, step through, rewind | `npm run test:e2e -- --ui` |
| In a browser window, one test at a time | `npm run test:e2e -- --headed --workers=1` |
| One file in a window | `npm run test:e2e -- --headed --workers=1 e2e/games/grow.spec.ts` |
| Step through one test in the inspector, line by line | `npm run test:e2e -- --debug -g "KID-04"` |
| The UI in a browser tab instead of its own window | `npm run test:e2e -- --ui-port=0` |

In the UI, nothing runs until you press ▶ (Run all, at the top of the list, or one test's
own ▶). If the list looks empty, open **Projects** in the sidebar and tick `phone` and the
three `layout-*` projects.

### Speed: `SLOWMO`

Every Playwright run you start yourself pauses **800 ms** before each step, so you can follow
it in `--ui` or `--headed`. The checks never pause: CI, and `npm run test:e2e:ci` (what
`check.yml` and `./check.sh` run), which sets `SLOWMO=0` whatever your shell has.

| Pause | Command |
|---|---|
| Shorter | `SLOWMO=300 npm run test:e2e -- --ui` |
| Longer | `SLOWMO=1500 npm run test:e2e -- --headed --workers=1 e2e/nav.spec.ts` |
| None (full speed while watching) | `SLOWMO=0 npm run test:e2e -- --ui` |

### Page size: `VIEWPORT`

The flow tests run at a phone's size (375 × 812), where most layout bugs show; the layout
tests also check 768 and 1280 px by themselves. To watch the flow tests at another size:

| Size | Command |
|---|---|
| Desktop | `VIEWPORT=1280x800 npm run test:e2e -- --ui` |
| Tablet | `VIEWPORT=768x1024 npm run test:e2e -- --headed --workers=1 e2e/nav.spec.ts` |
| Fill a maximized window | `VIEWPORT=full npm run test:e2e -- --headed --workers=1 e2e/nav.spec.ts` |

`full` needs `--headed` or `--ui` (there's no window to fill otherwise). Some tests expect the
phone layout and can fail at another size; that isn't a bug in the app.

`SLOWMO` and `VIEWPORT` go together: `VIEWPORT=1280x800 SLOWMO=500 npm run test:e2e -- --ui`.

## Choosing which tests

| What | Command |
|---|---|
| One file | `npm run test:e2e -- e2e/smoke.spec.ts` |
| A folder | `npm run test:e2e -- e2e/games` |
| By flow ID or words in the title | `npm run test:e2e -- -g "KID-08"` |
| A whole area (every Transform flow) | `npm run test:e2e -- -g "TRN-"` |
| Leave some out | `npm run test:e2e -- --grep-invert "ALL-02"` |
| One test by its line | `npm run test:e2e -- e2e/flows/transform.spec.ts:84` |
| Only the flow tests (phone) | `npm run test:e2e -- --project=phone` |
| Only the layout tests, at one width | `npm run test:e2e -- --project=layout-desktop` |
| The layout tests at every width | `npm run test:e2e -- --project="layout-*"` |
| Only the files you've changed (uncommitted) | `npm run test:e2e -- --only-changed` |
| Only the files changed since main | `npm run test:e2e -- --only-changed=main` |
| One part of the suite (here the first of three) | `npm run test:e2e -- --shard=1/3` |
| Only the ones that failed last time | `npm run test:e2e -- --last-failed` |
| List the tests without running them | `npm run test:e2e -- --list` |
| Component tests by name | `npm test -- -t "Connect"` |
| Component tests, re-run on every save | `npm run test:watch` |

The flow IDs (`AUTH-`, `ADM-`, `ACC-`, `NAV-`, `ONB-`, `DIS-`, `GRW-`, `TRN-`, `REL-`,
`CON-`, `KID-`, `ALL-`) are listed in [e2e/FLOWS.md](e2e/FLOWS.md). `-g` and
`--grep-invert` take a regular expression: `-g "TRN-0[37]"` runs TRN-03 and TRN-07.
`--only-changed` also runs every spec that imports a changed file, so a change to
`e2e/fixtures.ts` or `e2e/data/` runs them all.

## When a test fails or flickers

| What | Command |
|---|---|
| Open a failure's trace (every step, the page, the network) | `npx playwright show-trace test-results/<test folder>/trace.zip` |
| Run a test many times to catch a flaky one | `npm run test:e2e -- -g "KID-04" --repeat-each=10` |
| Stop at the first failure | `npm run test:e2e -- -x` |
| Stop after a few failures | `npm run test:e2e -- --max-failures=3` |
| Retry failures once (as CI does) | `npm run test:e2e -- --retries=1` |
| A trace for every test, passed or not | `npm run test:e2e -- --trace=on -g "TRN-01"` |
| Fewer tests at once (a slow or busy machine) | `npm run test:e2e -- --workers=2` |
| Tests in a random order (to catch tests that depend on each other) | `npm run test:e2e -- --shuffle` |
| The same random order again (the seed the last run printed) | `npm run test:e2e -- --shuffle=1234` |
| Fail a run where a test passed only on its retry | `npm run test:e2e -- --retries=1 --fail-on-flaky-tests` |
| No time limit per test (while you investigate) | `npm run test:e2e -- --timeout=0 -g "KID-04"` |
| A limit for the whole run (here 10 min) | `npm run test:e2e -- --global-timeout=600000` |

A failed test leaves a screenshot, a trace and `error-context.md` (the error and the page as
a screen reader sees it) in `test-results/<test folder>/`.

## Reports

| What | Command |
|---|---|
| One line per test (the default here) | `npm run test:e2e` |
| One line that updates, then only the failures | `npm run test:e2e -- --reporter=line` |
| A dot per test | `npm run test:e2e -- --reporter=dot` |
| An HTML report, then open it | `npm run test:e2e -- --reporter=html`, then `npx playwright show-report` |
| The usual output, plus the HTML report | `npm run test:e2e -- --add-reporter=html` |
| JUnit XML (for another tool) | `PLAYWRIGHT_JUNIT_OUTPUT_NAME=results.xml npm run test:e2e -- --reporter=junit` |
| Less output: no browser or server logs | `npm run test:e2e -- --quiet` |
| Results in another folder | `npm run test:e2e -- --output=/tmp/pw-results` |
| The coverage run's report (by test) | `npx monocart show-report test-results/report.html` |

## Settings from the environment

| Variable | What it does |
|---|---|
| `SLOWMO=ms` | The pause before each step (800 by default; 0 for none). See above. |
| `VIEWPORT=WxH` or `full` | The flow tests' page size. See above. |
| `COVERAGE=1` | Collects coverage (as `test:e2e:coverage` does) and gives each assertion 15 s instead of 5 s. |
| `CI=1` | Behaves as CI: no pause, every core, one retry, `test.only` refused, Playwright's own Chromium. |

`npm run test:e2e:ci` sets `SLOWMO=0` itself, so it never pauses.

## Flags that don't apply here

- `--browser`: the tests are Chromium only. The projects choose it.
- `-u` / `--update-snapshots`, `--ignore-snapshots`: no test compares screenshots or snapshots.
- `--run-agents`, `--test-list`, `--tsconfig`, `-c`: not used by this suite.
- `npx playwright codegen`: it would record against the real API, not the stand-ins. Write
  tests against `e2e/fixtures.ts` instead.

## The checks CI runs (web)

Run these before pushing; they're what `.github/workflows/check.yml` runs:

```bash
npm run lint
./node_modules/.bin/prettier --check "src/**/*.{ts,tsx,css}" "e2e/**/*.ts" playwright.config.ts vitest.config.ts
npm run typecheck
npm test
npm run build
npm run test:e2e:ci
```

The build's main bundle must stay at or under 1.4 MB. From the repository root, `./check.sh`
runs all of this, plus the backend's and the mobile app's checks (several minutes).

## The mobile app (`frontend-app/`)

```bash
cd ~/Documents/Study/Extra/Application_Code/buddy-app/frontend-app
```

| What | Command |
|---|---|
| Every test (Jest), as CI | `CI=true yarn test --ci` |
| One test file | `yarn test src/__tests__/connectItems.test.ts` |
| Tests by name | `yarn test -t "Connect"` |
| Re-run on every save | `yarn test --watch` |
| Typecheck | `node_modules/.bin/tsc --noEmit` |
| Lint | `yarn lint` |
| Format check | `node_modules/.bin/prettier --check "src/**/*.{ts,tsx}"` |

## Not covered here

`scripts/e2e/` runs journeys against the real local stack (`journey.py`, `full-journey.py`,
`account-deletion.py` and others). It calls the real LLM, so each run costs, and it needs the
stack running; it's separate from everything above.
