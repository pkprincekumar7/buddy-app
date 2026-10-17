# Superpower — Claude Code Instructions

## Working directory

Always make changes directly in this repository (`/Users/VKum985/Documents/Study/Extra/Application_Code/buddy-app`).
Do **not** use git worktree isolation (`isolation: "worktree"`) — edits must land here, not in a throwaway worktree.

## Project structure

- `frontend/` — React app (Vite, pages auto-routed via `src/pages.config.js`)
- `frontend-app/` — React Native app: a phone-width port of `frontend/` (same pages/colors; palette
  generated from `frontend/src/index.css` via `yarn theme:sync`). Conventions in
  `frontend-app/CLAUDE.md` — port web page changes there too.
- `backend/` — FastAPI app with MongoDB (Motor async driver) + Redis (rate limiting)
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

Backend (run from `backend/`, with `.venv` active — deps split across
`requirements.txt`/`requirements-lint.txt`/`requirements-test.txt`/`requirements-security.txt`/
`requirements-mutation.txt`):

```
uvicorn app.main:app --reload --port 8000   # dev server (matches Dockerfile's prod CMD, minus --reload)
python worker.py                            # background job worker
ruff check .                                # lint (ruff format . to auto-format)
mypy app                                    # type check
pytest                                      # tests (backend/tests/)
MONGODB_TEST_URI=mongodb://localhost:27017 REDIS_URL=redis://localhost:6379 pytest
                                            # + real-Mongo/Redis integration tests (CI always runs these;
                                            #   never point MONGODB_TEST_URI at a real cluster)
python tools/mutate_handlers.py --check     # validate the hand-built mutant lists (seconds)
```

Mutation testing (`mutmut run` + `python tools/mutate_handlers.py --all`) is **manual-only**:
it takes hours, so it's not in CI, and Claude Code must never start it — both refuse to run
when `CLAUDECODE` is set. Steps for running it yourself: `docs/mutation-testing.md`.

Frontend (run from `frontend/`):

```
npm run dev         # Vite dev server
npm run build       # production build
npm run lint        # eslint (lint:fix to auto-fix)
npm run typecheck   # tsc --noEmit, app + node configs
```

Full stack: `docker compose up` from the repo root (see `docker-compose.yml`).

Country/region routing data: edit only `shared/routing.json`, then run
`node scripts/sync-routing.mjs` (regenerates `backend/app/routing_data.py` and the frontends'
`countries.ts`/`locationHint.ts`; CI runs it with `--check`). See `shared/README.md`.

## Environment & ports

- Copy `.env.example` → `.env` (root, for Docker Compose) or `backend/.env.example` →
  `backend/.env` (backend-only local dev without Docker) and fill in secrets — see the inline
  comments in those files for MongoDB/JWT/LLM-provider/S3 setup.
- Default ports: backend `8000`, frontend (Vite dev server, or nginx behind the Compose
  `frontend` service) `5173`, Redis `6379`.
- `docker-compose.yml` starts `redis`, `backend`, `worker`, and `frontend` (nginx serving the
  built UI) — it does **not** include MongoDB; point `MONGODB_URI` at an Atlas cluster or a
  separately-run local Mongo (see `.env.example` for both options). Without `REDIS_URL` set, every
  rate limiter in the backend (the LLM quota, and the per-route `limiter`/`user_limiter` pair)
  falls back to in-process (single-instance) limiting automatically.
