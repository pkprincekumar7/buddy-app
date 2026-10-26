# Environments — adding and setting up an environment

How to add an environment (`dev`, `qa`, `stg`, `perf`, `sbx`, `prod`, …) so it never conflicts
with the others, no matter how environments are spread across AWS accounts and regions.

Read this top to bottom the first time. Afterwards, [Checklist](#9-checklist) is enough.

---

## 1. The model

| Concept | What it means here |
|---|---|
| **Environment** | One isolated copy of the whole stack (backend, worker, Redis, edge, frontend). Named by a short lowercase id: `dev`, `qa`, `prod`, … |
| **GitHub Environment** | One per environment (Settings → Environments), holding that environment's secrets. Every job that touches AWS binds to it, so it only ever sees its own secrets. |
| **AWS account** | Any number of environments can share one account (e.g. `dev`, `sbx`, `stg`, `qa`), or have their own (e.g. `prod`). Each environment talks only to the account its `ROLE_ARN` belongs to. |
| **Regions** | The backend runs as an independent stack per region (`ap-south-1`, `eu-west-1`, `us-east-1` — any subset). Edge (CloudFront, WAF, DNS, Lambda@Edge), frontend hosting and the scheduler always live in `us-east-1`. |

Everything Terraform creates is named from `APP_NAME` + environment (+ region where AWS names
are account-global), and every Terraform state file and SSM parameter path includes them too:

| Item | Pattern |
|---|---|
| Terraform state | `terraform-state-files/<APP_NAME>/<env>/<stack>/<region>/terraform.tfstate` |
| SSM hand-off parameters (always in `us-east-1`) | `/<APP_NAME>/<env>/backend/<region>/…`, `/<APP_NAME>/<env>/edge/…` |
| ECS / ECR / ALB / Redis | `<APP_NAME>-backend-…-<env>`, ECR repo `<APP_NAME>/<env>/backend` |
| MongoDB database | `<APP_NAME>-<env>` |
| Worker CloudWatch metrics | namespace `Superpower/Worker`, dimension `Environment=<env>` |

So two environments never collide on anything Terraform names — **as long as the rules in
[section 5](#5-rules-that-prevent-conflicts) are followed** for the things Terraform does *not*
create (buckets, hosted zones, certificates) and the few things AWS allows only once per account.

### Hostnames

`prod` is the only environment name without a suffix:

| | `prod` | any other environment (e.g. `qa`) |
|---|---|---|
| Public site (CloudFront) | `<SUBDOMAIN>.<DOMAIN_NAME>` | `<SUBDOMAIN>-qa.<DOMAIN_NAME>` |
| Internal backend ALB (one per region) | `<SUBDOMAIN>-internal-<region>.<DOMAIN_NAME>` | `<SUBDOMAIN>-internal-qa-<region>.<DOMAIN_NAME>` |

Example with `SUBDOMAIN=superpower`, `DOMAIN_NAME=example.com`, environment `qa`:
`superpower-qa.example.com` and `superpower-internal-qa-ap-south-1.example.com`.

---

## 2. Naming rules for a new environment

- Environment id: lowercase letters/digits, short (`qa`, `perf`, `uat`).
- `APP_NAME`: lowercase letters, digits and hyphens.
- **`APP_NAME` + environment id together must be at most 15 characters.** The longest AWS name
  is a target group, `<APP_NAME>-<service>-<env>-xxxx` (a 4-character hash, see `modules/alb`),
  with the longest service key, `onboarding`, and target group names have a 32-character limit.
  Terraform refuses a longer one at plan time. (`superpower` + `perf` = 14 ✓.)
- Only the literal name `prod` gets prod behaviour (bare hostname, no nightly-destroy schedule).
  Any other name is treated as non-prod.

---

## 3. Code changes to add a new environment name

`dev`, `sbx`, `stg` and `prod` already exist. For a new name (example: `qa`):

### 3.1 Workflow choice lists

Add `- qa` to the `environment` choice options in:

| File | Inputs to update |
|---|---|
| `.github/workflows/terraform-live-all.yml` | `environment` |
| `.github/workflows/terraform-live-backend.yml` | `environment` |
| `.github/workflows/terraform-live-edge.yml` | `environment` |
| `.github/workflows/terraform-live-frontend.yml` | `environment` |
| `.github/workflows/terraform-live-scheduler.yml` | `environment` |
| `.github/workflows/deploy-live-backend.yml` | `environment` |
| `.github/workflows/deploy-live-frontend.yml` | `environment` |
| `.github/workflows/restart-live-backend.yml` | `environment` |
| `.github/workflows/build-android-apk.yml` | `environment` |
| `.github/workflows/build-ios-ipa.yml` | `environment` |
| `.github/workflows/promote-live-backend.yml` | `source_env`, `target_env` **and** the allowed paths in the `Validate promotion direction` step |
| `.github/workflows/promote-live-frontend.yml` | `source_env`, `target_env` **and** the allowed paths in the `Validate promotion direction` step |

Promotion paths are an explicit allow-list (today: `dev↔sbx`, `dev→stg`, `sbx→stg`, `stg→prod`).
Add an `elif` for each new path you want, e.g. `dev→qa` and `qa→stg`, and update the error message.

### 3.2 Terraform environment validation

Add `"qa"` to the `contains([...], var.environment)` list of `variable "environment"` in:

- `infra-live-backend/terraform/variables.tf`
- `infra-live-edge/terraform/variables.tf`
- `infra-live-frontend/terraform/variables.tf`
- `infra-live-scheduler/terraform/variables.tf`

### 3.3 tfvars — one file per stack

Copy the closest existing environment and adjust:

| New file | Start from |
|---|---|
| `infra-live-backend/terraform/tfvars/qa.tfvars` | `dev.tfvars` (cheap) or `stg.tfvars` (prod-like) |
| `infra-live-edge/terraform/tfvars/qa.tfvars` | same choice |
| `infra-live-frontend/terraform/tfvars/qa.tfvars` | any (no per-env values today) |
| `infra-live-scheduler/terraform/tfvars/qa.tfvars` | any (schedule times / timezone) |

Settings that matter (backend):

| Setting | Notes |
|---|---|
| `vpc_cidrs` | A map with one `/16` **per region** for this environment, listing all three regions even if not deployed yet, so each block is reserved. Pattern: `10.<base>`, `10.<base+1>`, `10.<base+2>` for ap-south-1, eu-west-1, us-east-1 (existing bases: dev `2`, stg `12`, prod `22`, sbx `32`), e.g. qa `10.42`/`10.43`/`10.44`. Every (environment, region) pair must be unique so VPCs can be peered later (NET-01). Values must be `10.x.0.0/16`; Terraform checks the shape and per-environment uniqueness. Subnets are derived in `modules/network` (public `/24` ×3, private `/20` ×3), not configured. |
| `nat_gateway_count` | 1–3. Each NAT uses one Elastic IP — counts toward the account's per-region EIP quota (section 5). |
| `elasticache_node_type`, `elasticache_replica_count`, `elasticache_multi_az` | `multi_az = true` needs `replica_count >= 1`. |
| `runtime_sizes` | CPU, memory, desired count and the autoscaling range for each of the five tiers (`http`, `auth`, `worker`, `generating-worker`, `collector`); every one of the 18 runtimes uses one tier (`services.tf`). All of them count toward the account's Fargate vCPU quota (section 5). dev/sbx run every tier at 256 / 512 × 1; prod runs one task per worker. |
| `mongodb_max_pool_size` | MongoDB connections per task (default 5). Multiply by every task in the environment to stay under the Atlas cluster's connection limit. |
| `service_token_key_versions` | Per service, the version of its service-token key pair (default 1). Bump one to rotate that key. |
| `enable_guardduty` | **See section 5 — at most one environment per AWS account.** |
| `enable_cloudtrail`, `enable_alb_access_logs` | Write to that region's `REGIONAL_LOGGING_BUCKET_NAMES` entry. |
| `enable_basic_alarms`, `enable_all_alarms`, `enable_dashboard`, `xray_default_sampling_rate` | Observability level, and the share of ordinary traces the collector keeps (errors and slow traces are always kept). |
| `enable_ops_email` | `true` requires the `OPS_EMAIL` variable. |
| `enable_execute_command` | ECS Exec shell access (keep `false` for prod-like data). |

Settings that matter (edge):

| Setting | Notes |
|---|---|
| `enable_guardduty` | Same rule as backend — section 5. |
| `enable_cloudtrail` | Needs `GLOBAL_LOGGING_BUCKET_NAME`. |
| `enable_waf`, `enable_waf_logging` | `enable_waf_logging` needs `enable_waf` and `GLOBAL_LOGGING_BUCKET_NAME`. |
| `cloudfront_price_class` | `PriceClass_100` (cheap) or `PriceClass_All`. |

Run `terraform fmt -recursive` and commit.

---

## 4. Per-account AWS setup (once per account)

Do this once in every AWS account that hosts at least one environment.

1. **GitHub OIDC identity provider** — IAM → Identity providers → Add provider:
   Provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. **Deploy role** — IAM → Roles → Create role → Web identity → that provider, audience
   `sts.amazonaws.com`. Restrict the trust policy's `token.actions.githubusercontent.com:sub`
   (operator `StringLike`) to exactly the environments living in this account, e.g.
   - shared account: `repo:<owner>/buddy-app:environment:dev`, `…:environment:sbx`,
     `…:environment:stg`, `…:environment:qa`
   - prod account: `repo:<owner>/buddy-app:environment:prod`

   Attach `AdministratorAccess` (or a scoped policy covering ECS, ECR, ELB, EC2/VPC, ElastiCache,
   CloudFront, WAF, Lambda, S3, Route 53, ACM, Secrets Manager, SSM, IAM, CloudWatch, SNS,
   X-Ray, GuardDuty, CloudTrail, Kinesis Firehose, EventBridge Scheduler). Its ARN is the
   `ROLE_ARN` variable of every environment in this account.
3. **Terraform state bucket** in `us-east-1` (versioning on). One per account is enough —
   state keys already include `APP_NAME` and environment. Its name is the `STATE_BUCKET` variable.
4. **Service quotas** (Service Quotas console, per region) — see section 5 for what to sum.

---

## 5. Rules that prevent conflicts

These are the only things that can collide. Everything else is unique by name automatically.

### Must be unique per environment

| Thing | Rule | Why |
|---|---|---|
| S3 buckets: `ASSETS_BUCKET_NAME`, `SPA_BUCKET_NAME`, the `UPLOADS_BUCKET_NAMES` entries | Never share between environments. | The edge/frontend stacks replace the bucket's whole policy with one that trusts only this environment's CloudFront — a shared bucket breaks the other environment with 403s. |
| `GLOBAL_LOGGING_BUCKET_NAME` | Must differ from that environment's `us-east-1` entry in `REGIONAL_LOGGING_BUCKET_NAMES`. | Both stacks replace that bucket's policy; the edge one has no ALB-log grant. |
| `DOMAIN_NAME` + `SUBDOMAIN` + environment | Must produce hostnames no other environment uses. | CloudFront aliases are globally unique across all of AWS. |
| `MONGODB_URIS` / databases | Each service has its own database (named after the service) and its own Atlas user, per environment. | Shared data. |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEYS`, `ORIGIN_VERIFY_SECRET`, `EMAIL_HMAC_PEPPER` | Generate fresh per environment (the service-token keys are generated by Terraform per environment and region). | A token from one environment must not be valid in another. |

Each `REGIONAL_LOGGING_BUCKET_NAMES` entry follows the same rule for every environment that turns
on `enable_cloudtrail` or `enable_alb_access_logs` (its backend stack replaces that bucket's
policy). Environments that keep both off (e.g. dev) never touch their logging bucket, so those
may share one — but the secret must still be set (section 6).

### Must be in the same account as the environment's `ROLE_ARN`

| Thing | Rule |
|---|---|
| Route 53 hosted zone (`HOSTED_ZONE_ID`) | The zone for that environment's `DOMAIN_NAME` lives in the environment's own account — Terraform writes the public and internal records into it. A subdomain zone (e.g. `qa.example.com`) needs NS records in its parent zone. |
| ACM certificates | Certificates can't be shared across accounts. One in `us-east-1` (CloudFront, and the `us-east-1` ALB if that region is used) plus one in each other backend region. Each must cover the public hostname and that region's internal hostname (section 1) — a wildcard `*.<DOMAIN_NAME>` does. Validate them via DNS records in the hosted zone. |
| All S3 buckets above | Created in the environment's account; uploads and regional logging buckets in their own region, the others in `us-east-1`. |

### Allowed only once per AWS account

| Thing | Rule |
|---|---|
| **GuardDuty** | AWS allows one detector per account per region. **At most one environment per account may set `enable_guardduty = true`** (in both its backend and edge tfvars). The edge stack owns the `us-east-1` detector; the backend stack creates it in its other regions. Today: `stg` in the shared account, `prod` in the prod account. |
| OIDC provider | One per account (section 4). |

### Shared quotas (sum over every environment in the account, per region)

| Quota | Default | Sum of |
|---|---|---|
| Elastic IPs | 5 | `nat_gateway_count` of every environment in that region |
| VPCs | 5 | one per environment, plus the default VPC |
| Fargate On-Demand vCPU | account-specific (often low on new accounts) | Σ over the 18 runtimes of `min_capacity × cpu/1024` for its `runtime_sizes` tier, ×2 during rolling deploys (up to the `max_capacity` values when scaled out) |
| CloudTrail trails | 5 | environments with `enable_cloudtrail = true` (+1 in `us-east-1` for an edge trail) |

Raise anything that would exceed its quota **before** the first apply.

---

## 6. GitHub Environment variables and secrets

Create the GitHub Environment (Settings → Environments → New environment → `qa`) and add the following. Names, IDs and public values go in **Variables**; only credentials go in **Secrets**. See [ci-cd.md](ci-cd.md) for the full list.

### Variables — required for every environment

| Variable | Value |
|---|---|
| `ROLE_ARN` | Deploy role of the account this environment lives in (section 4) |
| `APP_NAME` | e.g. `superpower` (section 2 length rule) |
| `STATE_BUCKET` | State bucket of that account |
| `DOMAIN_NAME` | e.g. `example.com` |
| `SUBDOMAIN` | e.g. `superpower` |
| `HOSTED_ZONE_ID` | Route 53 zone of `DOMAIN_NAME`, in the same account |
| `ASSETS_BUCKET_NAME` | This environment's assets bucket (`us-east-1`) |
| `SPA_BUCKET_NAME` | This environment's frontend bucket (`us-east-1`) |
| `JWT_PUBLIC_KEYS` | Public key map matching `JWT_PRIVATE_KEY`, see [jwt-keys.md](jwt-keys.md). Required by the backend **and** edge workflows; must contain `JWT_KEY_ID`'s public key, because every service but auth verifies with these keys only (the backend workflow checks it matches `JWT_PRIVATE_KEY`) |
| `JWT_KEY_ID` | Optional, defaults to `key-v1` |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL` | All three |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID` |

### Secrets — required for every environment

| Secret | Value |
|---|---|
| `JWT_PRIVATE_KEY` | RSA private key, see [jwt-keys.md](jwt-keys.md) |
| `ORIGIN_VERIFY_SECRET` | Long random string with no `*` or `?` (the ALB treats them as wildcards), e.g. `openssl rand -hex 32` |
| `ORIGIN_VERIFY_SECRET_NEXT` | **Don't create it at setup.** Optional, set only during a rotation; see [infra-operations.md](infra-operations.md#rotating-the-origin-verify-secret) |
| `MONGODB_URIS` | JSON object, service → its own connection string (every service but shared), see [ci-cd.md](ci-cd.md) |
| `EMAIL_HMAC_PEPPER` | `openssl rand -hex 32`; back it up, and change it only by the versioned rotation in [auth-users-split.md](auth-users-split.md) 6.5 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | At least one |

### Required per backend region — environment **variables** (TF-01)

Under **Settings → Environments → `<env>` → Variables** (not Secrets): three JSON maps keyed by AWS region, each with an entry for every region the environment uses. See [ci-cd.md](ci-cd.md) for the details.

| Variable | Value |
|---|---|
| `ACM_CERTIFICATE_ARNS` | `{"ap-south-1": "arn:…", "us-east-1": "arn:…"}`: certificate per region. The `us-east-1` entry is **always** required, because CloudFront uses it too. |
| `UPLOADS_BUCKET_NAMES` | `{"ap-south-1": "<bucket>", …}`: this environment's uploads bucket per region |
| `REGIONAL_LOGGING_BUCKET_NAMES` | `{"ap-south-1": "<bucket>", …}`: logging bucket per region (required even if logging is off) |

### Conditional

| Name (kind) | When |
|---|---|
| `GLOBAL_LOGGING_BUCKET_NAME` (variable) | Always for `prod`; for others when edge `enable_cloudtrail` or `enable_waf_logging` is `true` |
| `OPS_EMAIL` (variable) | When backend `enable_ops_email = true`. Use a team address, since variables show in logs. |
| `GIT_ACTIONS_PAT` (secret) | When using the scheduler (`terraform-live-scheduler.yml`) — GitHub PAT with `repo` + `workflow` scopes |
| `IOS_CLIENT_ID`, `IOS_APPLE_TEAM_ID`, `IOS_CERTIFICATE_P12_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64` (secrets) | Only for building iOS IPAs (`build-ios-ipa.yml`) |

---

## 7. Outside AWS

| Where | What |
|---|---|
| Google Cloud → OAuth client (Web) | Add `https://<public hostname>` to **Authorized JavaScript origins**. |
| MongoDB Atlas | Create the database user / cluster for the environment, and allow the environment's NAT Elastic IPs (EC2 → Elastic IPs, after the backend apply) in **Network Access**. |

---

## 8. First provisioning

1. **Apply everything:** run `terraform-live-all.yml` with `action = apply`, the environment,
   its backend regions, and `deploy = true`. It runs backend (all regions in parallel) → edge →
   frontend → deploy backend → deploy frontend.

   Prefer to go step by step? Apply `terraform-live-backend.yml` per region, then
   `terraform-live-edge.yml`, then `terraform-live-frontend.yml`, then
   `deploy-live-backend.yml` and `deploy-live-frontend.yml`.
2. **Plans on a brand-new environment:** only the backend can be planned before anything is
   applied — edge and frontend skip their plan with a notice until the stack before them has
   been applied.
3. **Check:** open `https://<public hostname>`, sign in, and look at `/api/health`.
4. **Promotion:** once the environment has a running build, it can be the source or target of
   `promote-live-backend.yml` / `promote-live-frontend.yml` (for the paths added in 3.1). Each
   promotion reads the source with the source's `ROLE_ARN` and writes the target with the
   target's, so source and target may be in different accounts.
5. **Optional nightly start/stop** (non-prod only): run `terraform-live-scheduler.yml` with
   `schedule_enabled = true`. It can never be enabled for `prod`.

---

## 9. Checklist

**Code (new environment names only)**
- [ ] Environment added to the workflow choice lists (3.1), incl. promotion paths
- [ ] Environment added to the four Terraform `variable "environment"` lists (3.2)
- [ ] `tfvars/<env>.tfvars` for backend, edge, frontend, scheduler (3.3), with a `vpc_cidrs` map whose `/16`s don't overlap any other environment's

**AWS account (once per account)**
- [ ] OIDC provider and deploy role, trust limited to the account's environments (4)
- [ ] State bucket in `us-east-1` (4)
- [ ] Quotas fit the sum of all environments in the account (5)
- [ ] At most one environment with `enable_guardduty = true` in the account (5)

**Per environment**
- [ ] Hosted zone in the environment's account (5)
- [ ] ACM certificates in `us-east-1` and each backend region, covering public + internal names (5)
- [ ] Own buckets: assets, SPA, uploads per region, regional logging per region, global logging if needed (5)
- [ ] GitHub Environment with all secrets (6)
- [ ] Google OAuth origin and MongoDB Atlas access (7)
- [ ] `terraform-live-all.yml` apply with deploy (8)

Related: [ci-cd.md](ci-cd.md) (workflows and secret reference), [infra-operations.md](infra-operations.md)
(SSM hand-off, state paths, DNS names), [jwt-keys.md](jwt-keys.md).
