# Tests

There are three separate test suites in this repo — backend (pytest), the Lambda@Edge
functions (Node's built-in test runner), and the mobile app (Jest). The web frontend
(`frontend/`) has none at all. All three run in CI and in `check.sh`.

## Backend (pytest)

The backend is `common` (the shared package) plus one package per service (auth, users,
children, onboarding, discover, grow, transform, release, shared; `python
backend/tools/services.py` lists them). `common`'s and the tools' tests run together; each
service's tests run on their own, with their own coverage gate.

Install the dev venv (once): `requirements-dev.txt` is the union of every service's pins
(`tools/tests/test_dev_requirements.py` keeps it exact):

```bash
cd backend && python3.13 -m venv .venv && \
  .venv/bin/pip install -r requirements-dev.txt -r requirements-test.txt
```

Run `common`'s and the tools' tests, then one service's:

```bash
cd backend && .venv/bin/pytest common/tests tools/tests --cov=common --cov-branch --cov-report=term-missing --cov-fail-under=99 -q
cd backend && .venv/bin/pytest children/tests --cov=children --cov-branch --cov-report=term-missing --cov-fail-under=99 -q
```

To install one service alone, the way its image does (`buddy-common` from a wheel built from
this tree, then its own `requirements.txt`), use a fresh venv and run
`bash scripts/install-backend-service.sh <service> backend/requirements-test.txt`.

### Live tests (MongoDB, Valkey)

Tests marked `live_service` need a real MongoDB replica set and Valkey. They run against
`MONGODB_TEST_URI` (never `MONGODB_URI`) and `REDIS_URL`, and skip without them. Point them at
the compose services — never a real cluster; each test uses throwaway databases:

```bash
docker compose up -d mongo valkey
cd backend && MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" \
  REDIS_URL=redis://localhost:6379 .venv/bin/pytest common/tests tools/tests -q
```

`REQUIRE_LIVE_SERVICES=1` turns a skipped `live_service` test into a failure, so a run can't
pass without exercising the real servers.

### Coverage

Gated at 99% line + branch coverage: `common` in the `common/tests tools/tests` run, and each
service in its own run. The pytest settings (test paths, `pythonpath`, the `live_service`
marker, warning filters) are in `backend/pyproject.toml`.

### CI

In [`check.yml`](../.github/workflows/check.yml), after `backend-lint` passes:
- `backend-test` runs `common`'s and the tools' tests with the dev venv;
- `backend-service` is a matrix with one job per service (found by `tools/services.py
  --json`): it installs the service alone with `scripts/install-backend-service.sh`, then runs
  mypy, its tests with the 99% gate, and checks `backend/openapi/<service>.json` is up to date;
- `backend-services` is the one stable check name over the matrix.

Each job starts real MongoDB 8.0 (a single-node replica set, started by
`scripts/ci-start-mongo.sh` because service containers can't pass `--replSet`) and Valkey 8.0
— no mocking. Locally, `docker compose up -d mongo valkey` gives the same, and Moto for SNS,
SQS and S3 runs from the venv (docs/getting-started.md); `scripts/check-local-stack.py` checks
all three.

### End to end (the local stack)

`scripts/e2e/full-journey.py`, `account-deletion.py` and `convergence.py` run against the
running compose stack through the gateway (`journey.py` is the journey they share, and runs
on its own too). They make real LLM calls with the keys in `.env`. `RUN_E2E=1 ./check.sh`
runs the three after the other checks; see [getting-started.md](getting-started.md).

---

## Lambda@Edge JWT validator (Node test runner)

A suite in
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

[`spa-rewrite.test.js`](../infra-live-edge/functions/spa-rewrite.test.js) covers the
CloudFront Function's SPA fallback (plain Node, no Terraform):

```bash
node --test infra-live-edge/functions/spa-rewrite.test.js
```

### CI

Runs in the `lambda-edge-test` job ("Lambda@Edge Unit Tests") in
[`check.yml`](../.github/workflows/check.yml) — sets up Node 22 and Terraform, then runs the
commands above. This job has no `needs:` dependency on the lint jobs, so it runs in parallel
with them.

---

## Mobile app (`frontend-app`) — Jest

15 test files under `frontend-app/__tests__/` (`App.test.tsx`) and `frontend-app/src/__tests__/`,
run with Jest 29 + `react-test-renderer` (`jest.config.js` maps `.css` imports to a stub, so
components that pull in NativeWind's `global.css` load):

```bash
cd frontend-app && yarn test
```

### CI

Runs as `yarn test --ci` in the `frontend-app-lint` job ("Frontend App Lint") in
[`check.yml`](../.github/workflows/check.yml), and in `check.sh`.

---

## Web frontend (`frontend/`) — no test infrastructure

No test runner (no vitest/jest/Playwright), no `test` script in `package.json`, and no
`*.test.tsx`/`*.spec.tsx` files anywhere in `frontend/src`. There is nothing to run here.
See `frontend/CLAUDE.md`'s "Testing" section — flag missing coverage on new critical-path
code (auth, forms that write user data, payment/limit flows) as a real finding rather than
assuming it exists.
