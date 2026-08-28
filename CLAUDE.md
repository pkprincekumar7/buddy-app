# buddy-app — Claude Code Instructions

## Working directory

Always make changes directly in this repository (`/Users/VKum985/Documents/Study/Extra/Application_Code/buddy-app`).
Do **not** use git worktree isolation (`isolation: "worktree"`) — edits must land here, not in a throwaway worktree.

## Project structure

- `frontend/` — React app (Vite, pages auto-routed via `src/pages.config.js`)
- `backend/` — FastAPI app with MongoDB (Motor async driver) + Redis (rate limiting)
- `infra-live-backend/` — Terraform for AWS backend (ECS, ALB, ECR, ElastiCache)
- `infra-live-frontend/` — Terraform for S3 frontend hosting
- `infra-live-edge/` — Terraform for CloudFront + WAF + DNS

## Coding standards

- `backend/CLAUDE.md` and `frontend/CLAUDE.md` hold this project's specific coding-standards
  checklists (FastAPI conventions; React/Tailwind conventions) — loaded automatically whenever
  work touches those directories, so new code follows them from the start.
- Run `/standards-review` to audit *existing* code against that same checklist on demand (e.g.
  after a batch of changes, or a periodic sweep) — see
  `.claude/skills/standards-review/SKILL.md`.

## Common commands

Backend (run from `backend/`, with `.venv` active — deps split across
`requirements.txt`/`requirements-lint.txt`/`requirements-test.txt`/`requirements-security.txt`):

```
uvicorn app.main:app --reload --port 8000   # dev server (matches Dockerfile's prod CMD, minus --reload)
python worker.py                            # background job worker
ruff check .                                # lint (ruff format . to auto-format)
mypy app                                    # type check
pytest                                      # tests — pytest/pytest-asyncio/httpx installed, no test files exist yet
```

Frontend (run from `frontend/`):

```
npm run dev         # Vite dev server
npm run build       # production build
npm run lint        # eslint (lint:fix to auto-fix)
npm run typecheck   # tsc --noEmit, app + node configs
```

Full stack: `docker compose up` from the repo root (see `docker-compose.yml`).

## Environment & ports

- Copy `.env.example` → `.env` (root, for Docker Compose) or `backend/.env.example` →
  `backend/.env` (backend-only local dev without Docker) and fill in secrets — see the inline
  comments in those files for MongoDB/JWT/LLM-provider/S3 setup.
- Default ports: backend `8000`, frontend (Vite dev server, or nginx behind the Compose
  `frontend` service) `5173`, Redis `6379`.
- `docker-compose.yml` starts `redis`, `backend`, `worker`, and `frontend` (nginx serving the
  built UI) — it does **not** include MongoDB; point `MONGODB_URI` at an Atlas cluster or a
  separately-run local Mongo (see `.env.example` for both options). Without `REDIS_URL` set, the
  LLM rate limiter falls back to in-process (single-instance) limiting automatically.
