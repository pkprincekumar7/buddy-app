# Child journey application

Stack: **React (Vite)**, **FastAPI**, **PostgreSQL**, optional **OpenAI** for analysis and plan generation. Run everything with **Docker Compose** or the backend/frontend dev servers.

## Quick start (Docker)

```bash
cp .env.example .env
# set JWT_SECRET and optionally OPENAI_API_KEY
docker compose up --build
```

- API: `http://localhost:8000` (e.g. `GET /health`)
- UI: `http://localhost:5173`
- OpenAPI: `http://localhost:8000/docs`

Migrations run automatically in the API container; seed data (onboarding and growth questions, media placeholders) runs on API startup on an empty database.

## Local development (without Docker for Node/Python)

- Start PostgreSQL and set `DATABASE_URL` to it (not `db` as host).
- Backend: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && set -a && source ../.env && set +a && alembic upgrade head && uvicorn app.main:app --reload`
- Frontend: `cd frontend && npm install && npm run dev`

## Product policies (v1)

- **Single child per user**: at most one `child_profiles` row and one `child_journeys` row per user (`UNIQUE(user_id)` on both).
- **Start Over**: one transaction (logical) that deletes the journey row (and dependent data by cascade or explicit delete), removes the child profile, and creates a new journey at `home` so a new name and flow can begin. Not the same as **Reset** in onboarding chat, which only clears onboarding answers for the current journey.
- **Back** and **resume**: the server is authoritative via `child_journeys.current_step_key` and `GET /journey/state`; the UI syncs the route to the server step.
- **OpenAI**: do not commit keys. Use `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` from the environment. Without a key, AI runs are stored as failed; configure a key to enable generations.

## API overview

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` (Bearer access token for protected routes).
- `GET /journey/state`, `POST /journey/start`, `POST /journey/start-over`, `POST /journey/advance`, `POST /journey/back`, onboarding and growth `PUT`/`POST` routes as in `IMPLEMENTATION_PLAN.md` Part E.
- `GET /flows/onboarding/questions`, `GET /flows/growth/{module_key}/questions`, `GET /flows/growth/{module_key}/media`.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Requires `JWT_SECRET` and a valid `DATABASE_URL` if any test touches the DB (current tests are limited to import/step-graph checks).

## Observability

- `GET /health` checks database connectivity. Structured app logs can be added per deployment.
