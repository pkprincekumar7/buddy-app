# Buddy360

A child development app for parents. Stack: **React 18 (Vite)**, **FastAPI**, **PostgreSQL**, optional LLM providers (**OpenAI**, **Anthropic**, **Gemini**) and **OpenAI Whisper** for audio transcription. Run everything with **Docker Compose** or the backend/frontend dev servers.

Frontend UI library: **Tailwind CSS** + **shadcn/ui** (Radix UI primitives), **React Query**, **Framer Motion**, **React Router v6**, **Recharts**.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit `.env`: set JWT_SECRET, at least one LLM key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY),
# and Google IDs if you use Sign in with Google.

docker compose up --build
```

This starts all three services: Postgres, the FastAPI backend, and the Nginx-served frontend. For production deployments pointing at RDS instead of a local Postgres, set `POSTGRES_HOST` in `.env` to the RDS endpoint before starting.

After changing `VITE_GOOGLE_CLIENT_ID` or `VITE_API_URL`, rebuild the frontend image so Vite embeds them (`docker compose build frontend` or `docker compose up --build`).

All supported variables are documented in `.env.example` (JWT lifetimes, CORS, Postgres, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_API_URL`, `APP_ENV`, cookie settings).

- API: `http://localhost:8000` (e.g. `GET /health`)
- UI: `http://localhost:5173`
- OpenAPI: `http://localhost:8000/docs`

The database schema is managed by **Alembic migrations**. The backend container runs `alembic upgrade head` automatically before starting Uvicorn (see `backend/Dockerfile`).

## Connecting to the PostgreSQL database

The `db` service exposes port `5432` on localhost. Default credentials (overridable via `.env`):

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| User | `buddy360` |
| Password | `buddy360_dev` |
| Database | `buddy360` |

**Option 1 — `psql` inside the container (no extra tools needed):**

```bash
docker compose exec db psql -U buddy360 -d buddy360
```

Useful `psql` commands: `\dt` (list tables), `\d <table>` (describe table), `\q` (quit).

**Option 2 — any PostgreSQL client from the host:**

```bash
psql -h localhost -p 5432 -U buddy360 -d buddy360
# Password: buddy360_dev
```

GUI tools (TablePlus, DBeaver, pgAdmin) work too — use the same host/port/credentials above.

**Useful SELECT queries:**

```sql
-- All registered users
SELECT id, email, full_name, role, created_at FROM users ORDER BY created_at DESC;

-- Onboarding state per user (join to see email alongside)
SELECT u.email, o.phase, o.child_name, o.child_age, o.updated_at
FROM user_onboarding o
JOIN users u ON u.id = o.user_id
ORDER BY o.updated_at DESC;

-- Personality profiles
SELECT u.email, p.personality_type, p.profile_name, p.category, p.updated_at
FROM user_personality p
JOIN users u ON u.id = p.user_id;

-- Completed growth areas per user
SELECT u.email, c.area_name, c.area_color, c.created_at
FROM completed_growth_areas c
JOIN users u ON u.id = c.user_id
ORDER BY c.created_at DESC;

-- Children profiles (payload is JSON — cast to text for a quick look)
SELECT u.email, ch.id AS child_id, ch.payload::text, ch.created_at
FROM children ch
JOIN users u ON u.id = ch.user_id;

-- Growth missions for a specific child
SELECT gm.id, gm.payload::text, gm.created_at
FROM growth_missions gm
WHERE gm.child_id = '<child_id>';

-- Active refresh tokens
SELECT rt.user_id, u.email, rt.expires_at
FROM refresh_tokens rt
JOIN users u ON u.id = rt.user_id
WHERE rt.expires_at > now()
ORDER BY rt.expires_at DESC;
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

- Start PostgreSQL and set `DATABASE_URL` (or the discrete `POSTGRES_*` vars) to point to it. For a local-only backend without PostgreSQL, `DATABASE_URL=sqlite:///./buddy360.db` (the default in `backend/.env.example`) works.
- Backend:
  ```bash
  cd backend
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  set -a && source ../.env && set +a
  alembic upgrade head
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
- `GET /auth/me` — return current user (`id`, `email`, `full_name`, `role`)

Protected routes require `Authorization: Bearer <access_token>`.

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
- `GET /growth-missions?child_id=` — list missions for a child
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

Routes are PascalCase (as registered in `pages.config.js`). `/` renders the `mainPage` which is currently set to `Onboarding`.

| Route | Page |
|---|---|
| `/Login` | Login (email/password + Google) |
| `/Register` | Register |
| `/` → `/Onboarding` | Conversational onboarding + personality analysis (main landing page) |
| `/Home` | Home |
| `/GoalsDashboard` | Goals dashboard |
| `/LifePathway` | Life pathway / recommendations |

## Infrastructure

The infrastructure is split across two independent Terraform modules with separate state files. This allows the application infra to be created and destroyed freely while the database persists untouched.

```
infra-db/terraform/   ← permanent  — VPC, subnets, RDS (never destroy)
infra/terraform/      ← ephemeral  — EC2, ALB, Route 53 (create/destroy freely)
```

The app infra reads VPC and subnet IDs from the DB infra's remote state, so **`infra-db` must be applied before `infra`**.

### `infra-db/terraform/` — database and network layer

| Resource | Detail |
|---|---|
| VPC | Configurable CIDR, shared by both infra modules |
| Public subnets ×2 | One per AZ — used by EC2 and ALB (owned here, consumed by app infra) |
| Private subnets ×2 | One per AZ — RDS only, no internet route |
| Internet Gateway | For public subnets |
| RDS instance | PostgreSQL 16, `db.t3.micro`, 25 GiB gp3, single AZ, private subnets only |
| RDS security group | Inbound port 5432 from VPC CIDR only — not publicly accessible |
| DB subnet group | Spans both private subnets (required by RDS even for single-AZ) |
| Secrets Manager | Auto-created by RDS for the master password (`manage_master_user_password = true`) |

**Retrieving the generated password** after first apply:
```bash
aws secretsmanager get-secret-value \
  --secret-id $(terraform -chdir=infra-db/terraform output -raw rds_secret_arn) \
  --query SecretString --output text
```
The JSON response contains `username` and `password`. Store `password` as the `POSTGRES_PASSWORD` GitHub secret.

### `infra/terraform/` — application layer

| Resource | Detail |
|---|---|
| EC2 | Ubuntu 24.04 LTS (AMI auto-resolved from SSM), `t3.small` default, SSM agent via userdata |
| ALB | HTTPS port 443 (TLS 1.3); HTTP → HTTPS redirect; `/api/*` → backend, all else → frontend |
| Route 53 | A-alias record → ALB. FQDN: `{subdomain}-{env}.{domain_name}` for non-prod (e.g. `app-dev.example.com`), `{subdomain}.{domain_name}` for prod (e.g. `app.example.com`) |
| ACM | Certificate referenced by ARN (must already exist) |
| IAM | EC2 instance profile with `AmazonSSMManagedInstanceCore` |

VPC and subnet IDs are read from `infra-db` remote state — no networking resources are created here.

### Prerequisites

One-time setup before running either module:

1. **Terraform CLI >= 1.13.0** — both modules require it. S3 backend uses `use_lockfile = true` (no DynamoDB needed).
2. **S3 state bucket** — update `bucket` and `region` in both [`infra-db/terraform/provider.tf`](infra-db/terraform/provider.tf) and [`infra/terraform/provider.tf`](infra/terraform/provider.tf) to your own bucket. The state `key` is **not** hardcoded — it is passed at `terraform init` via `-backend-config`, which gives full isolation per environment and region. State key pattern: `terraform-state-files/buddy360/{env}/{module}/{region}/terraform.tfstate`. Also update the `bucket` in [`infra/terraform/data.tf`](infra/terraform/data.tf) — it reads the infra-db state via `var.db_state_key`, which is set automatically by the workflow.
3. **Route 53 hosted zone** — note the zone ID (needed by app infra only).
4. **ACM certificate** — provision in the deployment region and note the ARN (needed by app infra only). The certificate must cover all environment subdomains you plan to use. A **wildcard cert** (`*.example.com`) is the simplest option — one ARN covers `app-dev.example.com`, `app-stg.example.com`, and `app.example.com`. Alternatively use a SAN cert listing each FQDN explicitly, or a separate cert per environment (one `ACM_CERTIFICATE_ARN` secret per GitHub environment).
5. **IAM OIDC role** — one-time manual step; see the GitHub Actions section below.

### Local usage

```bash
# ── Step 1: apply DB infra first (once, then leave it alone) ──────────────
cd infra-db/terraform
# Update provider.tf with your S3 bucket name, then:
terraform init -backend-config="key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate"
cp dev.tfvars.example terraform.tfvars   # edit as needed
terraform apply -var-file=terraform.tfvars

# Note the outputs — you'll need rds_endpoint and rds_secret_arn
terraform output

# ── Step 2: apply app infra (create/destroy as needed) ───────────────────
cd infra/terraform
# Update provider.tf with your S3 bucket name, then:
terraform init \
  -backend-config="key=terraform-state-files/buddy360/dev/app/ap-south-1/terraform.tfstate"
cp dev.tfvars.example terraform.tfvars   # set allowed_ssh_cidr, domain vars
# db_state_key must point to the infra-db state applied in Step 1
terraform apply \
  -var="db_state_key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate" \
  -var-file=terraform.tfvars

# To tear down app infra without touching the DB:
terraform destroy \
  -var="db_state_key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate" \
  -var-file=terraform.tfvars
```

### Variables

**`infra-db`** — required (no default):

| Variable | Description |
|---|---|
| `aws_region` | AWS region |
| `environment` | e.g. `dev` |

All others have defaults (see [`infra-db/terraform/variables.tf`](infra-db/terraform/variables.tf)): VPC/subnet CIDRs, RDS identifier, db name, username (`postgre`), instance class, storage, deletion protection.

**`infra`** — required (no default):

| Variable | How to supply |
|---|---|
| `aws_region` | workflow input or `TF_VAR_aws_region` |
| `allowed_ssh_cidr` | your IP in CIDR notation, e.g. `1.2.3.4/32` |
| `domain_name` | root domain, e.g. `example.com` |
| `subdomain` | subdomain prefix, e.g. `app` |
| `hosted_zone_id` | Route 53 hosted zone ID |
| `acm_certificate_arn` | ACM certificate ARN |

## GitHub Actions

Three manually triggered workflows under [`.github/workflows/`](.github/workflows/). All authenticate to AWS via **OIDC** — no long-lived access keys are stored anywhere in GitHub.

### One-time AWS setup: GitHub OIDC identity provider

This needs to be done once per AWS account before any of the three workflows can run.

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
4. Add a condition to scope the role to your repository:
   - Condition key: `token.actions.githubusercontent.com:sub`
   - Condition operator: `StringLike`
   - Value: `repo:YOUR_GITHUB_ORG/buddy-app:*`

   > If you configure separate GitHub environments (`dev`, `stg`, `prod`) and want each to use a different role, use `repo:YOUR_GITHUB_ORG/buddy-app:environment:dev` instead of the wildcard.

5. Click **Next**, then attach the permissions policy (see Step 3).
6. Name the role (e.g. `buddy360-github-actions-role`) and create it.
7. Copy the **Role ARN** — this becomes the `ROLE_ARN` secret in GitHub.

**Step 3 — Attach a permissions policy**

The `terraform-db.yml` workflow provisions VPC and RDS. The `terraform.yml` workflow provisions EC2, ALB, Route 53, and IAM (it reads VPC/subnets from the DB infra remote state — it does not create networking resources). The `deploy.yml` workflow describes EC2 instances and sends SSM Run Commands.

**Option A — Quick setup (suitable for personal/dev accounts):** attach the `AdministratorAccess` managed policy and skip the custom policy below.

**Option B — Scoped policy:** create a new inline or managed policy with the following and attach it to the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TerraformStateBackend",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::YOUR_STATE_BUCKET",
        "arn:aws:s3:::YOUR_STATE_BUCKET/*"
      ]
    },
    {
      "Sid": "TerraformInfra",
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "elasticloadbalancing:*",
        "route53:*",
        "iam:GetRole", "iam:CreateRole", "iam:DeleteRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
        "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile",
        "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
        "iam:GetInstanceProfile", "iam:PassRole",
        "ssm:GetParameter"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Deploy",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ssm:SendCommand",
        "ssm:GetCommandInvocation"
      ],
      "Resource": "*"
    }
  ]
}
```

Replace `YOUR_STATE_BUCKET` with the S3 bucket name used in [`provider.tf`](infra/terraform/provider.tf).

### `terraform-db.yml` — database and network layer

Triggered via **Actions → Terraform DB → Run workflow**. Manages `infra-db/terraform/`. Apply once to create, then leave it alone. Workflow inputs (action, environment, aws_region) are similar to `terraform.yml`, with the only secret required being `ROLE_ARN` — no domain, certificate, or SSH variables needed. Available actions: `plan`, `apply`, `plan-destroy`, `destroy`.

### `terraform.yml` — application layer

Triggered via **Actions → Terraform → Run workflow**. Manages `infra/terraform/`. Safe to apply and destroy repeatedly. Inputs:

| Input | Options | Default |
|---|---|---|
| `action` | `plan`, `apply`, `destroy` | `plan` |
| `environment` | `dev`, `stg`, `prod` | `dev` |
| `aws_region` | `ap-south-1` | `ap-south-1` |

Concurrency is locked per `environment + region` so two runs never modify the same state simultaneously.

> **Order matters:** run `terraform-db.yml apply` before `terraform.yml apply`. The app infra reads VPC and subnet IDs from the DB infra remote state.

### `deploy.yml` — application deployment

Triggered via **Actions → Deploy → Run workflow**. Inputs: `environment`, `aws_region`.

The workflow:
1. Assumes the OIDC role and finds the running EC2 instance by tag (`Name=buddy360-ec2`, `Environment=<env>`).
2. Sends an SSM Run Command that: git-clones or git-pulls the repo, writes `/home/ubuntu/buddy-app/.env` from secrets, then runs `docker compose down && docker compose up --build -d`.
3. Polls the SSM command status (up to 10 minutes) and prints stdout/stderr on completion.

> **If you fork this repo**, update the `GH_REPO_OWNER` and `GH_REPO_NAME` GitHub secrets to point to your own repository before running the workflow.

### Required GitHub secrets

Configure these under **Settings → Environments → `<env>` → Secrets** (one set per environment: `dev`, `stg`, `prod`).

**AWS / infra secrets** (`terraform.yml` requires all; `terraform-db.yml` and `deploy.yml` only require `ROLE_ARN`):

| Secret | Value |
|---|---|
| `ROLE_ARN` | ARN of the IAM OIDC role GitHub Actions assumes |
| `DOMAIN_NAME` | Root domain, e.g. `example.com` |
| `SUBDOMAIN` | Subdomain prefix, e.g. `app` |
| `HOSTED_ZONE_ID` | Route 53 hosted zone ID |
| `ACM_CERTIFICATE_ARN` | ACM certificate ARN |
| `ALLOWED_SSH_CIDR` | Your IP in CIDR notation for EC2 SSH access |

**Application secrets** (used by `deploy.yml` to write `.env` on EC2):

| Secret | Value |
|---|---|
| `APP_ENV` | Deployment environment — `local` (default), `dev`, `stg`, or `prod`. Affects JWT validation strictness and cookie behavior. |
| `JWT_SECRET` | Long random string (min 32 chars; min 64 in production) — generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web client ID (leave empty to disable Google Sign-In) |
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID` |
| `VITE_API_URL` | Frontend API base URL (optional — if empty, the client uses relative paths) |
| `CORS_ORIGINS` | Comma-separated allowed origins, e.g. `https://app.example.com` |
| `COOKIE_DOMAIN` | Cookie domain (optional — only set when auth cookies must span subdomains, e.g. `.example.com`) |
| `OPENAI_API_KEY` | OpenAI key (optional — leave empty if not using OpenAI) |
| `OPENAI_MODEL` | e.g. `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Anthropic key (optional) |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-6` |
| `GEMINI_API_KEY` | Google Gemini key (optional) |
| `GEMINI_MODEL` | e.g. `gemini-1.5-flash` |
| `POSTGRES_HOST` | RDS endpoint — from `terraform output rds_endpoint` in `infra-db/terraform/` |
| `POSTGRES_USER` | Master username — `postgre` (default) |
| `POSTGRES_PASSWORD` | Retrieved from Secrets Manager after first `terraform-db apply` (see above) |
| `POSTGRES_DB` | Database name — `buddy360` (default) |
| `GH_PAT` | Fine-grained personal access token for cloning this repo onto EC2 (see below) |
| `GH_REPO_OWNER` | GitHub username or org that owns the repository, e.g. `pkprincekumar7` |
| `GH_REPO_NAME` | Repository name, e.g. `buddy-app` |

**Generating `GH_PAT`:**

The deploy workflow clones this repository directly onto the EC2 instance via SSM. A fine-grained PAT with read-only access allows the repo to stay **private at all times** — no need to make it public during deploys.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Click **Generate new token**.
3. Set a token name (e.g. `buddy360-deploy`) and an expiration.
4. Under **Resource owner**, select your account or org.
5. Under **Repository access**, choose **Only select repositories** and select `buddy-app`.
6. Under **Permissions → Repository permissions**, set **Contents** to **Read-only**.
7. Click **Generate token** and copy the value immediately — it is only shown once.
8. Store it as the `GH_PAT` secret under **Settings → Environments → `<env>` → Secrets**.

At least one of the three LLM API keys must be set to enable LLM features.

## Operational workflow

### Apply (first time or after a full destroy)

Follow these steps **in order**. Skipping or reordering will break the deploy.

**Step 1 — Apply database infra**

Via GitHub Actions: **Actions → Terraform DB → Run workflow** → action: `plan`, then `apply`.

Or locally:
```bash
cd infra-db/terraform
terraform init -backend-config="key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate"
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

**Step 2 — Set `POSTGRES_HOST` and `POSTGRES_PASSWORD` GitHub secrets**

After `infra-db` apply completes, retrieve the RDS endpoint and generated password, then store both as GitHub environment secrets before proceeding.

```bash
# Get RDS endpoint → set as POSTGRES_HOST secret
terraform -chdir=infra-db/terraform output -raw rds_endpoint

# Get generated password → set as POSTGRES_PASSWORD secret
aws secretsmanager get-secret-value \
  --secret-id $(terraform -chdir=infra-db/terraform output -raw rds_secret_arn) \
  --query SecretString --output text
# The JSON response contains "username" and "password" — copy the "password" value.
```

Go to **GitHub → Settings → Environments → `<env>` → Secrets** and set:
- `POSTGRES_HOST` → value from `rds_endpoint` output
- `POSTGRES_PASSWORD` → `password` field from the Secrets Manager JSON above

> This step is required on every fresh `infra-db` apply (i.e. after a full destroy + re-apply), because a new RDS instance generates a new password.

**Step 3 — Apply application infra**

Via GitHub Actions: **Actions → Terraform → Run workflow** → action: `plan`, then `apply`.

Or locally:
```bash
cd infra/terraform
terraform init -backend-config="key=terraform-state-files/buddy360/dev/app/ap-south-1/terraform.tfstate"
terraform plan -var="db_state_key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate" -var-file=terraform.tfvars
terraform apply -var="db_state_key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate" -var-file=terraform.tfvars
```

**Step 4 — Deploy**

Via GitHub Actions: **Actions → Deploy → Run workflow** → select environment and region.

---

### Destroy

Always destroy `infra` before `infra-db` — the app infra reads remote state from the DB infra, and reversing the order will leave orphaned resources or cause state errors.

**Step 1 — Destroy application infra** (safe, no data loss)

Via GitHub Actions: **Actions → Terraform → Run workflow** → action: `plan-destroy`, then `destroy`.

Or locally:
```bash
cd infra/terraform
terraform plan -destroy -var="db_state_key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate" -var-file=terraform.tfvars
terraform destroy -var="db_state_key=terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate" -var-file=terraform.tfvars
```

**Step 2 — Destroy database infra** (permanent data loss)

> **Warning:** this deletes the RDS instance and all data. In `dev`, `skip_final_snapshot = true` so no snapshot is taken. There is no recovery.

> **Prod only:** if `db_deletion_protection = true`, Terraform will refuse to destroy. First set `deletion_protection = false`, re-apply, then destroy.

Via GitHub Actions: **Actions → Terraform DB → Run workflow** → action: `plan-destroy`, then `destroy`.

Or locally:
```bash
cd infra-db/terraform
terraform plan -destroy -var-file=terraform.tfvars
terraform destroy -var-file=terraform.tfvars
```

---

## Cost estimates

Prices are **on-demand, us-east-1** (no reserved pricing). Assumes default instance sizes (`t3.small` EC2, `db.t3.micro` RDS) and minimal traffic.

### `infra/` — application layer

| Resource | Details | $/hr | $/month |
|---|---|---|---|
| EC2 `t3.small` | 1 instance, 2 vCPU / 2 GiB RAM | $0.0208 | $15.18 |
| ALB | Fixed charge (1 ALB, 2 AZs) | $0.0080 | $5.84 |
| ALB LCU | Variable — traffic-dependent; ~0 at idle, ~$5.84 at 1 avg LCU | $0.008+ | $5.84+ |
| EBS root vol | 8 GiB gp3 (default root volume) | $0.0009 | $0.64 |
| Route 53 A record | Hosted zone + queries | ~$0.0007 | ~$0.50 |
| **Total** | | **~$0.038/hr** | **~$28/month** |

### `infra-db/` — database layer

| Resource | Details | $/hr | $/month |
|---|---|---|---|
| RDS `db.t3.micro` | PostgreSQL 16, Single-AZ | $0.0170 | $12.41 |
| RDS Storage | 25 GiB gp3, encrypted | $0.0039 | $2.88 |
| RDS Backups | 7-day retention, ≤ 25 GiB | $0.0000 | Free |
| Secrets Manager | 1 auto-managed RDS secret | ~$0.0005 | $0.40 |
| **Total** | | **~$0.021/hr** | **~$15.69/month** |

### Combined

| | $/hr | $/month |
|---|---|---|
| `infra` (app + ALB) | ~$0.038 | ~$28.00 |
| `infra-db` (RDS) | ~$0.021 | ~$15.69 |
| **Grand total** | **~$0.059/hr** | **~$43.69/month** |

**Notes:**
- No NAT Gateway cost — EC2 is in a public subnet; RDS is private but only needs to accept traffic from EC2.
- ACM certificates, VPC, subnets, security groups, IAM, and Route tables are all free.
- Outbound data transfer beyond 100 GB/month costs $0.09/GiB and is not included above.
- Switching to **1-year Reserved Instances** (no upfront) cuts compute ~40%: EC2 t3.small → ~$0.0124/hr, RDS db.t3.micro → ~$0.0112/hr.

## Product notes

- **LLM providers**: do not commit keys. Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Auto-selection priority: OpenAI → Anthropic → Gemini. Model defaults: `gpt-4o-mini`, `claude-sonnet-4-6`, `gemini-1.5-flash` (override via `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`). Without any key, `POST /llm/invoke` returns `503`. Audio transcription still requires `OPENAI_API_KEY` (OpenAI Whisper).
- **Rate limiting**: `POST /auth/register` is capped at 5 requests/minute per IP; login and Google auth at 10/minute.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Requires `JWT_SECRET` and a valid `DATABASE_URL` if any test touches the DB.
