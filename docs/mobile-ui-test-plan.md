# Mobile UI test suite — plan

A plan for automated tests that run the mobile app (`frontend-app/`) on the iOS Simulator and
an Android emulator and drive its UI flows end to end with [Maestro](https://maestro.dev), the
way the web app's Playwright suite does in a browser ([web-ui-test-plan.md](web-ui-test-plan.md)).
Nothing is built yet; this plan is the starting point.

**Status** (kept current as phases land; the per-row state goes in `frontend-app/.maestro/FLOWS.md`):

| Phase | State |
|---|---|
| 0. Foundation | not started |
| 1. Smoke set | not started |
| 2. Navigation and child view | not started |
| 3. Writes | not started |
| 4. States | not started |
| 5. Auth and admin | not started |
| 6. CI | not started |

Contents

1. Goal and scope
2. Three kinds of test
3. Tools and versions
4. Layout and configuration
5. The stand-in API server
6. Subflows and helpers
7. Conventions
8. Flow inventory
9. Phases, tests and estimates
10. Coverage measurement
11. Pitfalls to expect
12. CI and `check.sh`
13. Keeping it up to date

---

## 1. Goal and scope

**Goal.** Every main journey of the mobile app has a Maestro flow that runs on **both** iOS and
Android, against a stand-in API, with no backend, database, account or LLM, and writes nothing
real. A smoke set runs in a few minutes per platform; the full suite in about 10–20 minutes per
platform.

**Why device tests at all.** Android and iOS run the same TypeScript (`frontend-app/src/`), so
Jest already covers the logic for both (section 10). What differs between the platforms, and
what Jest can't see, is the app on a real OS: native navigation, the keyboard covering fields,
permission prompts, touch targets, safe areas, fonts, and platform-only code paths
(`Platform.OS`, such as the Android emulator's `10.0.2.2` address in `src/lib/env.ts`).

**Why not Playwright.** Playwright drives web browsers only. The mobile app is native React
Native: no web page or WebView to open, and no web build (`react-native-web` isn't a
dependency). Playwright's phone emulation tests the *web* app at a phone's size, which the web
suite already does.

**In scope.** The screens in `src/navigation/index.tsx`: Login, Register, Home, the child
profile form, the chat, the journey's orb and circles, Discover, Grow, Transform, Release,
Connect, child view (`KidsMode`), Account settings, Admin and Not found; their loading, error
and locked states; every action that changes something (checked against what the app sent);
sign-in and sign-out.

**Out of scope:**

| Not covered | Why | What covers it instead |
|---|---|---|
| A coverage number | Maestro drives the built app from outside; it can't see which lines ran | Jest coverage (section 10) |
| Real Google sign-in | The native Google sheet can't be driven | Flows sign in with email and password against the stand-in |
| Timed games, exactly | Maestro has no fake clock | Flows check a game starts and ends; scoring rules stay in Jest |
| Real LLM output | Different every run, costs money | Fixed answers in the stand-in |
| Push notifications (`@notifee`) | Delivered by the OS, hard to trigger | Jest with notifee mocked; a manual check |
| Sound, speech and the microphone actually working | A flow can't hear what plays or speak into the microphone | Flows check the controls and the messages; Jest for the logic |
| Exact look (colours, fonts) | Screenshot comparisons are flaky across machines and OS versions | Optional screenshots later (`takeScreenshot`) |
| Real devices | Not on this machine or in CI | A manual check on a phone before a release |

---

## 2. Three kinds of test

| | Jest + Testing Library | Maestro (this plan) | Playwright (web) |
|---|---|---|---|
| What runs | One component or hook, natives mocked | The real app, built, on a simulator or emulator | The web app in Chromium |
| Platforms | Neither: Node | iOS and Android | Web only |
| Speed | ~40 s for 278 tests | ~30 s–2 min per flow, per platform | ~5 min for 474 |
| Good for | Logic, states, what a tap calls | Journeys across screens, native behaviour, both OSes | Web flows, layout, timers |
| Coverage number | Yes | No | Yes (web code) |
| Lives in | `frontend-app/src/**/__tests__/` | `frontend-app/.maestro/` | `frontend/e2e/` |

Rule of thumb: logic and single-screen states in Jest; a journey across screens, or anything
that depends on the OS, in Maestro. Don't test the same thing twice at length.

---

## 3. Tools and versions

What this machine has (checked 2026-11-17):

| Tool | State | Note |
|---|---|---|
| Xcode | 26.3, installed | 6 iPhone simulators available |
| Android SDK | installed (`~/Library/Android/sdk`) | an emulator image (android-37) and a `Pixel_10` AVD |
| `adb`, `emulator` | in the SDK, **not on `PATH`** | add `$ANDROID_HOME/platform-tools` and `$ANDROID_HOME/emulator` |
| Java | OpenJDK 17 | what Gradle and Maestro need |
| Maestro CLI | **not installed** | a download: install with its official script, pinned to one version, recorded here |

The app: Expo ~56, React Native 0.85.3, bundle and application ID `com.superpowerapp` on both
platforms. `react-native-config` reads its settings (`API_URL`, `GOOGLE_CLIENT_ID`,
`IOS_CLIENT_ID`, `CDN_BASE_URL`) from an env file **at build time**, so the test build has its
own file (section 4).

Install (phase 0, each download agreed first):

```bash
# Pin the version: the install script reads MAESTRO_VERSION, so set it before running it.
export MAESTRO_VERSION=<x.y.z>
curl -fsSL "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
maestro --version
```

The stand-in server (section 5) is TypeScript that imports the web suite's data, which Node 24
can't run by itself (extensionless imports, `private readonly` constructor parameters). Try
Vite's own `runnerImport` first (the web app has Vite 8.1.6); otherwise add `tsx` as a dev
dependency (a download).

---

## 4. Layout and configuration

```
frontend-app/
  .env.e2e                     the test build's settings: API_URL at the stand-in, no secrets (committed)
  .maestro/
    config.yaml                flow order, tags (smoke, nav, writes, states, auth)
    FLOWS.md                   the inventory (section 8), each row's flow file
    flows/
      smoke/                   one flow per scenario: the main screen loads
      nav/  onboarding/  discover/  grow/  transform/  release/  connect/  kids/  account/  auth/  states/
    subflows/
      start.yaml               choose a scenario, clear the app's data, launch it
      sign-in.yaml             email and password → Home
      child-view.yaml          switch to the child view
    scripts/
      stand-in.js              Maestro runScript helpers: pick a scenario, fail a route, read what was sent
  e2e-stand-in/
    server.ts                  the stand-in API (section 5)
scripts/
  maestro.sh                   start the stand-in, build if needed, run the flows on one platform
```

**The test build.** `ENVFILE=.env.e2e` selects the file `react-native-config` reads:

```
API_URL=http://localhost:5299
CDN_BASE_URL=http://localhost:5299
GOOGLE_CLIENT_ID=test-client-id.apps.example.test
IOS_CLIENT_ID=test-client-id.apps.example.test
```

On Android, `src/lib/env.ts` turns `localhost` in `API_URL` into `10.0.2.2` (the host as the
emulator sees it), but **not** in `CDN_BASE_URL`: there, `localhost` stays the emulator itself,
so the assets fail to load. That's what the tests want anyway (the splashes skip, as with the
404 on iOS), but don't rely on `CDN_BASE_URL` for anything else on Android.

On iOS, `react-native-config` reads `ENVFILE` when the pods' build step runs, and Xcode can keep
an earlier value: check in phase 0 that the built app has the stand-in's URL, and clean the
build if not. Builds (Android's Release build is signed with the debug key, so it needs no
keystore):

| Platform | Locally | CI |
|---|---|---|
| iOS | `ENVFILE=.env.e2e yarn ios --simulator "iPhone 17"` (debug, with Metro) | a Release build for the simulator, JS bundled in, no Metro |
| Android | `ENVFILE=.env.e2e yarn android` (debug, with Metro) | `./gradlew assembleRelease` with the e2e env, JS bundled in |

The developer's own `.env` is never read or changed by the tests.

---

## 5. The stand-in API server

Playwright answers requests inside the browser (`page.route`). On a device the app makes real
HTTP requests, so the stand-in is a small local server, **reusing the web suite's data** so
both apps are tested against the same answers:

- `frontend/e2e/data/` (builders, scenarios, `GrowServer`, `KidServer`, `TransformServer`) is
  shared as it is.
- The route matching in `frontend/e2e/fixtures.ts` (`matcherOf`, `match`, `resolve`) moves into
  `frontend/e2e/data/match.ts`, used by the Playwright fixture and by this server: one copy.
- A request no stub answers gets a 501 and is listed, and the flow fails on it (as the web
  fixture's teardown does).
- `/app-assets/**` gets a 404, so the stage splashes skip at once (as on the web).

**Control routes** (only on the stand-in, under `/__e2e/`), called from flows with Maestro's
`runScript` and its `http` object:

| Route | Does |
|---|---|
| `POST /__e2e/reset {scenario}` | a fresh scenario (`everythingDone`, `newParent`, `childInSetup`, …), the call log emptied |
| `POST /__e2e/fail {route, status, detail, once}` | a route answers an error, always or once |
| `POST /__e2e/slow {route, ms}` | holds a reply, to see a loading state |
| `GET /__e2e/calls?route=…` | the requests answered, with their bodies, to check what a write sent |

The mobile app's auth differs from the web's (`src/api/client.ts`): it reads `access_token` and
`refresh_token` from the **bodies** of login, register and refresh, stores them in the iOS
Keychain or Android Keystore (`expo-secure-store`), sends `Authorization: Bearer <access>` on
every call, and on a 401 sends the refresh token as the Bearer to `/auth/refresh`. The web's
`aToken()` builder returns only `{ status: 'ok' }` (the web uses cookies), so the stand-in adds
fake tokens to those three answers, and its session check accepts the Bearer header instead of
a cookie. Both fields are optional in `TokenResponse`, so the shared builder can take them
without breaking the web suite.

**Why not the real backend in test mode.** `docker compose --env-file .env --env-file .env.test`
runs every service against the `mongo` container and Moto, but the LLM keys stay real
(`docs/getting-started.md`, "Manual and test modes"): every generation would call the LLM and
cost money, and answers would differ between runs. The stand-in keeps the flows free and fixed.

Runs on port 5299 (the web tests use 5288). One stand-in serves one device, so iOS and Android
runs either take turns or use two ports.

---

## 6. Subflows and helpers

- **`start.yaml`**: `runScript` to reset the scenario, then `launchApp` with `clearState: true`
  (a fresh install's storage) and the permissions the flow needs (`permissions: { microphone:
  allow }` or `deny`), so no system prompt interrupts a flow. On iOS also `clearKeychain`:
  the tokens live in the Keychain, which `clearState` leaves, so a flow would otherwise start
  signed in as the last one ended.
- **`sign-in.yaml`**: type the stand-in's test email and password on Login, tap Sign in, wait
  for Home. Every signed-in flow starts with it (a few seconds).
- **`child-view.yaml`**: switch to the child view through the profile menu.
- **Checking a write**: a `runScript` reads `/__e2e/calls` and sets an output that
  `assertTrue` checks, for example that the chat's save sent all seven answers once.
- **Waiting**: `extendedWaitUntil` for something only the next screen has, and
  `waitForAnimationToEnd` after a screen change. Never a fixed wait.

---

## 7. Conventions

- **Find things the way a person does**: by visible text or accessibility label (71 files
  already set `accessibilityLabel`). Add a `testID` only where there's nothing to read (a game
  board, an icon button): only 5 exist today, and phase 0 adds those the flows need.
- **One journey per flow**, named for what a person sees, starting with its inventory ID:
  `TRN-02-start-journey-subscribes.yaml`.
- **Every flow runs on both platforms.** Where they differ (a back gesture, a date picker),
  `runFlow` with `when: platform: …`, not two copies.
- **Each flow starts fresh** (`start.yaml`): any one can run alone.
- **Assert what was sent** for every write, through `/__e2e/calls`.
- **No real data**: no copied responses, no real names, emails or photos.
- **Hide the keyboard** (`hideKeyboard`) before tapping a button below a text field.
- **A flow that fails once and passes on retry is a bug to fix**, not to retry.

---

## 8. Flow inventory

The same IDs as the web suite's `frontend/e2e/FLOWS.md`, so one journey can be compared across
the two apps. `frontend-app/.maestro/FLOWS.md` lists each row, its flow file, and its state on
iOS and Android. A row that isn't worth a device flow says so and names its Jest test.

| Area | Rows | Device flows (about) | Notes |
|---|---|---|---|
| Auth (AUTH) | sign in, a wrong password, register, sign out, an expired session | 5 | email and password only (section 1) |
| Navigation (NAV) | Home → the orb → the circles, each circle and back, a locked circle, Start Again, the profile menu | 6 | the stack's back gesture on iOS, the back button on Android |
| Onboarding (ONB) | the profile form, a photo, the chat's seven answers, voice input, the save and the personality | 5 | the photo picker and the microphone need permissions set in `start.yaml` |
| Discover (DIS) | the reveal, the results | 2 | |
| Grow (GRW) | an area, its questions generated, the activity overlay, the result | 3 | |
| Transform (TRN) | the milestones, the Start Journey popup, the plan, the dashboard, the tracker, a photo | 5 | |
| Release (REL) | the observations, the moods | 2 | |
| Connect (CON) | the wins, a share | 2 | sharing opens the OS share sheet: check it opens, then dismiss it |
| Child view (KID) | the hub, each circle, one game start to end, logging a mood and a quest | 6 | |
| Account (ACC) | the profile, preferences, delete account (asks first) | 3 | |
| Admin (ADM) | the allowlist, an account's lock | 2 | |
| States (ALL) | a failed load with Try again, offline, not found | 3 | |
| **Total** | | **~45** | |

---

## 9. Phases, tests and estimates

Each phase ends green on **both** platforms and is a natural commit point. Times are Claude Code
session time; the limit is build and flow run time, not writing (a flow takes 30 s–2 min per
platform, and each is run, fixed and run again). By hand, budget about 3–4 working days.

| Phase | Contents | Flows (about) | Time |
|---|---|---|---|
| 0. Foundation | Install (section 3), `.env.e2e`, the first iOS and Android test builds, the stand-in server with the shared matcher (5), subflows (6), `testID`s the first flows need, `FLOWS.md`, `scripts/maestro.sh` | a smoke flow per scenario | 1–1.5 h (builds ~30–40 min of it) |
| 1. Smoke set | Sign in, add a child, the chat, one circle, the child view | 5–8 | ~45 min |
| 2. Navigation and child view | NAV, KID | ~12 | 1–1.5 h |
| 3. Writes | ONB, GRW, TRN, REL, CON, ACC, each checked against what was sent | ~18 | 1.5–2 h |
| 4. States | ALL, failures and Try again, offline | ~4 | 30 min |
| 5. Auth and admin | AUTH, ADM | ~7 | 30 min |
| 6. CI | Section 12 | — | ~30 min, plus one CI run |
| **Total** | | **~45–50** (the smoke set's flows overlap the later phases') | **~5–8 h** (smoke set alone: ~2 h with phase 0) |

Run time, estimated: the smoke set ~3–5 min per platform; the full suite ~10–20 min per
platform, more in CI on a 4-core runner.

---

## 10. Coverage measurement

Maestro gives no coverage number. The number for the mobile app is **Jest's**, and it counts
for both platforms, since they run the same code:

- **Today** (measured 2026-11-17, `src/`, generated clients and tests left out): **45.14% of
  lines** (3,136 / 6,947), 29.78% of branches, from 278 tests.
- **Lowest areas**: `components/onboarding` 13%, `components/lifepathway` 16%,
  `screens/GrowthAreas` 9%, `screens/Connect` 4%, `screens/Admin` 1%,
  `screens/PersonalityJourney` 3%, `screens/Observations` 2%.
- **To do, alongside this plan**: `collectCoverageFrom` in `jest.config.js`, a
  `test:coverage` script, and a floor that only goes up (as `frontend/e2e/coverage-floor.mjs`
  does), starting at 45%, run by `check.yml` and `check.sh`. Raising it means Testing Library
  tests for the screens above; 80% or more is reasonable.

The native code (`MainActivity.kt`, `MainApplication.kt`, `AppDelegate.swift`) is the
template's start-up code. Native coverage (JaCoCo, Xcode) only becomes worth it if the app adds
native modules of its own.

---

## 11. Pitfalls to expect

None found yet; these are the known ones for this setup. Move each to "found" with what fixed it.

| Pitfall | Why | What to do |
|---|---|---|
| The Android app can't reach `localhost` | The emulator's `localhost` is itself | `src/lib/env.ts` maps it to `10.0.2.2`; give the stand-in that address too where it builds URLs |
| Plain HTTP refused | Android blocks cleartext and iOS's App Transport Security blocks HTTP, outside local addresses | Debug builds allow local addresses; check the Release test build does too, for local addresses only |
| A system prompt stops a flow | Microphone, photos, notifications | Set permissions in `launchApp` (`start.yaml`) |
| The keyboard covers the button | Text fields near the bottom | `hideKeyboard` before the tap |
| A tap lands mid-animation | Stack transitions, the warp, the circles' entrances | `waitForAnimationToEnd`, then wait for the next screen's content |
| The first launch is slow | Metro bundles the JS on a debug build's first run | Warm it once before the run, or use the bundled Release build |
| Text differs between platforms | Fonts, wrapping, the system's own buttons | Match on accessibility labels or `testID`, or a regular expression, not exact layout |
| Two devices, one stand-in | Each run resets the stand-in | One platform at a time, or one port per platform |
| A flow starts signed in | iOS keeps the Keychain across `clearState`, and the tokens are there | `clearKeychain` in `start.yaml` on iOS |
| An old `API_URL` in the iOS build | Xcode reuses the pods' generated config | Clean the build after changing `ENVFILE`; check the URL in phase 0 |
| The real `.env` used by mistake | `react-native-config` reads `.env` by default | Always build with `ENVFILE=.env.e2e`; `scripts/maestro.sh` does it |

---

## 12. CI and `check.sh`

| Where | What runs | Note |
|---|---|---|
| `check.yml`, Android | The full suite on an Android emulator on a Linux runner (hardware acceleration on), with the Release test build | ~20–30 min with the build; a separate job, so the web and backend jobs don't wait |
| `check.yml`, iOS | Needs a macOS runner, about 10 times the cost per minute | To decide: the smoke set on every push, or the full suite nightly, or local only |
| `check.sh` | Off by default, like the `scripts/e2e` runs: `RUN_MAESTRO=1 ./check.sh` runs the smoke set on one booted device | Needs a simulator or emulator running |
| Results | `maestro test --format junit --output …`, screenshots of failures kept as artifacts | |

---

## 13. Keeping it up to date

- A new screen or journey adds its row to `frontend-app/.maestro/FLOWS.md` (and to the web's
  `frontend/e2e/FLOWS.md` if both apps have it), with a flow or the reason it has none.
- A change to an API's shape changes the shared builders in `frontend/e2e/data/` once, for both
  suites.
- This file's status table and section 11 change as phases land.
- Commands to run the flows go into a `frontend-app/TESTING.md`, as `frontend/TESTING.md` does for the web.
