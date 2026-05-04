# Buddy360

A child development app for parents. Stack: **React 18 (Vite)**, **FastAPI**, **PostgreSQL**, optional **OpenAI** for LLM and audio transcription. Run everything with **Docker Compose** or the backend/frontend dev servers.

Frontend UI library: **Tailwind CSS** + **shadcn/ui** (Radix UI primitives), **React Query**, **Framer Motion**, **React Router v6**.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit `.env`: set JWT_SECRET, at least one LLM key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY),
# and Google IDs if you use Sign in with Google.
docker compose up --build
```

After changing `VITE_GOOGLE_CLIENT_ID`, rebuild the frontend image so Vite embeds it (`docker compose build frontend` or `docker compose up --build`).

All supported variables are documented in `.env.example` (JWT lifetimes, CORS, Postgres, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, optional `VITE_API_URL`).

- API: `http://localhost:8000` (e.g. `GET /health`)
- UI: `http://localhost:5173`
- OpenAPI: `http://localhost:8000/docs`

The database schema is created automatically on API startup (`Base.metadata.create_all`).

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

- Start PostgreSQL and set `DATABASE_URL` to it (not `db` as host).
- Backend: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && set -a && source ../.env && set +a && uvicorn app.main:app --reload`
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
- `POST /growth-missions` — create a mission
- `POST /growth-missions/bulk` — create multiple missions in one request
- `GET /growth-missions/{mission_id}` — get a single mission
- `PATCH /growth-missions/{mission_id}` — update a mission (AI insights are deep-merged)

**Parent insights** (`/api/v1/parent-insights/...`)
- `GET /parent-insights?child_id=` — list insights (supports `is_read` filter, `sort`, `limit`)
- `POST /parent-insights` — create an insight
- `PATCH /parent-insights/{insight_id}` — mark read/unread

**Reflections** (`/api/v1/reflections/...`)
- `GET /reflections?child_id=` — list reflections
- `POST /reflections` — create a reflection

**LLM** (`/api/v1/llm/...`)
- `POST /llm/invoke` — send a prompt to an LLM; optionally pass `response_json_schema` for structured JSON output and `provider` (`"openai"` | `"anthropic"` | `"gemini"`) to pin a specific model. Without `provider`, the server auto-selects the first configured key in priority order: OpenAI → Anthropic → Gemini. Returns 503 if no provider is configured.
- `GET /llm/providers` — returns which providers have a key configured and which would be auto-selected.

**Audio** (`/api/v1/audio/...`)
- `POST /audio/transcribe` — transcribe an uploaded audio file via OpenAI Whisper. Requires `OPENAI_API_KEY`.

**Health**
- `GET /health` — returns `{"status": "ok"}` (no auth)

## Frontend pages

Routes are PascalCase (as registered in `pages.config.js`). `/` renders the `mainPage` which is currently set to `Onboarding`.

| Route | Page |
|---|---|
| `/Login` | Login (email/password + Google) |
| `/Register` | Register |
| `/` → `/Onboarding` | Conversational onboarding + personality analysis (main landing page) |
| `/Home` | Home |
| `/ParentDashboard` | Parent dashboard (insights, growth roadmap, pillar progress) |
| `/GoalsDashboard` | Goals dashboard |
| `/LifePathway` | Life pathway / recommendations |
| `/Missions` | Weekly missions |
| `/ChildMode` | Child mode view |

## Infrastructure

Terraform configuration lives in [`infra/terraform/`](infra/terraform/). The EC2 bootstrap script is at [`infra/userdata/install.sh`](infra/userdata/install.sh).

### What it provisions

| Resource | Detail |
|---|---|
| VPC | Configurable CIDR, 2 public subnets across 2 AZs |
| EC2 | Ubuntu, configurable instance type (default `t2.small`), SSM agent installed via userdata |
| ALB | HTTPS on port 443 (TLS 1.3); HTTP → HTTPS redirect; `/api/*` forwarded to backend, everything else to frontend |
| Route 53 | A-alias record `{subdomain}.{domain_name}` → ALB |
| ACM | Certificate referenced by ARN (must already exist) |
| IAM | EC2 instance profile with `AmazonSSMManagedInstanceCore` (allows SSM agent and deploy workflow to reach the instance) |
| EC2 AMI | Ubuntu 24.04 LTS — resolved automatically from AWS SSM Parameter Store at plan time; no hardcoded AMI ID |

### Prerequisites

Before running Terraform for the first time:

1. **Terraform CLI >= 1.13.0** — required by `provider.tf`. The S3 backend uses `use_lockfile = true` for native state locking (no DynamoDB table needed).
2. **S3 state bucket** — the backend is configured in [`provider.tf`](infra/terraform/provider.tf). Update the `bucket`, `key`, and `region` values to match your own bucket before running `terraform init`.
3. **Route 53 hosted zone** — your domain must already have a hosted zone in Route 53. Note the zone ID.
4. **ACM certificate** — provision a certificate for `{subdomain}.{domain_name}` in the same AWS region you are deploying to. Note the ARN.
5. **IAM OIDC role for GitHub Actions** — this is a manual one-time step (see the GitHub Actions section below). Terraform does not create this role.

### Variables

Required variables with no default (must be supplied):

| Variable | How to supply |
|---|---|
| `aws_region` | workflow input or `TF_VAR_aws_region` |
| `allowed_ssh_cidr` | your IP in CIDR notation, e.g. `1.2.3.4/32` |
| `domain_name` | root domain, e.g. `example.com` |
| `subdomain` | subdomain prefix, e.g. `app` |
| `hosted_zone_id` | Route 53 hosted zone ID |
| `acm_certificate_arn` | ACM certificate ARN |

Optional variables have sensible defaults (see [`variables.tf`](infra/terraform/variables.tf)):
`app_name` (`buddy`), `environment`, `instance_type` (`t2.small`), VPC and subnet CIDRs.

### Local usage

```bash
cd infra/terraform

# 1. Update provider.tf with your S3 backend bucket details, then:
terraform init

# 2. Copy the example vars file and fill in your values
cp dev.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set allowed_ssh_cidr to your IP;
# domain_name, subdomain, hosted_zone_id, acm_certificate_arn via env vars or tfvars

terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

## GitHub Actions

Two manually triggered workflows under [`.github/workflows/`](.github/workflows/). Both authenticate to AWS via **OIDC** — no long-lived access keys are stored anywhere in GitHub.

### One-time AWS setup: GitHub OIDC identity provider

This needs to be done once per AWS account before either workflow can run.

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
6. Name the role (e.g. `buddy-github-actions-role`) and create it.
7. Copy the **Role ARN** — this becomes the `ROLE_ARN` secret in GitHub.

**Step 3 — Attach a permissions policy**

The `terraform.yml` workflow provisions VPC, EC2, ALB, Route 53, IAM, and reads SSM Parameter Store for AMIs. The `deploy.yml` workflow describes EC2 instances and sends SSM Run Commands.

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
        "ssm:SendCommand",
        "ssm:GetCommandInvocation"
      ],
      "Resource": "*"
    }
  ]
}
```

Replace `YOUR_STATE_BUCKET` with the S3 bucket name used in [`provider.tf`](infra/terraform/provider.tf).

### `terraform.yml` — infrastructure management

Triggered via **Actions → Terraform → Run workflow**. Inputs:

| Input | Options | Default |
|---|---|---|
| `action` | `plan`, `apply`, `destroy` | `plan` |
| `environment` | `dev`, `stg`, `prod` | `dev` |
| `aws_region` | `ap-south-1` | `ap-south-1` |

Concurrency is locked per `environment + region` so two runs never modify the same state simultaneously.

### `deploy.yml` — application deployment

Triggered via **Actions → Deploy → Run workflow**. Inputs: `environment`, `aws_region`.

The workflow:
1. Assumes the OIDC role and finds the running EC2 instance by tag (`Name=buddy-ec2`, `Environment=<env>`).
2. Sends an SSM Run Command that: git-clones or git-pulls the repo, writes `/home/ubuntu/buddy-app/.env` from secrets, then runs `docker compose down && docker compose up --build -d`.
3. Polls the SSM command status (up to 10 minutes) and prints stdout/stderr on completion.

> **If you fork this repo**, update the hardcoded clone URL in [`deploy.yml`](.github/workflows/deploy.yml) (the `git clone` line) to point to your own repository before running the workflow.

### Required GitHub secrets

Configure these under **Settings → Environments → `<env>` → Secrets** (one set per environment: `dev`, `stg`, `prod`).

**AWS / infra secrets** (used by both workflows):

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
| `JWT_SECRET` | Long random string (min 32 chars) — generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web client ID (leave empty to disable Google Sign-In) |
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID` |
| `CORS_ORIGINS` | Comma-separated allowed origins, e.g. `https://app.example.com` |
| `OPENAI_API_KEY` | OpenAI key (optional — leave empty if not using OpenAI) |
| `OPENAI_MODEL` | e.g. `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Anthropic key (optional) |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-6` |
| `GEMINI_API_KEY` | Google Gemini key (optional) |
| `GEMINI_MODEL` | e.g. `gemini-1.5-flash` |

At least one of the three LLM API keys must be set to enable LLM features.

## Product notes

- **LLM providers**: do not commit keys. Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Auto-selection priority: OpenAI → Anthropic → Gemini. Model defaults: `gpt-4o-mini`, `claude-sonnet-4-6`, `gemini-1.5-flash` (override via `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`). Without any key, `POST /llm/invoke` returns `503`. Audio transcription still requires `OPENAI_API_KEY` (OpenAI Whisper).
- **Rate limiting**: `POST /auth/register` is capped at 5 requests/minute per IP; login and Google auth at 10/minute.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Requires `JWT_SECRET` and a valid `DATABASE_URL` if any test touches the DB.
