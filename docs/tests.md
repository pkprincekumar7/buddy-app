# Tests

## Running tests

Install test dependencies (once, after creating the venv):

```bash
cd backend && pip install -r requirements.txt -r requirements-test.txt
```

Run the suite:

```bash
cd backend && . .venv/bin/activate && \
  MONGODB_URI=mongodb://localhost:27017 JWT_SECRET=<secret> REDIS_URL=redis://localhost:6379 APP_ENV=dev \
  pytest --cov=app --cov-report=term-missing --cov-fail-under=0 -q
```

Requires a running MongoDB instance (port 27017) and Redis instance (port 6379). There is no `backend/tests/` directory yet — pytest exits with code 5 ("no tests collected"), which is treated as a pass in CI until a baseline suite is written.

## Coverage

Coverage is reported on every run but not yet gated. Raise `--cov-fail-under` in the `pytest` command in [`check.yml`](../.github/workflows/check.yml) (and locally) incrementally as the test suite grows. There is no `pytest.ini` — all settings are passed on the command line.

## CI

Tests run in the `backend-test` job in [`check.yml`](../.github/workflows/check.yml) after `backend-lint` passes. The job spins up real MongoDB 7 and Redis 7 containers as services — no mocking. Exit code 5 (no tests collected) is explicitly caught and treated as a pass.
