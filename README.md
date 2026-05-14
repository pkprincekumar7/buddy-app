# Buddy360

A child development app for parents. Stack: **React 18 (Vite)**, **FastAPI**, **MongoDB** (Motor async driver), optional LLM providers (**OpenAI**, **Anthropic**, **Gemini**) and **OpenAI Whisper** for audio transcription. Run everything with **Docker Compose** or the backend/frontend dev servers.

Frontend UI library: **Tailwind CSS** + **shadcn/ui** (Radix UI primitives), **React Query**, **Framer Motion**, **React Router v6**, **Recharts**, **Stripe** (payments), **Three.js** (3D), **React Leaflet** (maps), **React Quill** (rich text), **jsPDF** + **html2canvas** (PDF export), **@hello-pangea/dnd** (drag and drop), **next-themes**, **Sonner** (notifications).

## Quick start (Docker)

```bash
cp .env.example .env
# Edit `.env`: set JWT_SECRET, at least one LLM key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY),
# and Google IDs if you use Sign in with Google.

docker compose up --build
```

This starts three services: Redis, the FastAPI backend, and the Nginx-served frontend. MongoDB is **not** bundled — set `MONGODB_URI` in `.env` to a local MongoDB instance or an Atlas connection string before starting.

After changing `VITE_GOOGLE_CLIENT_ID` or `VITE_API_URL`, rebuild the frontend image so Vite embeds them (`docker compose build frontend` or `docker compose up --build`).

All supported variables are documented in `.env.example` (JWT lifetimes, CORS, MongoDB, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_API_URL`, `APP_ENV`, cookie settings).

- API: `http://localhost:8000` (e.g. `GET /health`)
- UI: `http://localhost:5173`
- OpenAPI: `http://localhost:8000/docs`

There are no schema migrations — MongoDB collections and indexes are created automatically by the backend on startup.

## Connecting to MongoDB

MongoDB is external — the app connects via `MONGODB_URI`. Default database name: `buddy_app` (override with `MONGODB_DB_NAME`).

**Local dev:** start a local mongod and set `MONGODB_URI=mongodb://localhost:27017` in `.env`.

**Atlas:** set `MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority`.

**Connect with mongosh:**

```bash
mongosh "$MONGODB_URI" --eval "use buddy_app"
```

GUI tools (MongoDB Compass, Studio 3T) work too — paste the URI directly.

**Collections:**

| Collection | Contents |
|---|---|
| `users` | User accounts (`_id`, `email`, `full_name`, `role`, `location`) |
| `sessions` | Refresh token sessions (`user_id`, `expires_at`, `location`) |
| `email_index` | Global email → user_id lookup (unsharded uniqueness guard) |
| `onboarding` | Onboarding state per user |
| `goals` | Parent concern and AI-generated goals plan |
| `recommendations` | Journey recommendations and progress |
| `growth_areas` | Completed growth areas with activity results |
| `children` | Children profiles |
| `missions` | Growth missions per child |

**Useful queries (mongosh):**

```js
use buddy_app

// All registered users
db.users.find({}, { email: 1, full_name: 1, role: 1, location: 1 }).sort({ _id: -1 })

// Onboarding state for a specific user
db.onboarding.findOne({ _id: "<user_id>" })

// Active sessions (not yet expired)
db.sessions.find({ expires_at: { $gt: new Date() } }, { user_id: 1, expires_at: 1 })

// Children for a specific user
db.children.find({ user_id: "<user_id>" }).sort({ created_at: -1 })

// Growth missions for a specific child
db.missions.find({ child_id: "<child_id>" }).sort({ created_at: -1 })

// Completed growth areas for a user
db.growth_areas.find({ user_id: "<user_id>" }).sort({ created_at: -1 })
```

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

Requires **Python 3.12** and **Node.js 22** (versions used by the Docker images).

- Start a local MongoDB instance (or use Atlas) and set `MONGODB_URI` in `backend/.env` — see `backend/.env.example`.
- Backend:
  ```bash
  cd backend
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET
  uvicorn app.main:app --reload
  ```
- Frontend: `cd frontend && npm install && npm run dev`

## API overview

All routes are prefixed `/api/v1`. Auth endpoints use rate limiting (slowapi).

**Auth** (`/api/v1/auth/...`)
- `POST /auth/register` — create account, returns token pair (rate-limited: 5/min)
- `POST /auth/login` — email/password login, returns token pair (rate-limited: 10/min)
- `POST /auth/google` — Google ID-token login/register, returns token pair (rate-limited: 10/min)
- `POST /auth/refresh` — exchange an expired access token + valid refresh token for a new pair
- `POST /auth/logout` — revoke the current session (deletes the refresh token)
- `GET /auth/me` — return current user (`id`, `email`, `full_name`, `role`)
- `DELETE /user/me` *(path: `/api/v1/user/me`)* — permanently delete the authenticated user's account

Protected routes read the `access_token` from an HTTP-only cookie set at login. There is no `Authorization` header — auth is cookie-based throughout.

**User state** (`/api/v1/user/...`)
- `GET/PATCH /user/preferences` — TTS and other user preferences
- `GET/PATCH /user/onboarding` — onboarding phase, child data, personality analysis, journey recommendations
- `GET/PATCH /user/recommendations-progress` — track progress through recommendations
- `GET/POST/DELETE /user/completed-growth-areas` — log completed growth areas with child activity results
- `GET/PATCH /user/goals` — parent concern and AI-generated goals plan

**Children** (`/api/v1/children/...`)
- `GET /children` — list children (supports `sort`, `limit`)
- `POST /children` — create a child profile
- `PATCH /children/{child_id}` — update a child profile
- `DELETE /children/{child_id}` — delete a child profile

**Growth missions** (`/api/v1/growth-missions/...`)
- `GET /growth-missions?child_id=&sort=&limit=` — list missions for a child (`sort`: `created_date` / `-created_date`, default `-created_date`; `limit`: 1–200, default 50)
- `POST /growth-missions/bulk` — create multiple missions in one request

**LLM** (`/api/v1/llm/...`)
- `POST /llm/invoke` — send a prompt to an LLM; optionally pass `response_json_schema` for structured JSON output and `provider` (`"openai"` | `"anthropic"` | `"gemini"`) to pin a specific model. Without `provider`, the server auto-selects the first configured key in priority order: OpenAI → Anthropic → Gemini. Returns 503 if no provider is configured.
- `GET /llm/providers` — returns which providers have a key configured and which would be auto-selected.

**Audio** (`/api/v1/audio/...`)
- `POST /audio/transcribe` — transcribe an uploaded audio file via OpenAI Whisper. Requires `OPENAI_API_KEY`.

**Health**
- `GET /health` — returns `{"status": "ok"}` (no auth)
- `GET /api/health` — same as above; use this when accessing via the frontend proxy (e.g. `https://your-domain.com/api/health`)

## Frontend pages

| Route | Page | Notes |
|---|---|---|
| `/Login` | Login (email/password + Google) | Public, hardcoded in `App.jsx` |
| `/Register` | Register | Public, hardcoded in `App.jsx` |
| `/` | Redirects to `mainPage` | `mainPage` is set in `pages.config.js`, currently `Onboarding` |
| `/Onboarding` | Conversational onboarding + personality analysis | Protected |
| `/Home` | Home | Protected |
| `/GoalsDashboard` | Goals dashboard | Protected |
| `/LifePathway` | Life pathway / recommendations | Protected |

Protected routes redirect to `/Login` when unauthenticated. Pages other than Login and Register are auto-registered from `pages.config.js`.

## GitHub Actions

Six workflows live under [`.github/workflows/`](.github/workflows/). All authenticate to AWS via **OIDC** — no long-lived access keys are stored anywhere in GitHub.

| Workflow | Trigger | Purpose |
|---|---|---|
| `terraform-live-all.yml` | Manual | Full-stack orchestrator — provisions or tears down all infra, then optionally deploys |
| `terraform-live-backend.yml` | Manual / called | VPC, ECS, ALB, Redis, ECR, Secrets Manager |
| `terraform-live-frontend.yml` | Manual / called | S3 bucket for frontend assets |
| `terraform-live-edge.yml` | Manual / called | CloudFront distribution + ACM cert (always `us-east-1`) |
| `deploy-live-backend.yml` | Manual / called | Builds Docker image, pushes to ECR, updates ECS service |
| `deploy-live-frontend.yml` | Manual / called | Builds frontend, uploads to S3, invalidates CloudFront |

### One-time AWS setup: GitHub OIDC identity provider

Done once per AWS account.

**Step 1 — Add GitHub as an OIDC provider in IAM**

In the [AWS IAM console](https://console.aws.amazon.com/iam/) go to **Identity providers → Add provider**:

| Field | Value |
|---|---|
| Provider type | OpenID Connect |
| Provider URL | `https://token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |

Click **Get thumbprint**, then **Add provider**.

**Step 2 — Create the IAM role**

Go to **IAM → Roles → Create role**:

1. Trusted entity type: **Web identity**
2. Identity provider: `token.actions.githubusercontent.com`
3. Audience: `sts.amazonaws.com`
4. Scope to your repository:
   - Condition key: `token.actions.githubusercontent.com:sub`
   - Operator: `StringLike`
   - Value: `repo:YOUR_GITHUB_ORG/buddy-app:*` (or `repo:...:environment:dev` per env)
5. Attach the `AdministratorAccess` managed policy (or a scoped policy covering ECS, ECR, ELB, VPC, CloudFront, S3, Route 53, ACM, Secrets Manager, SSM, IAM).
6. Name the role and copy the **Role ARN** — this becomes the `ROLE_ARN` secret.

### Required GitHub secrets

Configure under **Settings → Environments → `<env>` → Secrets** (one set per environment: `dev`, `stg`, `prod`).

**Infrastructure secrets** (Terraform + deploy workflows):

| Secret | Value |
|---|---|
| `ROLE_ARN` | ARN of the IAM OIDC role |
| `APP_NAME` | App identifier used as SSM parameter prefix, e.g. `buddy360` |
| `STATE_BUCKET` | S3 bucket name for Terraform remote state |
| `DOMAIN_NAME` | Root domain, e.g. `example.com` |
| `SUBDOMAIN` | Frontend subdomain prefix, e.g. `app` |
| `SUBDOMAIN_INTERNAL` | Backend/internal subdomain prefix, e.g. `api` |
| `HOSTED_ZONE_ID` | Route 53 hosted zone ID |
| `ACM_CERTIFICATE_ARN_AP_SOUTH_` | ACM cert ARN for `ap-south-1` (covers backend ALB) |
| `ACM_CERTIFICATE_ARN_US_EAST_` | ACM cert ARN for `us-east-1` (covers CloudFront) |

**Application secrets** (injected into ECS task environment by `terraform-live-backend.yml`):

| Secret | Value |
|---|---|
| `JWT_SECRET` | Long random string (min 32 chars; min 64 in production) — `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web client ID (leave empty to disable Google Sign-In) |
| `CORS_ORIGINS` | Comma-separated allowed origins, e.g. `https://app.example.com` |
| `COOKIE_DOMAIN` | Cookie domain for cross-subdomain auth, e.g. `.example.com` |
| `MONGODB_URI` | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/` |
| `OPENAI_API_KEY` | OpenAI key (optional) |
| `OPENAI_MODEL` | e.g. `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Anthropic key (optional) |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-6` |
| `GEMINI_API_KEY` | Google Gemini key (optional) |
| `GEMINI_MODEL` | e.g. `gemini-1.5-flash` |
| `BEHIND_PROXY` | `true` if the backend is behind a reverse proxy (e.g. ALB/Nginx); enables correct client-IP extraction for rate limiting (default `false`) |
| `DEFAULT_LOCATION` | MongoDB shard key for new users when location cannot be detected, e.g. `us`, `eu`, `in` (default `us`) |

**Frontend build secrets** (baked into the bundle by `deploy-live-frontend.yml`):

| Secret | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID` |
| `VITE_API_URL` | Backend API base URL, e.g. `https://api.example.com` |

At least one LLM API key must be set to enable LLM features.

## Product notes

- **LLM providers**: do not commit keys. Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Auto-selection priority: OpenAI → Anthropic → Gemini. Model defaults: `gpt-4o-mini`, `claude-sonnet-4-6`, `gemini-1.5-flash` (override via `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`). Without any key, `POST /llm/invoke` returns `503`. Audio transcription still requires `OPENAI_API_KEY` (OpenAI Whisper).
- **Rate limiting**: `POST /auth/register` is capped at 5 requests/minute per IP; login and Google auth at 10/minute. LLM calls are also rate-limited per-user (sliding window, default 200 calls/hour) via Redis — set `REDIS_URL` to a Redis instance; without it the rate limiter falls back to an in-process counter that breaks under multiple containers.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Requires `JWT_SECRET` and a valid `MONGODB_URI` if any test touches the DB.
