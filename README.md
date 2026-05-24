# Buddy360

A child development app for parents. Stack: **React 18 (Vite)**, **FastAPI**, **MongoDB** (Motor async driver), optional LLM providers (**OpenAI**, **Anthropic**, **Gemini**) and **OpenAI Whisper** for audio transcription. Run everything with **Docker Compose** or the backend/frontend dev servers.

Frontend UI library: **Tailwind CSS v3** + **shadcn/ui** (Radix UI primitives), **React Query**, **Framer Motion v11** (animations), **React Router v6**, **Recharts** (charts), **Stripe** (payments), **Three.js** (3D), **React Leaflet** (maps), **React Quill** (rich text), **jsPDF** + **html2canvas** (PDF export), **@hello-pangea/dnd** (drag and drop), **next-themes**, **Sonner** (notifications).

## Table of contents

- [Quick start (Docker)](#quick-start-docker)
- [Connecting to MongoDB](#connecting-to-mongodb)
- [Google Sign-In](#google-sign-in-optional)
- [Local development](#local-development-without-docker-for-nodepython)
- [Static assets (images)](#static-assets-images)
- [Pre-commit hooks](#pre-commit-hooks)
- [Local checks (check.sh)](#local-checks-checksh)
- [Backend tooling (pyproject.toml)](#backend-tooling-pyprojecttoml)
- [API overview](#api-overview)
- [Frontend pages](#frontend-pages)
- [UI design system](#ui-design-system)
- [Frontend animations](#frontend-animations)
- [GitHub Actions](#github-actions)
- [Product notes](#product-notes)
- [Tests](#tests)

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
- Frontend:
  ```bash
  cd frontend
  cp .env.example .env   # set BACKEND_BUCKET_NAME to your local assets bucket to load activity-game images via Vite proxy
  npm install && npm run dev
  ```

## Static assets (images)

Activity-game images (used in `ChildActivityGame`) are stored in S3 and served differently depending on the environment. **Two separate buckets are used** — a dedicated local bucket that is never touched by Terraform, and per-environment deployed buckets managed entirely by Terraform.

### How images are served

| Environment | Bucket | Path | How it works |
|---|---|---|---|
| **Local dev** | dedicated local bucket (set via `BACKEND_BUCKET_NAME` in `.env`) | `/app-assets/<path>` via Vite proxy | `vite.config.js` proxies `/app-assets/*` to `https://<bucket>.s3.us-east-1.amazonaws.com`. The bucket has a public `s3:GetObject` policy on `app-assets/*` — no AWS credentials required. |
| **Deployed (dev/stg/prod)** | per-environment bucket (set via `BACKEND_BUCKET_NAME` GitHub secret) | `/app-assets/<path>` via CloudFront | CloudFront `/app-assets/*` behaviour proxies to the bucket using OAC (SigV4 signing). No public S3 access needed. |

In all environments the frontend uses the same relative path `` `/app-assets/${option.image}` `` — no environment-specific URL logic in the component. If an image fails to load, the component falls back to an emoji/gradient tile automatically.

> **Note — CDN edge caching:** Local dev sends requests directly to the S3 regional endpoint in `us-east-1` — there is no CDN, no edge caching, and no geographic distribution. Only deployed CloudFront distributions serve from edge locations.

### S3 bucket folder structure

Images live under the `app-assets/` prefix, organised by growth area:

```
app-assets/
  child_activity_game/
    life_ambition/          astronaut.jpg, sports_person.jpg, like_my_parents.jpg,
                            super_hero.jpg, dancer.jpg, scientist.jpg
    self_care/              reading.jpg, listening_to_music.jpg, being_in_nature.jpg,
                            drawing_painting.jpg, resting_sleeping.jpg, exercise.jpg
    critical_thinking/      solving_puzzles.jpg, science_experiments.jpg, debates_arguments.jpg,
                            strategy_games.jpg, solving_mysteries.jpg, inventing_things.jpg
    creativity/             drawing_art.jpg, storytelling.jpg, making_music.jpg,
                            building_making.jpg, acting_drama.jpg, cooking_baking.jpg
    physical_wellness/      football_soccer.jpg, swimming.jpg, cycling.jpg,
                            dancing.jpg, yoga_stretching.jpg, running.jpg
    social_skills/          helping_others.jpg, leading_a_group.jpg, listening_to_friends.jpg,
                            working_in_a_team.jpg, making_new_friends.jpg, enjoying_my_own_time.jpg
```

### Step 1 — Create and configure the local bucket (one-time)

This is a **dedicated bucket used only for local development**. It is never referenced by Terraform, so its configuration is managed manually and will never be overwritten by a Terraform apply or destroy.

**1a. Create the bucket**

1. Open the [S3 console](https://s3.console.aws.amazon.com/s3/) and click **Create bucket**
2. Set **Bucket name** to your chosen local bucket name — note it down, you will set this as `BACKEND_BUCKET_NAME` in `.env`
3. Set **AWS Region** to `us-east-1`
4. Leave all other settings at their defaults and click **Create bucket**

**1b. Relax Block Public Access**

1. Click on the bucket you just created → **Permissions** tab → **Block public access (bucket settings)** → **Edit**
2. Uncheck the following two settings:
   - **Block public access to buckets and objects granted through new public bucket or access point policies**
   - **Block public and cross-account access to buckets and objects through any public bucket or access point policies**
3. Leave the top two checkboxes checked (they block ACL-based public access, which is not used here)
4. Click **Save changes** → type `confirm` → **Confirm**

**1c. Add a bucket policy**

1. Still on the **Permissions** tab, scroll to **Bucket policy** → **Edit**
2. Paste the following (replace `<your-local-bucket>` with your actual bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicGetAssets",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<your-local-bucket>/app-assets/*"
    }
  ]
}
```

3. Click **Save changes**

**1d. Create the folder structure**

Images live directly in S3 — there is no `app-assets/` folder in this repository.

1. Click on the bucket → **Objects** tab → **Create folder** → name it `app-assets` → **Create folder**
2. Open `app-assets/` → **Create folder** → name it `child_activity_game` → **Create folder**
3. Open `child_activity_game/` and create one subfolder for each growth area:
   - `life_ambition`
   - `self_care`
   - `critical_thinking`
   - `creativity`
   - `physical_wellness`
   - `social_skills`

### Step 2 — Upload images

Open each subfolder in the S3 console, click **Upload** → **Add files**, and upload the corresponding images:

| Folder | Files |
|---|---|
| `life_ambition/` | `astronaut.jpg`, `sports_person.jpg`, `like_my_parents.jpg`, `super_hero.jpg`, `dancer.jpg`, `scientist.jpg` |
| `self_care/` | `reading.jpg`, `listening_to_music.jpg`, `being_in_nature.jpg`, `drawing_painting.jpg`, `resting_sleeping.jpg`, `exercise.jpg` |
| `critical_thinking/` | `solving_puzzles.jpg`, `science_experiments.jpg`, `debates_arguments.jpg`, `strategy_games.jpg`, `solving_mysteries.jpg`, `inventing_things.jpg` |
| `creativity/` | `drawing_art.jpg`, `storytelling.jpg`, `making_music.jpg`, `building_making.jpg`, `acting_drama.jpg`, `cooking_baking.jpg` |
| `physical_wellness/` | `football_soccer.jpg`, `swimming.jpg`, `cycling.jpg`, `dancing.jpg`, `yoga_stretching.jpg`, `running.jpg` |
| `social_skills/` | `helping_others.jpg`, `leading_a_group.jpg`, `listening_to_friends.jpg`, `working_in_a_team.jpg`, `making_new_friends.jpg`, `enjoying_my_own_time.jpg` |

### Step 3 — Local dev setup

**Vite dev server (`npm run dev`):**

1. Ensure `frontend/.env` has `BACKEND_BUCKET_NAME` set to your local bucket name:
   ```env
   BACKEND_BUCKET_NAME=<your-local-bucket-name>
   ```
2. Run:
   ```bash
   cd frontend && npm run dev
   ```

**Docker Compose:**

Ensure `BACKEND_BUCKET_NAME` is set to your local bucket name in the root `.env`, then:
```bash
docker compose up --build
```

nginx proxies `/app-assets/*` requests directly to S3.

If `BACKEND_BUCKET_NAME` is not set, image requests fall back to the emoji/gradient tile automatically — no error is thrown.

## Pre-commit hooks

The repository uses [pre-commit](https://pre-commit.com/) to run ruff (Python linting + formatting) and ESLint + Prettier (JavaScript) automatically before every commit.

**One-time setup** (run once per clone, from the repo root):

```bash
pip install pre-commit
pre-commit install
```

After `pre-commit install`, hooks run automatically on every `git commit`. Most hooks auto-fix: `ruff` lint applies `--fix`, `ruff-format` reformats in place, `eslint` applies `--fix`, and `prettier` writes changes directly. If any file is modified, git aborts the commit — re-stage the fixed files (`git add .`) and commit again. On the second attempt nothing changes and the commit succeeds.

To run all hooks manually against every file:

```bash
pre-commit run --all-files
```

**What each hook does:**

| Hook | Scope | What it checks |
|---|---|---|
| `ruff` | `backend/` | Python linting — unused imports, bugbear, pyupgrade, isort, naming |
| `ruff-format` | `backend/` | Python formatting — black-compatible, line-length 100 |
| `eslint` | `frontend/src/**` (excl. `components/ui/`) | React + hooks rules, unused imports, security (`eslint-plugin-security`) |
| `prettier` | `frontend/src/**` | JS/JSX/CSS formatting — singleQuote, semi, printWidth 100; Tailwind CSS classes auto-sorted via `prettier-plugin-tailwindcss` |
| General hooks | all files | Trailing whitespace, EOF newlines, YAML/JSON validity, merge-conflict markers |

The frontend hooks invoke `npx eslint` / `npx prettier` from `frontend/node_modules`, so `npm install` must have been run inside `frontend/` at least once beforehand.

## Local checks (check.sh)

[`check.sh`](check.sh) is a convenience script at the repo root that runs every check the CI pipeline runs, **locally**, in a single command. **All 35 checks are mandatory** — the script fails at the summary if any tool is missing or any check fails, even if earlier checks passed. The 16 venv/npm-based checks (rows 1–16) are available automatically after bootstrap — no host tool installation needed for these. The 19 host-tool checks (rows 17–35) require external tools to be pre-installed — see **Required host tools** below. **CodeQL and dependency-review run only in GitHub Actions CI** — they require GitHub's infrastructure and are not part of `check.sh`. A colour-coded summary is printed at the end.

```bash
./check.sh
```

No manual setup required for backend and frontend checks. On every run the script automatically:
- Creates `backend/.venv` if it does not exist, then syncs all Python packages from `requirements.txt`, `requirements-lint.txt` (ruff, mypy), `requirements-security.txt` (bandit, semgrep, pip-audit, checkov), and `requirements-test.txt` (pytest, pytest-cov). `pip install` is a no-op when versions are already correct, so this is fast on subsequent runs. These files are the single source of truth for tool versions — both `check.sh` and CI read from them.
- Runs `npm install` in `frontend/`. This is fast when `node_modules` already exists and ensures any `package.json` change is always reflected.
- Downloads/refreshes the retire.js vulnerability database to `frontend/retire-jsrepo.json` if it is absent or older than 7 days. The file is gitignored so it stays current without committing a static snapshot. If the network is unavailable and a previous copy exists, the existing file is reused with a warning.

The script looks for each tool in `backend/.venv/bin/` first, then falls back to `PATH`.

**Required host tools:** `check.sh` fails if any of these are absent — install all of them before running the script. `semgrep` and `checkov` are installed automatically into the venv via `requirements-security.txt` and do not need a separate step.

```bash
brew install gitleaks
brew install hadolint
brew install aquasecurity/trivy/trivy
brew install goodwithtech/r/dockle
brew install nuclei
brew install terraform
brew install terraform-linters/tap/tflint
# Trivy image scan also requires Docker to be installed AND running:
# https://docs.docker.com/get-docker/
# nuclei DAST check also requires the backend to be running at http://localhost:8000 — see check.sh output for the start command.
# spectral is NOT listed here — it is a devDependency in frontend/package.json and is
# installed automatically by the npm install bootstrap step. No manual install needed.
```

**Checks run:**

| # | Check | Tool | Scope |
|---|---|---|---|
| 1 | `ruff check` | ruff 0.11.2 | `backend/` — linting (unused imports, bugbear, naming, …) |
| 2 | `ruff format` | ruff 0.11.2 | `backend/` — formatting (black-compatible, line-length 100) |
| 3 | `mypy` | mypy 1.15.0 | `backend/app/` — static type checking (Python 3.12) |
| 4 | `eslint` | ESLint (via npm) | `frontend/src/**` (excl. `components/ui/`) — React/hooks rules, unused imports, security |
| 5 | `prettier` | Prettier (devDependency) | `frontend/src/**` — JS/JSX/CSS formatting; Tailwind classes auto-sorted (`prettier-plugin-tailwindcss`) |
| 6 | `typecheck` | tsc (via npm) | `frontend/src/**` (excl. `components/ui/`) — JSDoc type checking via `checkJs` |
| 7 | `build` | Vite (via npm) | `frontend/` — production build |
| 8 | bundle size | bash + `wc` | `frontend/dist/` — main JS bundle must be ≤ 1.4 MB |
| 9 | pytest + coverage | pytest + pytest-cov | `backend/` — unit and integration tests; coverage is reported but not yet gated (raise `--cov-fail-under` as the test suite grows) |
| 10 | `bandit` | bandit 1.9.4 | `backend/app/` — Python SAST: hard-coded secrets, injection, insecure calls (medium+ severity) |
| 11 | `pip-audit` | pip-audit 2.9.0 | `backend/requirements.txt` — dependency CVE scan (PYSEC-2025-183 suppressed — disputed, no fix version) |
| 12 | `npm audit` | npm | `frontend/` — npm dependency CVE scan (high/critical only) |
| 13 | retire.js | retire (devDependency) | `frontend/` — browser library CVEs, including client-side JS libraries not always caught by npm audit |
| 14 | semgrep | semgrep 1.163.0 | `backend/app/` + `frontend/src/` — Python and JavaScript/React SAST (`p/security-audit` ruleset); venv-installed via `requirements-security.txt` |
| 15 | checkov | checkov 3.2.529 | `infra-live-*/terraform/` — Terraform IaC misconfigurations (open S3 buckets, missing encryption, overly permissive IAM); venv-installed via `requirements-security.txt` |
| 16 ² | gitleaks | gitleaks | Entire repo git history — accidentally committed secrets, API keys, tokens |
| 17 ² | hadolint | hadolint | `backend/Dockerfile` — Dockerfile best practices and security misconfigurations |
| 18 ² | trivy (backend fs) | trivy | `backend/` — HIGH/CRITICAL CVEs in Python packages (complements pip-audit with a second CVE database) |
| 19 ² | trivy (frontend fs) | trivy | `frontend/` — HIGH/CRITICAL CVEs in npm packages (complements npm audit with a second CVE database) |
| 20 ² | trivy (backend license) | trivy | `backend/` — HIGH/CRITICAL license violations (GPL, AGPL, LGPL) in Python packages |
| 21 ² | trivy (frontend license) | trivy | `frontend/` — HIGH/CRITICAL license violations in npm packages |
| 22 ² | trivy (frontend SBOM) | trivy | `frontend/` — generates `sbom-frontend.cyclonedx.json` in CycloneDX format for software supply-chain audits |
| 23 ² | trivy config (infra-live-backend) | trivy | `infra-live-backend/terraform/` — IaC security misconfigurations using Trivy's built-in Terraform rule set (tfsec successor); `trivy config` accepts one dir at a time |
| 24 ² | trivy config (infra-live-edge) | trivy | `infra-live-edge/terraform/` — same |
| 25 ² | trivy config (infra-live-frontend) | trivy | `infra-live-frontend/terraform/` — same |
| 26 ³ | docker build (image scan) | docker | Builds `buddy-backend` image locally — prerequisite for the three image-level checks below |
| 27 ³ | trivy (backend image) | trivy + docker | Built `buddy-backend` image — OS-level HIGH/CRITICAL CVEs in the Debian base layer (unfixed only) |
| 28 ³ | trivy (backend image SBOM) | trivy + docker | Built image — generates `sbom-backend.cyclonedx.json` in CycloneDX format |
| 29 ³ | dockle | dockle + docker | Built image — CIS Docker Benchmark: checks for root user, secrets baked into layers, missing `HEALTHCHECK`, other hardening rules |
| 30 | spectral (OpenAPI lint) | spectral (via `frontend/node_modules/.bin/`) | Exports the FastAPI OpenAPI spec via `backend/tools/export-openapi.py` (no running server needed) and lints it against `.spectral.yaml` — security schemes, operationId, tags; installed automatically as a `devDependency` |
| 31 ⁵ | nuclei (DAST) | nuclei | Runs dynamic application security tests against `http://localhost:8000` — misconfiguration, exposure, and technology probes (medium/high/critical severity) |
| 32 ¹ | terraform fmt | terraform | All `infra-live-*/terraform/` dirs — formatting check (`-check -recursive`) |
| 33 ¹ | tflint (infra-live-backend) | tflint | `infra-live-backend/terraform/` — deprecated syntax, wrong types, best-practice violations |
| 34 ¹ | tflint (infra-live-edge) | tflint | `infra-live-edge/terraform/` — same |
| 35 ¹ | tflint (infra-live-frontend) | tflint | `infra-live-frontend/terraform/` — same |

¹ Required — `check.sh` fails with an install hint if `terraform` / `tflint` is not found in `PATH`.
² Required — `check.sh` fails with an install hint if the respective tool (`gitleaks`, `hadolint`, or `trivy`) is not found in `PATH`.
³ Required — `check.sh` fails with an install hint if `trivy` or `docker` is not found in `PATH`. Docker must be installed **and running** for the image scan.
⁴ No manual install — `@stoplight/spectral-cli` is a `devDependency` in `frontend/package.json`. It is installed automatically during the `npm install` bootstrap step and invoked directly from `frontend/node_modules/.bin/spectral`.
⁵ Required — `check.sh` fails with an install hint if `nuclei` is not found in `PATH`. This check also requires the backend to be running at `http://localhost:8000` before `check.sh` is invoked — start it with `cd backend && source .venv/bin/activate && uvicorn app.main:app`.

**Note:** CodeQL (dataflow/taint analysis for Python and JavaScript) and dependency-review (PR lockfile CVE diffing) run only in GitHub Actions CI — they require GitHub's infrastructure and are not included in `check.sh`.

The exit code is non-zero if any check fails, making it safe to call from other scripts or a pre-push hook.

## Backend tooling (pyproject.toml)

[`backend/pyproject.toml`](backend/pyproject.toml) centralises ruff and mypy configuration so the same settings are used by the pre-commit hooks, `check.sh`, and CI.

### ruff

| Setting | Value | Notes |
|---|---|---|
| `target-version` | `py312` | Enables Python 3.12 syntax modernisations via pyupgrade |
| `line-length` | `100` | Enforced by `ruff format`; `E501` is disabled in `ruff check` to avoid duplicate warnings |
| `quote-style` | `double` | Double-quoted strings (Black-compatible) |
| `indent-style` | `space` | Space indentation |
| `line-ending` | `lf` | Unix line endings enforced on all platforms |
| `known-first-party` | `["app"]` | isort treats `app` as a first-party import so it is grouped separately from third-party packages |

Rule sets enabled:

| Code | Plugin | What it checks |
|---|---|---|
| `E`, `W` | pycodestyle | Basic style errors and warnings |
| `F` | pyflakes | Undefined names, unused imports |
| `I` | isort | Import ordering |
| `B` | flake8-bugbear | Common bugs and opinionated style |
| `UP` | pyupgrade | Syntax modernisation for Python 3.12 |
| `C4` | flake8-comprehensions | Simplify list/dict/set comprehensions |
| `RET` | flake8-return | Remove unnecessary `else` after `return` |
| `SIM` | flake8-simplify | General simplification suggestions |
| `N` | pep8-naming | Class, function, and variable naming conventions |

Ignored rules and rationale:

| Rule | Reason ignored |
|---|---|
| `E501` | Line length is already enforced by `ruff format`; redundant in `ruff check` |
| `N818` | FastAPI's `HTTPException` ends in `Exception`, not `Error` — kept intentionally |
| `SIM108` | Ternary expressions are used deliberately; forced rewrites reduce readability here |
| `B008` | FastAPI's `Depends(...)` pattern calls functions in default arguments by design |

### mypy

| Setting | Value | Notes |
|---|---|---|
| `python_version` | `3.12` | Matches the runtime Python version |
| `ignore_missing_imports` | `true` | Avoids errors for third-party packages without bundled stubs |
| `check_untyped_defs` | `true` | Type-checks function bodies even when they have no annotations |
| `warn_unused_ignores` | `true` | Flags stale `# type: ignore` comments so they don't accumulate |
| `warn_return_any` | `false` | Suppresses warnings when functions return `Any` — intentional, as MongoDB and LLM responses are dynamically typed |
| `strict` | `false` | Full strict mode is off; `disallow_untyped_defs` is disabled to allow incremental type-annotation adoption |

## API overview

All routes are prefixed `/api/v1`. Auth endpoints use rate limiting (slowapi).

**Auth** (`/api/v1/auth/...`)
- `POST /auth/register` — create account, returns token pair (rate-limited: 5/min)
- `POST /auth/login` — email/password login, returns token pair (rate-limited: 10/min)
- `POST /auth/google` — Google ID-token login/register, returns token pair (rate-limited: 10/min)
- `POST /auth/refresh` — issue a new token pair using only the refresh token cookie (access token cookie is optional — included as a defence-in-depth subject check when present)
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
- `GET /api/health` — returns `{"status": "ok", "commit": "<git-sha>", "branch": "<branch>", "committed_at": "<iso-timestamp>", "tag": "<tag>|null"}` — git metadata is baked into the image at build time via Docker build args (CI sets real values; local/scan builds return `"unknown"`)

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

## UI design system

The entire frontend uses a **dark cosmic theme**. All colors are defined as CSS custom properties in `frontend/src/index.css` and applied via Tailwind utility classes.

### Color tokens

| Token | Value | Usage |
|---|---|---|
| Base background | `#0a0a0a` | Page backgrounds (`bg-[#0a0a0a]`) |
| Card surface | `#141414` | Primary cards and modals |
| Elevated card | `#1a1a1a` | Nested cards, headers inside modals |
| Input surface | `#1e1e1e` | Form inputs, chat bubbles |
| Border subtle | `rgba(255,255,255,0.06)` | Default card borders (`border-white/[0.06]`) |
| Border default | `rgba(255,255,255,0.08)` | Standard card borders |
| Border emphasis | `rgba(255,255,255,0.10–0.14)` | Hover and active borders |
| Primary accent | `teal-400 / teal-500` | CTAs, active states, highlights |
| Secondary accent | `amber-400 / amber-500` | Warnings, "Start Over" actions |
| Success | `emerald-400 / emerald-500` | Completed states, scores |
| Text primary | `white` | Headings and active labels |
| Text secondary | `slate-300` | Body text |
| Text muted | `slate-400 / slate-500` | Captions, placeholders |

### Glow utilities

Three custom Tailwind utilities are defined in `index.css`:

| Class | Effect |
|---|---|
| `glow-teal` | Large teal box-shadow — used on primary CTA buttons |
| `glow-teal-sm` | Small teal box-shadow — used on icons and small accents |
| `glow-amber` | Amber box-shadow — used on warning/secondary buttons |

### Button hierarchy

| Type | Style |
|---|---|
| Primary CTA | `bg-gradient-to-r from-teal-500 to-teal-400 text-[#0a0a0a] font-semibold glow-teal` |
| Secondary / outline | `border border-white/[0.12] bg-transparent text-slate-300 hover:bg-white/[0.05]` |
| Danger / reset | `border border-amber-500/30 text-amber-400 bg-transparent hover:bg-amber-500/10` |
| Teal outline | `border border-teal-500/30 text-teal-400 bg-transparent hover:bg-teal-500/10` |

## Frontend animations

All animations use **Framer Motion**. The design system follows a consistent dark/cosmic aesthetic: elements fade in and slide up on entry with deliberate, unhurried timing; lists stagger by a fixed delay per item; modals crossfade with `AnimatePresence`. Spring-scale pops are no longer used — all entries are fade + slide.

### Page / section entry

| Location | Duration | Effect |
|---|---|---|
| Home — hero | `1.2s` ease-out | Fade + slide up (`y: 30 → 0`) |
| Home — pillar cards | `0.12s` stagger per card | Fade + slide up, triggered on scroll (`whileInView`) |
| Home — "How It Works" cards | `0.225s` stagger per card | Fade + slide up, triggered on scroll |
| Onboarding — phase transition | `0.45s` | Slide left/right (`x: ±50 → 0`), `AnimatePresence mode="wait"` |
| LifePathway — page fade-in | `0.6s` ease-out | Fade only (wrapper) |
| LifePathway — header | `1.0s`, `0.1s` delay, ease-out | Fade + slide up (`y: 24 → 0`) |
| LifePathway — chart card | `1.0s`, `0.8s` delay, ease-out | Fade + slide up |
| LifePathway — growth area insights | `1.0s`, `1.6s` delay, ease-out | Fade + slide up; items stagger `2.0 + idx * 0.3s` |
| LifePathway — CTA | `1.0s`, `1.8s` delay, ease-out | Fade + slide up |
| GoalsDashboard — header | `1.0s`, `0.1s` delay, ease-out | Fade + slide up (`y: 24 → 0`) |
| GoalsDashboard — month cards | `1.0s`, `0.6 + idx * 0.3s` delay | Fade + slide up |

### Component-level

| Location | Duration | Effect |
|---|---|---|
| WelcomePhase — heading | `0.3s` delay | Fade + slide up |
| WelcomePhase — subtitle | `0.45s` delay | Fade + slide up |
| WelcomePhase — "what you'll do" card | `0.6s` delay | Fade + slide up |
| WelcomePhase — step items | `0.75 + idx * 0.15s` delay | Fade + slide left (`x: -20 → 0`) |
| WelcomePhase — CTA button area | `1.05s` delay | Fade + slide up |
| WelcomePhase — footer note | `1.2s` delay | Fade in |
| ConversationalOnboarding — bot messages | `2.0s` fade / `1.6s` y, ease-out | Fade + slide up (`y: 16 → 0`); messages assigned stable IDs as React keys |
| ConversationalOnboarding — user messages | `1.6s` fade / `1.4s` x | Fade + slide in from right (`x: 40 → 0`) |
| ConversationalOnboarding — typing indicator | `0.45s` in / `0.3s` out | Fade + slide up, `AnimatePresence` exit |
| ConversationalOnboarding — bot typing delay | `1.6s` pause before message appears | Simulates natural reply cadence |
| ConversationalOnboarding — choice buttons | `0.12s` stagger, `0.4s` ease-out | Fade + scale (`0.9 → 1`) |
| ConversationalOnboarding — progress step strikethrough | `1.4s` ease-in-out | Animated horizontal line draws from left (`scaleX: 0 → 1`), `AnimatePresence` |
| ConversationalOnboarding — scroll | RAF-based cubic ease-in-out, `1.4s` | Custom smooth scroll on the messages container (not `scrollIntoView`) |
| ConversationalOnboarding — analysis counter | `2.8s` total (`28ms × 100` ticks) | Progress counter |
| RecommendationsPhase — intro sections | `sectionAnim` helper: `1.0s`, staggered `0.1 / 0.8 / 1.8s` | Fade + slide up (`y: 24 → 0`) |
| RecommendationsPhase — profile strengths | `0.8s`, `1.1 + idx * 0.25s` delay | Fade + slide up |
| RecommendationsPhase — area cards | `1.0s`, `0.5 + i * 0.5s` delay | Fade + slide up |
| RecommendationsPhase — activity buttons | `1.0s`, `0.5 + i * 0.3s` delay | `motion.button` fade + slide up |
| RecommendationsPhase — question transition | `1.0s` in / `0.4s` out, `AnimatePresence mode="wait"` | Fade + slide up/down (`y: 20 → 0 / 0 → -16`) |
| RecommendationsPhase — answer items | `0.7s`, `0.9 + i * 0.15s` delay | Slide from left (`x: -16 → 0`) |
| RecommendationsPhase — conditional button groups | `AnimatePresence` | Animated entry/exit when `parentLiked`, `showGame`, `childGameResults` states change |
| RecommendationsPhase — child game results (sequential) | Deeply staggered: `2.2 / 2.7 / 3.5 / 4.3 / 5.7s` | Each sub-section appears after the previous finishes |
| RecommendationsPhase — recommendations list | `0.7s`, `i * 0.15s` delay | Slide from left (`x: -16 → 0`) |
| RecommendationsPhase — step change | `window.scrollTo` instant | Scroll to top on every `step` state change |
| PersonalityAnalysis — sections (`sectionAnim`) | `1.0s` ease-out, staggered `0.1 / 0.8 / 1.6 / 2.4 / 3.2 / 4.0s` | Fade + slide up (`y: 24 → 0`) for all 6 sections |
| PersonalityAnalysis — trait chips | `0.7s`, `1.0 + i * 0.2s` delay | Fade + slide up (`y: 10 → 0`) |
| PersonalityAnalysis — profile bars | `2.4s` ease-in-out, `2.0 + i * 0.3s` delay | Width fill (`0 → actual%`) |
| PersonalityAnalysis — famous people | `0.8s`, `2.7 + i * 0.3s` delay | Fade + scale (`0.85 → 1`) |
| PersonalityAnalysis — strengths list items | `0.7s`, `3.5 + i * 0.15s` delay | Slide from left (`x: -8 → 0`) |
| PersonalityAnalysis — growth area items | `0.7s`, `4.3 + i * 0.15s` delay | Slide from left (`x: -8 → 0`) |
| ActivityModal — progress bar fill | `0.45s` | Width fill |
| VoiceInput — recording button | No animation | `animate-pulse` removed; button stays solid red while recording |

### Modals

| Location | Duration | Effect |
|---|---|---|
| ActivityModal | `0.3s` (Framer default) | Scale + slide up (`scale: 0.9, y: 20 → 1, 0`), `AnimatePresence` |
| ProgressInsightsModal | `0.3s` (Framer default) | Scale + slide up (`scale: 0.95, y: 20 → 1, 0`), `AnimatePresence` |
| shadcn Dialog / AlertDialog | `300ms` | Radix built-in fade + zoom, updated from 200ms |
| LifePathway — concern modal (backdrop) | `0.3s` | Fade (`opacity: 0 → 1`), `AnimatePresence` |
| LifePathway — concern modal (card) | `0.375s` ease-out | Scale + slide up (`scale: 0.95, y: 16 → 1, 0`) |
| LifePathway — concern modal (form ↔ success) | `0.5s` in / `0.3s` out, `AnimatePresence mode="wait"` | Crossfade between form and success state |

### Loaders / repeating

| Location | Duration | Effect |
|---|---|---|
| All page/section spinners | `1.2s – 2s` infinite | Rotate 360° (`ease: linear`) |
| LifePathway loading state | Dark background `#0a0a0a` | Consistent with page theme |
| Analyzing screen spinner (ConversationalOnboarding) | `3s` infinite | Slow rotate 360° |
| Typing indicator dots | CSS `animate-bounce` | Staggered bounce (`0ms / 150ms / 300ms` delay) |

### Scroll behaviour

- **Route change**: `ScrollToTop` component in `App.jsx` fires `window.scrollTo({ top: 0, behavior: 'instant' })` on every React Router path change.
- **Onboarding phase change**: `window.scrollTo` instant on `currentPhase` update.
- **RecommendationsPhase step change**: `window.scrollTo` instant on `step` state update.
- **Conversational chat**: custom RAF-based cubic ease-in-out scroll (1.4 s, 200 ms debounced) on the messages container after each new message or typing-indicator change.

### Design rules

- **Default card entry**: `initial={{ opacity: 0, y: 24 }}` → `animate={{ opacity: 1, y: 0 }}`, `duration: 1.0`, `ease: 'easeOut'`
- **Default list stagger**: `delay: 0.12s` per item (general) or component-specific base delay + `index * step`
- **Spring animations**: removed throughout — all entries use fade + slide
- **Phase transitions**: always use `AnimatePresence mode="wait"` so the exiting element completes before the entering one starts
- **Exit animations**: modals and conditional sections exit with `opacity: 0, y: -12/16` over `0.3–0.6s` ease-in
- **Stable React keys for chat messages**: messages use a module-level counter (`newMsgId()`) rather than array index to avoid key collisions on re-render

## GitHub Actions

Eight workflows live under [`.github/workflows/`](.github/workflows/). Deployment and infrastructure workflows authenticate to AWS via **OIDC** — no long-lived access keys are stored anywhere in GitHub.

| Workflow | Trigger | Purpose |
|---|---|---|
| `lint.yml` | Push / PR to `main`; Manual (`workflow_dispatch`) | Code quality gate — lint, format, types, build, bundle size, tests + coverage, Terraform lint, secret detection, Dockerfile lint, SAST, IaC security, CVE scan, license compliance, Docker image scan, SBOM, OpenAPI lint, DAST, dependency review (PRs), CodeQL |
| `terraform-live-all.yml` | Manual | Full-stack orchestrator — provisions or tears down all infra, then optionally deploys |
| `terraform-live-backend.yml` | Manual / called | VPC, ECS, ALB, Redis, ECR, Secrets Manager |
| `terraform-live-frontend.yml` | Manual / called | S3 bucket for frontend assets |
| `terraform-live-edge.yml` | Manual / called | CloudFront distribution + ACM cert (always `us-east-1`) |
| `deploy-live-backend.yml` | Manual / called | Builds Docker image, pushes to ECR, updates ECS service |
| `deploy-live-frontend.yml` | Manual / called | Builds frontend, uploads to S3, invalidates CloudFront |
| `restart-live-backend.yml` | Manual | Force-restarts ECS tasks without a new build (picks up secret rotations, env changes) |

### Code quality workflow (lint.yml)

[`lint.yml`](.github/workflows/lint.yml) runs on pushes and pull requests targeting `main`, and can also be triggered manually via `workflow_dispatch` from the GitHub Actions UI. It has eight jobs. `backend-lint`, `frontend-lint`, and `terraform-lint` start in parallel immediately; `backend-test` starts once `backend-lint` passes; `security-scan`, `dast`, and `codeql` all start once both `backend-lint` and `frontend-lint` pass; `dependency-review` runs only on pull requests and starts independently of the other jobs. A concurrency guard cancels any in-progress run for the same branch when a new push arrives, avoiding redundant CI minutes. A workflow-level `permissions: contents: read` baseline is set; individual jobs declare their own elevated permissions only when needed (`codeql` needs `security-events: write`; `dependency-review` needs `pull-requests: write`).

**`backend-lint`** (Python 3.12):

The install step runs `pip install -r requirements.txt -r requirements-lint.txt`, picking up `ruff` and `mypy` versions from `backend/requirements-lint.txt` — the single source of truth shared with `check.sh`. All app packages are present when mypy runs — giving it full type resolution rather than treating third-party imports as `Any`. The pip cache key covers both files so a change to either invalidates the cache.

| Step | Tool | What it checks |
|---|---|---|
| `ruff check` | ruff 0.11.2 | Linting — unused imports, bugbear, naming, isort, … |
| `ruff format --check` | ruff 0.11.2 | Formatting (black-compatible, line-length 100) — fails if any file is unformatted |
| `mypy` | mypy 1.15.0 | Static type checking of `app/` against real package stubs (Python 3.12, `check_untyped_defs`) |

**`frontend-lint`** (Node.js 22):

| Step | Tool | What it checks |
|---|---|---|
| `eslint` | ESLint (via `npm run lint`) | React/hooks rules, unused imports, security (`eslint-plugin-security`) — covers `src/**` excl. `components/ui/` |
| `prettier --check` | Prettier (devDependency) | JS/JSX/CSS formatting across `src/**` — fails if any file is unformatted or has unsorted Tailwind classes (`prettier-plugin-tailwindcss`) |
| `typecheck` | tsc (via `npm run typecheck`) | JSDoc type checking (`checkJs`) across `src/**` excl. `components/ui/` |
| `build` | Vite (via `npm run build`) | Production build — catches import errors and missing assets |
| bundle size | bash + `wc` | Ensures the main JS bundle stays ≤ 1.4 MB (current: ~1.08 MB) |

**`terraform-lint`**:

| Step | Tool | What it checks |
|---|---|---|
| `terraform fmt -check -recursive` | Terraform 1.13.0 | Formatting across all three infra directories (`infra-live-backend/`, `infra-live-edge/`, `infra-live-frontend/`) — fails if any `.tf` file is unformatted |
| `tflint (infra-live-backend)` | tflint 0.62.1 | Deprecated syntax, unused variables, wrong argument types and best-practice violations in backend infra |
| `tflint (infra-live-edge)` | tflint 0.62.1 | Same for edge infra (CloudFront / WAF / DNS) |
| `tflint (infra-live-frontend)` | tflint 0.62.1 | Same for frontend infra (S3 bucket policy) |

**`backend-test`** (Python 3.12, needs: backend-lint):

Runs after `backend-lint` passes. Spins up MongoDB and Redis as Docker service containers so the FastAPI app can connect to real dependencies — identical to the dev environment. `JWT_SECRET` is set from the GitHub secret with a hard-coded 64-character fallback so the job never fails due to a missing secret configuration.

| Step | Tool | What it checks |
|---|---|---|
| `pytest --cov=app --cov-report=term-missing --cov-fail-under=0` | pytest 8.3.4 + pytest-cov 6.0.0 | All tests under `backend/tests/` — coverage is reported on every run; gate is set to 0 until a baseline test suite exists (raise `--cov-fail-under` incrementally as tests are added) |

Coverage reports are printed to the job log with `--cov-report=term-missing` so uncovered lines are visible without downloading an artifact.

**`dast`** (needs: backend-lint + frontend-lint):

Runs dynamic application security testing against a live backend instance. Like `backend-test`, it spins up MongoDB and Redis service containers and starts FastAPI with `uvicorn` in the background, then polls `GET /health` for up to 60 seconds before running any scan. All scan steps carry `continue-on-error: true`; a final gate step collects outcomes and fails the job after all tools complete.

| Step | Tool | What it checks |
|---|---|---|
| Spectral (OpenAPI lint) | spectral-cli 6.16.0 (devDependency in `frontend/package.json`) | Fetches the live OpenAPI spec from the running backend (`GET /openapi.json`), then lints against `.spectral.yaml` — every operation must declare a security scheme, have a unique `operationId`, and be tagged |
| Nuclei (DAST) | nuclei v3.3.9 | Probes `http://localhost:8000` with `http/misconfiguration`, `http/exposures`, and `http/technologies` templates at medium/high/critical severity — detects missing security headers, exposed debug endpoints, dangerous HTTP methods |

**`security-scan`**:

All steps run without cloud credentials. The checkout uses `fetch-depth: 0` so gitleaks can scan the full commit history, not just the current working tree. Gitleaks is installed from the upstream release tarball with SHA-256 checksum verification before extraction. Every security-check step carries `continue-on-error: true` so all tools complete even if an earlier one fails; a final gate step (`if: always()`) collects the outcome of every step and fails the job — printing the full list of which checks failed — only after all tools have run. The final group builds the backend Docker image to scan OS-level CVEs inside the Debian base layer. Steps are grouped by the runtime they require.

| Step | Tool | What it checks |
|---|---|---|
| Gitleaks | gitleaks v8.30.1 (CLI) | Full git history — accidentally committed secrets, API keys, private keys, tokens |
| Hadolint | hadolint-action 3.3.0 | `backend/Dockerfile` — Dockerfile best practices: running as root, `latest` tag, insecure instructions |
| Bandit | bandit 1.9.4 | `backend/app/` — Python SAST: hard-coded secrets, injection, insecure API calls (medium+ severity) |
| Semgrep | semgrep 1.163.0 (`p/security-audit`) | `backend/app/` + `frontend/src/` — advanced Python and JavaScript/React SAST patterns |
| pip-audit | pip-audit 2.9.0 | `backend/requirements.txt` — dependency CVE scan (PyPA/OSV DB); PYSEC-2025-183 suppressed — disputed, no fix version |
| Checkov | checkov 3.2.529 | `infra-live-*/terraform/` — Terraform IaC misconfigurations (open S3 buckets, missing encryption, overly permissive IAM) |
| npm audit | npm | `frontend/` — npm dependency CVE scan (high/critical only) |
| Retire.js | retire (devDependency) | `frontend/` — browser library CVEs not always caught by npm audit |
| Trivy (backend fs) | trivy-action 0.36.0 | `backend/` — HIGH/CRITICAL CVEs in Python packages using the Trivy advisory DB (complements pip-audit) |
| Trivy (frontend fs) | trivy-action 0.36.0 | `frontend/` — HIGH/CRITICAL CVEs in npm packages using the Trivy advisory DB (complements npm audit) |
| Trivy (backend license) | trivy-action 0.36.0 | `backend/` — HIGH/CRITICAL license violations (GPL, AGPL, LGPL) in Python packages |
| Trivy (frontend license) | trivy-action 0.36.0 | `frontend/` — HIGH/CRITICAL license violations in npm packages |
| Trivy (frontend SBOM) | trivy-action 0.36.0 | `frontend/` — generates `sbom-frontend.cyclonedx.json` in CycloneDX format, uploaded as a 90-day workflow artifact |
| Trivy config (infra-live-backend) | trivy (CLI) | `infra-live-backend/terraform/` — IaC security misconfigurations using Trivy's built-in Terraform rule set (tfsec successor); complements Checkov with a second rule database; `trivy config` accepts one directory at a time |
| Trivy config (infra-live-edge) | trivy (CLI) | `infra-live-edge/terraform/` — same |
| Trivy config (infra-live-frontend) | trivy (CLI) | `infra-live-frontend/terraform/` — same |
| Docker build (image scan) | docker | Builds `buddy-backend` image once; shared by the three image-level checks below |
| Trivy (backend image) | trivy-action 0.36.0 | Built `buddy-backend` Docker image — OS-level HIGH/CRITICAL CVEs in the Debian base layer packages (unfixed only) |
| Trivy (backend image SBOM) | trivy-action 0.36.0 | Built `buddy-backend` image — generates `sbom-backend.cyclonedx.json` in CycloneDX format, uploaded as a 90-day workflow artifact |
| Dockle | dockle (installed from release tarball) | Built image — CIS Docker Benchmark: root user check, secrets baked into layers, missing `HEALTHCHECK`, unnecessary `setuid`/`setgid` bits |

**`codeql`**:

Runs two matrix jobs in parallel after `backend-lint` and `frontend-lint` pass. Results are uploaded to the GitHub Security tab and are visible under **Security → Code scanning**. `fail-fast: false` ensures both languages complete independently — a failure in one does not abort the other.

| Matrix | Language | What it checks |
|---|---|---|
| `python` | Python 3.12 | `backend/app/` — dataflow and taint analysis, injection flaws, insecure API usage (`security-extended` query suite) |
| `javascript-typescript` | JavaScript/JSX | `frontend/src/` — XSS, prototype pollution, unsafe regex, DOM-based vulnerabilities (`security-extended` query suite) |

CodeQL requires `security-events: write` permission (set at the job level) to upload SARIF results. It cannot be run locally — it runs only in GitHub Actions CI.

**`dependency-review`**:

Runs only on pull requests (`if: github.event_name == 'pull_request'`). Uses the GitHub-native `dependency-review-action@v4` to detect any newly introduced dependency with a known HIGH or CRITICAL vulnerability, comparing the PR's lockfile changes against GitHub's vulnerability database. Posts a summary comment on the PR. It runs independently of other jobs and does not block push pipelines.

| Step | Tool | What it checks |
|---|---|---|
| Dependency Review | dependency-review-action v4 | Newly added or changed dependencies in `package-lock.json` / `requirements.txt` that have HIGH/CRITICAL CVEs — blocks merge if any are found |

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
| `BACKEND_BUCKET_NAME` | Pre-existing S3 bucket name (in `us-east-1`) used to store static assets under `app-assets/` and to hold any backend-generated files. Used by `terraform-live-backend` (ECS env var injection) and `terraform-live-edge` (CloudFront origin + bucket policy). |
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
| `OPENAI_MODEL` | e.g. `gpt-5.4-mini` |
| `ANTHROPIC_API_KEY` | Anthropic key (optional) |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-6` |
| `GEMINI_API_KEY` | Google Gemini key (optional) |
| `GEMINI_MODEL` | e.g. `gemini-3-flash` |
| `BEHIND_PROXY` | `true` if the backend is behind a reverse proxy (e.g. ALB/Nginx); enables correct client-IP extraction for rate limiting (default `false`) |
| `DEFAULT_LOCATION` | MongoDB shard key for new users when location cannot be detected, e.g. `us`, `eu`, `in` (default `us`) |
| `BACKEND_BUCKET_NAME` | S3 bucket name injected into the ECS task environment; available to the backend for any S3 operations (e.g. future direct uploads). Also declared as an infrastructure secret above — a single GitHub secret drives both Terraform and the ECS environment. |

**Frontend build secrets** (baked into the bundle by `deploy-live-frontend.yml`):

| Secret | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID` |
| `VITE_API_URL` | Backend API base URL, e.g. `https://api.example.com` |

At least one LLM API key must be set to enable LLM features.

## Product notes

- **LLM providers**: do not commit keys. Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Auto-selection priority: OpenAI → Anthropic → Gemini. Model defaults: `gpt-5.4-mini`, `claude-sonnet-4-6`, `gemini-3-flash` (override via `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`). Without any key, `POST /llm/invoke` returns `503`. Audio transcription still requires `OPENAI_API_KEY` (OpenAI Whisper).
- **Rate limiting**: `POST /auth/register` is capped at 5 requests/minute per IP; login and Google auth at 10/minute. LLM calls are also rate-limited per-user (sliding window, default 200 calls/hour) via Redis — set `REDIS_URL` to a Redis instance; without it the rate limiter falls back to an in-process counter that breaks under multiple containers.
- **Session management**: the access token has a 30-minute lifetime; the refresh token lasts 24 hours. `AuthContext` schedules a proactive silent refresh 60 seconds before the access token would expire, so sessions stay alive automatically without requiring any user interaction. If the silent refresh returns 401 (refresh token expired or revoked), the app dispatches a `buddy360:auth-expired` custom event and the user is logged out. Network hiccups retry after 30 seconds.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Requires `JWT_SECRET` and a valid `MONGODB_URI` if any test touches the DB.
