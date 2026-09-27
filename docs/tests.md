# Tests

There are three separate test suites in this repo — backend (pytest), the Lambda@Edge
JWT validator (Node's built-in test runner), and the mobile app (Jest). The web frontend
(`frontend/`) has none at all. Only two of the three existing suites actually run in CI.

## Backend (pytest)

Install test dependencies (once, after creating the venv):

```bash
cd backend && pip install -r requirements.txt -r requirements-test.txt
```

Run the suite:

```bash
cd backend && . .venv/bin/activate && \
  MONGODB_URI=mongodb://localhost:27017 JWT_PRIVATE_KEY=<RSA private key PEM> REDIS_URL=redis://localhost:6379 APP_ENV=dev \
  pytest --cov=app --cov-report=term-missing --cov-fail-under=0 -q
```

Requires a running MongoDB instance (port 27017) and Redis instance (port 6379). There is no `backend/tests/` directory yet — pytest exits with code 5 ("no tests collected"), which is treated as a pass in CI until a baseline suite is written.

### Coverage

Coverage is reported on every run but not yet gated. Raise `--cov-fail-under` in the `pytest` command in [`check.yml`](../.github/workflows/check.yml) (and locally) incrementally as the test suite grows. There is no `pytest.ini` — all settings are passed on the command line.

### CI

Tests run in the `backend-test` job in [`check.yml`](../.github/workflows/check.yml) after `backend-lint` passes. The job spins up real MongoDB 7 and Redis 7 containers as services — no mocking. Exit code 5 (no tests collected) is explicitly caught and treated as a pass.

---

## Lambda@Edge JWT validator (Node test runner)

A real, currently-passing suite of 14 test cases in
[`infra-live-edge/functions/jwt-validator-lambda.test.js`](../infra-live-edge/functions/jwt-validator-lambda.test.js),
covering the RS256 JWT validation and location-based backend-region routing logic — bypass
paths, session-hint routing for refresh/logout/register, expired/forged tokens, the mobile
`Authorization: Bearer` path, and the 503 fail-closed case for an unmapped/undeployed
location. It renders the actual `.tpl` template through a real `terraform apply` (not a
hand-rolled reimplementation of HCL's `templatefile()` syntax), so it exercises exactly
what gets deployed, not an approximation of it.

Run locally (needs `terraform` on `PATH` and Node 22+):

```bash
node --test infra-live-edge/functions/jwt-validator-lambda.test.js
```

### CI

Runs in the `lambda-edge-test` job ("Lambda@Edge Unit Tests") in
[`check.yml`](../.github/workflows/check.yml) — sets up Node 22 and Terraform, then runs the
command above. This job has no `needs:` dependency on the lint jobs, so it runs in parallel
with them.

---

## Mobile app (`frontend-app`) — Jest

7 test files exist under `frontend-app/__tests__/` and `frontend-app/src/__tests__/`
(`App.test.tsx`, `onboardingHelpers.test.ts`, `notifications.test.ts`,
`insightsUtils.test.ts`, `personalityLogic.test.ts`, `Button.test.tsx`, `Input.test.tsx`),
run via `yarn test` (Jest 29 + `react-test-renderer` as dev dependencies):

```bash
cd frontend-app && yarn test
```

> **Currently broken, not just unrun in CI — verified by actually running it.** 3 of the 7
> suites fail before a single test in them executes: `Button.test.tsx`, `Input.test.tsx`,
> and `App.test.tsx` all transitively import `global.css` (App.tsx's NativeWind/Tailwind
> entry point), and `jest.config.js` has no CSS handling at all — no `moduleNameMapper`
> entry for `.css`, so Jest's JS transformer chokes on the raw `@tailwind base;` syntax
> with "Jest encountered an unexpected token". The 4 remaining suites (the `lib/` ones —
> pure logic, no component imports) genuinely pass: **45/45 individual assertions green**.
> Net result: `yarn test` exits 1 (`Test Suites: 3 failed, 4 passed, 7 total`), and on top
> of that this suite doesn't run in CI at all — checked every workflow; `check.yml`'s only
> reference to `jest` is a comment explaining why it's excluded from a dependency
> vulnerability scan. Treat both as real, flaggable gaps: a broken suite with no CI signal
> is worse than an empty one, since it looks like coverage exists until someone actually
> runs it.

---

## Web frontend (`frontend/`) — no test infrastructure

No test runner (no vitest/jest/Playwright), no `test` script in `package.json`, and no
`*.test.tsx`/`*.spec.tsx` files anywhere in `frontend/src`. There is nothing to run here.
See `frontend/CLAUDE.md`'s "Testing" section — flag missing coverage on new critical-path
code (auth, forms that write user data, payment/limit flows) as a real finding rather than
assuming it exists.
