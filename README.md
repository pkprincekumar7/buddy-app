# Child journey application

Stack: **React (Vite)**, **FastAPI**, **PostgreSQL**, optional **OpenAI** for analysis and plan generation. Run everything with **Docker Compose** or the backend/frontend dev servers.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit `.env`: set JWT_SECRET, optionally OPENAI_API_KEY, and Google IDs if you use Sign in with Google (see below).
docker compose up --build
```

After changing `VITE_GOOGLE_CLIENT_ID`, rebuild the frontend image so Vite embeds it (`docker compose build frontend` or `docker compose up --build`).

All supported variables are documented in `.env.example` (JWT lifetimes, CORS, Postgres, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, optional `VITE_API_URL`).

- API: `http://localhost:8000` (e.g. `GET /health`)
- UI: `http://localhost:5173`
- OpenAPI: `http://localhost:8000/docs`

Migrations run automatically in the API container; seed data (onboarding and growth questions, media placeholders) runs on API startup on an empty database.

## Google Sign-In (optional)

Use the **same** OAuth 2.0 **Web client ID** for both `GOOGLE_CLIENT_ID` (backend verifies the ID token) and `VITE_GOOGLE_CLIENT_ID` (frontend loads the Google button). The value looks like `123456789-xxxx.apps.googleusercontent.com`.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a **project**.
2. Go to **APIs & Services → OAuth consent screen**. Configure the app (type, name, support email). In testing mode, add **Test users** for accounts that will sign in.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
4. Application type: **Web application**.
5. Under **Authorized JavaScript origins**, add the origins where your UI is served, for example:
   - `http://localhost:5173` and `http://127.0.0.1:5173` (default Docker Compose UI port)
   - your production origin when you deploy
6. Create the client and copy the **Client ID** (you do not need the client secret for the ID-token flow used here).
7. In `.env`, set:

   ```env
   GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
   VITE_GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
   ```

8. Rebuild the frontend so `VITE_GOOGLE_CLIENT_ID` is baked into the bundle (`docker compose up --build` or `docker compose build frontend`).

If these are left empty, email/password login still works; the login page hides Google until `VITE_GOOGLE_CLIENT_ID` is set at build time and the backend returns an error if Google is used without `GOOGLE_CLIENT_ID`.

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

- `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/refresh`, `GET /auth/me` (Bearer access token for protected routes).
- `GET /journey/state`, `POST /journey/start`, `POST /journey/start-over`, `POST /journey/advance`, `POST /journey/back`, onboarding and growth `PUT`/`POST` routes as in `IMPLEMENTATION_PLAN.md` Part E.
- `GET /flows/onboarding/questions`, `GET /flows/growth/{module_key}/questions`, `GET /flows/growth/{module_key}/media`.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Requires `JWT_SECRET` and a valid `DATABASE_URL` if any test touches the DB (current tests are limited to import/step-graph checks).

## Observability

- `GET /health` checks database connectivity. Structured app logs can be added per deployment.
