# Getting Started

## Quick start (Docker)

The backend is a set of services, each with its own worker and its own MongoDB database (design: [auth-users-split.md](auth-users-split.md)). `docker compose up` runs all of them locally, behind a gateway that routes each `/api/*` path as the ALB does in AWS.

1. Make `.env` from the example (the root `.env.example` is the only env file):

   ```bash
   cp .env.example .env
   ```

   Set `JWT_PRIVATE_KEY` (see docs/jwt-keys.md), `EMAIL_HMAC_PEPPER` (`openssl rand -hex 32`), `LOCAL_ALLOWED_EMAIL` (the email you'll register with locally), at least one LLM key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`), and the Google IDs if you use Sign in with Google. Every variable is documented inline in `.env.example`.

2. Create the backend venv once (it runs Moto, the e2e scripts, the tests and the tools; the services themselves run in containers):

   ```bash
   cd backend && python3.13 -m venv .venv && \
     .venv/bin/pip install -r requirements-dev.txt -r requirements-test.txt
   ```

3. Start Moto (local SNS, SQS and S3) and create the topics, queues and buckets. Moto keeps them in memory, so repeat the setup after restarting it:

   ```bash
   backend/.venv/bin/moto_server -H 0.0.0.0 -p 5050
   ```

   ```bash
   backend/.venv/bin/python scripts/local-aws-setup.py
   ```

   Where Docker's policy allows the `motoserver/moto` image, `docker compose --profile moto up -d moto` runs the same server in a container instead (then run `local-aws-setup.py` as above).

4. Start the stack:

   ```bash
   docker compose up -d --build
   ```

   The first start builds one image per service from `backend/Dockerfile` (`--build-arg SERVICE=<service>`), which downloads their Python packages. Downloads go to a Docker build cache shared by every service's image, so each package is fetched once and later builds reuse it; `docker builder prune` empties it.

5. Allow-list your email, then register in the UI (or through `http://localhost:8088/api/v1/auth/register`):

   ```bash
   docker compose exec auth python -m auth.seed
   ```

   It reads `LOCAL_ALLOWED_EMAIL` from the running container and only works with `APP_ENV=local`.

What runs (compose project `superpower`):
- `mongo` (MongoDB 8.0, a single-node replica set: transactions and change streams need one) and `valkey` (rate limits, the authorization cache, leader locks);
- `local-keys`, a one-shot that makes each service's service-token key and the JWT public keys from your `JWT_PRIVATE_KEY`, into the `superpower_local_keys` volume (never the repository or `.env`). It keeps them across restarts; `docker volume rm superpower_local_keys` makes new ones;
- `auth`, `users`, `children`, `onboarding`, `discover`, `grow`, `transform`, `release` and `shared`, each with its worker (`<service>-worker`) except `shared`. Each runs `python -m common.serve <service>`: its public app on 8000 and its internal app on 8001, inside the container only. Internal calls go service to service on 8001, signed as in AWS;
- `gateway` (nginx, config `local/gateway/nginx.conf`, generated from `shared/service-routes.json`): any path no service claims gets the ALB's 404;
- `frontend` (the built web app, served by nginx), which sends `/api/*` to the gateway (`FRONTEND_API_UPSTREAM` changes it).

Ports on the host (each changeable in `.env`):

| What | URL |
|---|---|
| UI | `http://localhost:5173` |
| API (the gateway) | `http://localhost:8088/api/v1/...`; `GET /gateway/health` (the gateway) and `GET /api/health` (shared, through the gateway) |
| MongoDB | `mongodb://localhost:27017/?directConnection=true` |
| Valkey | `redis://localhost:6379` |
| Moto | `http://localhost:5050` |

Notes:
- After changing `VITE_GOOGLE_CLIENT_ID` or `VITE_API_URL`, rebuild the frontend image so Vite embeds them (`docker compose build frontend` or `docker compose up -d --build`).
- There are no schema migrations: each service creates its collections, `$jsonSchema` validators and indexes on startup.
- The services serve no `/docs` page; each HTTP service's spec is committed in `backend/openapi/<service>.json`.
- `shared` (no database) transcribes with `OPENAI_API_KEY` and links the APK from `ASSETS_BUCKET_NAME` in Moto; without them those routes answer `503`.
- `discover-worker`, `grow-worker`, `transform-worker` and `release-worker` generate with the LLM keys in `.env`; without one, each job fails at once with a clear error (the personality shows `failed`; a growth area keeps what it had).
- Changing `EMAIL_HMAC_PEPPER` makes every local email key unmatchable: seed and register again (or start from an empty `auth` database).
- `backend/.venv/bin/python scripts/check-local-stack.py` checks that Mongo, Valkey and Moto do what the services rely on.

### End-to-end runs

They run against the stack through the gateway, use the LLM keys in `.env` (so a few provider calls each), and allow-list a new test email themselves. Either the journey, one child from profile to Connect:

```bash
backend/.venv/bin/python scripts/e2e/journey.py
```

or every endpoint (the journey plus login, refresh, logout-all, the profile, every kind of generation, speech-to-text, the APK link, and the admin's reads, lock, unlock and role change; about ten generations):

```bash
backend/.venv/bin/python scripts/e2e/full-journey.py
```

or the journey, then deleting the account and checking nothing of it is left in any service's database, Valkey or the uploads bucket:

```bash
backend/.venv/bin/python scripts/e2e/account-deletion.py
```

or the failure and convergence scenarios (workers killed mid-deletion, a late event and a finishing job, a child's 30-day purge); they stop and start the stack's workers:

```bash
backend/.venv/bin/python scripts/e2e/convergence.py
```

`RUN_E2E=1 ./check.sh` runs the last three after the other checks (about 7–10 minutes, some 20 LLM calls).

### The apps against the stack

- the web dev server (`npm run dev` in `frontend/`) proxies `/api` to the gateway on `localhost:8088` (set `API_PROXY_TARGET` to change it);
- the Docker `frontend` container on port 5173 sends `/api` to the gateway too;
- the mobile app's `API_URL` in `frontend-app/.env` should be `http://localhost:8088` (see `frontend-app/.env.example`).

The apps call the API on their own origin through these proxies; the services send no CORS headers (in AWS, CloudFront's response headers policy is the only CORS source).

### The apps' clients for the services

Both apps call the services through typed clients (`src/api/services.ts`), generated from the services' specs in `backend/openapi/`. After a service's spec changes (`python backend/tools/export-openapi.py --service <service> > backend/openapi/<service>.json`), regenerate them; `check.sh` and CI fail while they're stale:

```bash
node scripts/sync-api-clients.mjs
```

It needs `frontend/node_modules` (`npm ci` in `frontend/`), and writes `src/api/generated/<service>.ts` in both apps. Errors come back as `ApiError`, with the service's `detail.code` as `err.code`.

## Local development (without Docker)

Requires **Python 3.13** and **Node.js 22** (versions used by the Docker images).

The services run in Docker only: the backend venv (Quick start, step 2) is for the tests, the tools, Moto and the e2e scripts, not for serving the API. See [tests.md](tests.md) for running the tests; they use `MONGODB_TEST_URI` and `REDIS_URL` (the compose `mongo` and `valkey`), never `MONGODB_URI`.

- Frontend dev server, against the compose stack's gateway:
  ```bash
  cd frontend
  cp .env.example .env   # set ASSETS_BUCKET_NAME to your local assets bucket to load app assets (avatars, splash videos, etc.) via Vite proxy
  npm install && npm run dev
  ```

## Connecting to MongoDB

Each service has its own database, named after it: `auth`, `users`, `children`, `onboarding`, `discover`, `grow`, `transform`, `release` (`shared` has none). Locally they're all on the compose `mongo` service; compose sets each service's `MONGODB_URI` and `MONGODB_DB_NAME`.

**Connect with mongosh** (GUI tools such as MongoDB Compass work too, with the same URI):

```bash
mongosh "mongodb://localhost:27017/?directConnection=true"
```

**Collections**, by database (plus `outbox` and `tombstones` in each service that publishes events):

| Database | Collections |
|---|---|
| `auth` | `auth` (accounts: email, role, lock, provider), `sessions`, `email_index`, `allowed_emails`, `deletions`, `audit`, `admin_count`, `worker_state` |
| `users` | `users` (profiles) |
| `children` | `children`, `pending_uploads` |
| `onboarding` | `conversations`, `child_access` |
| `discover` | `personalities`, `jobs`, `child_access`, copied inputs |
| `grow` | `growth_areas`, `jobs`, `child_access`, copied inputs |
| `transform` | `plans`, `jobs`, `pending_uploads`, `child_access`, copied inputs |
| `release` | `observations`, `jobs`, `child_access`, copied inputs |

Documents carry `location`; the zone-sharding key is `{location: 1, _id: 1}` (`python backend/tools/atlas_zone_ranges.py [service ...]` prints the mongosh zone commands per service database). auth's `email_index`, `allowed_emails`, `deletions`, `admin_count` and `worker_state` stay unsharded. Emails are stored only in `auth.auth`; `email_index` and `allowed_emails` hold HMAC keys (with `EMAIL_HMAC_PEPPER`), never an address, so find an allow-list entry or an account through the admin screens rather than by email in mongosh.

**Useful queries (mongosh):**

```js
use children
// A parent's children (filter by location and user_id, as the service does)
db.children.find({ location: "<location>", user_id: "<user_id>" })

use discover
// Pending or failed generation jobs
db.jobs.find({ status: { $in: ["pending", "failed"] } })
```

## Admin setup

Registration is gated by an allow-list: only an allow-listed email can create an account.

- **Locally:** `docker compose exec auth python -m auth.seed` adds `LOCAL_ALLOWED_EMAIL` (Quick start, step 5).
- **The first admin of an environment:** sign up as a parent, then run `python -m auth.promote_admin --user-id <id>` in the auth image with auth's own configuration. Locally: `echo you@example.com | docker compose exec -T auth python -m auth.promote_admin --email-stdin`. In AWS, the first email goes on the allow-list by hand and the promotion runs as a one-off ECS task on the auth image: step by step in [infra-operations.md](infra-operations.md#first-admin-of-an-environment). It works once per environment (it refuses if an admin exists), and it's audited. Sign in again afterwards: the promotion ends the account's sessions, and the next sign-in carries the admin role.
- **Later admins and allow-list entries** are managed from the admin screens.

### What admin accounts can do

An admin can't create or change children (`403 parents_only`); both apps send an admin to the admin panel (`AdminAllowedEmails.tsx` on web, `frontend-app/src/screens/Admin.tsx` on mobile). It has two tabs, backed by auth's admin routes (`/api/v1/auth/allowed-emails*`, `/api/v1/auth/accounts*`):

- **Allowed Emails** — add, search, and remove emails from the registration allow-list, with pagination.
- **Users** — list and search accounts, **lock**/**unlock** them, and change their role. Locking an account revokes its tokens and sessions and blocks sign-in until an admin unlocks it; an admin can't lock their own account, nor the last active admin.

---

## Google Sign-In (optional)

Use the **same** OAuth 2.0 **Web client ID** for both `GOOGLE_CLIENT_ID` (auth verifies the ID token) and `VITE_GOOGLE_CLIENT_ID` (frontend loads the Google button). The value looks like `123456789-xxxx.apps.googleusercontent.com`.

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

8. Rebuild the frontend so `VITE_GOOGLE_CLIENT_ID` is baked into the bundle (`docker compose up -d --build` or `docker compose build frontend`).

If these are left empty, email/password login still works; the login page hides Google until `VITE_GOOGLE_CLIENT_ID` is set at build time, and auth answers `503 google_unavailable` if Google is used without `GOOGLE_CLIENT_ID`.
