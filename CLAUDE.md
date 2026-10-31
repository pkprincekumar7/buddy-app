# Superpower — Claude Code Instructions

## Working directory

Always make changes directly in this repository (`/Users/VKum985/Documents/Study/Extra/Application_Code/buddy-app`).
Do **not** use git worktree isolation (`isolation: "worktree"`) — edits must land here, not in a throwaway worktree.

## Project structure

- `frontend/` — React app (Vite, pages auto-routed via `src/pages.config.js`)
- `frontend-app/` — React Native app: a phone-width port of `frontend/` (same pages/colors; palette
  generated from `frontend/src/index.css` via `yarn theme:sync`). Conventions in
  `frontend-app/CLAUDE.md` — port web page changes there too.
- `backend/` — the FastAPI services (`auth`, `users`, `children`, `onboarding`, `discover`, `grow`,
  `transform`, `release`, `shared`; `python backend/tools/services.py` lists them), each with its own
  MongoDB database (PyMongo async) and, except `shared`, a worker; `backend/common/` is the package
  they share (`buddy-common`). Conventions in `backend/CLAUDE.md`
- `infra-live-backend/` — Terraform for AWS backend (ECS, ALB, ECR, ElastiCache)
- `infra-live-frontend/` — Terraform for S3 frontend hosting
- `infra-live-edge/` — Terraform for CloudFront + WAF + DNS

## Coding standards

- `backend/CLAUDE.md`, `frontend/CLAUDE.md` and `frontend-app/CLAUDE.md` hold this project's
  specific coding-standards checklists (FastAPI conventions; React/Tailwind conventions; React
  Native/NativeWind port conventions) — loaded automatically whenever work touches those
  directories, so new code follows them from the start.
- Run `/standards-review` to audit *existing* code against that same checklist on demand (e.g.
  after a batch of changes, or a periodic sweep) — see
  `.claude/skills/standards-review/SKILL.md`.

## Common commands

Backend (run from `backend/`, with the dev venv: `python3.13 -m venv .venv && .venv/bin/pip install
-r requirements-dev.txt -r requirements-test.txt`; `requirements-dev.txt` is the union of every
service's `<svc>/requirements.txt`, plus `requirements-lint.txt`/`requirements-security.txt`):

```
python -m common.serve <svc>                # a service (the containers' command): public app on 8000,
                                            #   internal app on 8001
python -m <svc>.worker                      # its worker (every service but shared)
ruff check .                                # lint (ruff format . to auto-format)
mypy tools/ common/ && mypy <svc>/          # type check
python tools/import_contracts.py            # import-linter: common never imports a service,
                                            #   services never import each other
pytest                                      # common/tests + tools/tests (CI: --cov=common --cov-branch
                                            #   --cov-fail-under=99)
pytest <svc>/tests --cov=<svc> --cov-branch --cov-fail-under=99   # one service's tests
MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" REDIS_URL=redis://localhost:6379 pytest
                                            # + real-Mongo/Valkey tests (CI always runs these;
                                            #   never point MONGODB_TEST_URI at a real cluster)
python tools/export-openapi.py --service <svc> > openapi/<svc>.json   # after changing a route
```

Locally the services run in Docker Compose, not from the venv. After a spec changes, run
`node scripts/sync-api-clients.mjs` (regenerates both apps' clients; CI runs it with `--check`).

Frontend (run from `frontend/`):

```
npm run dev         # Vite dev server
npm run build       # production build
npm run lint        # eslint (lint:fix to auto-fix)
npm run typecheck   # tsc --noEmit, app + node configs
```

Full stack: `docker compose up -d --build` from the repo root (no profile; Moto runs on the host first,
see `docs/getting-started.md`).

Country/region routing data: edit only `shared/routing.json`, then run
`node scripts/sync-routing.mjs` (regenerates `backend/common/regions_data.py`,
`backend/auth/countries_data.py` and the frontends' `countries.ts`/`locationHint.ts`; CI runs it with `--check`). See `shared/README.md`.

## Environment & ports

- Copy `.env.example` → `.env` (root, read by Docker Compose; the only env file) and fill in
  secrets — see the inline comments for JWT, `EMAIL_HMAC_PEPPER`, LLM-provider, Google and S3 setup.
  Tests don't read it: they use `MONGODB_TEST_URI`/`REDIS_URL`.
- Host ports: gateway (the API, `http://localhost:8088/api/v1/...`) `8088`, frontend (Vite dev
  server, or nginx behind the Compose `frontend` service) `5173`, MongoDB `27017`, Valkey `6379`,
  Moto `5050`. The services' own ports (8000 public, 8001 internal) stay inside the containers.
- `docker-compose.yml` (project `superpower`) starts `mongo` (single-node replica set), `valkey`,
  `local-keys` (one-shot: service-token keys and `JWT_PUBLIC_KEYS` from `JWT_PRIVATE_KEY`), each
  service and its worker, the `gateway` (nginx; `local/gateway/nginx.conf` is generated from
  `shared/service-routes.json` by `node scripts/sync-gateway.mjs`) and `frontend`. Moto (SNS, SQS,
  S3) runs from the venv: `backend/.venv/bin/moto_server -H 0.0.0.0 -p 5050`, then
  `backend/.venv/bin/python scripts/local-aws-setup.py`.
- Each service has its own database, named after it. Allow-list a local email with
  `docker compose exec auth python -m auth.seed` (reads `LOCAL_ALLOWED_EMAIL`).
- Without `REDIS_URL` (or while Valkey is down), rate limits are counted per task and the
  authorization check falls back to asking auth, with a local cache.
