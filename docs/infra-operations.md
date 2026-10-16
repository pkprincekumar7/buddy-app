# Infrastructure Operations

Day-2 reference for the live AWS stack: how the Terraform modules and workflows hand data to
each other, where state lives, what each workflow changes on ECS, how app secrets are managed,
and how hostnames are formed.

For the architecture and deployment sequence see
[infra-architecture-multi-region.md](infra-architecture-multi-region.md). For the resource
inventory see [aws-resources.md](aws-resources.md), and for workflows and GitHub secrets see
[ci-cd.md](ci-cd.md).

Placeholders used below: `{app}` = `APP_NAME` secret (e.g. `buddy360`), `{env}` = `dev` / `sbx` /
`stg` / `prod`, `{region}` = a backend region (`ap-south-1` / `eu-west-1` / `us-east-1`).

---

## SSM Parameter Store — cross-module hand-off

The modules and workflows never read each other's Terraform state. They exchange values through
SSM parameters that always live in **`us-east-1`**, whatever region the resource itself is in. The
backend module writes through an `aws.ssm` provider alias pinned to `us-east-1`, and every workflow
passes `--region us-east-1`.

### Parameters

| Parameter | Written by | Read by |
|---|---|---|
| `/{app}/{env}/backend/{region}/alb_internal_fqdn` | `infra-live-backend` (that region) | `infra-live-edge` (one CloudFront `/api/*` origin per region in `backend_regions`) |
| `/{app}/{env}/backend/{region}/ecr_repository_url` | `infra-live-backend` | `deploy-live-backend` (build job: push targets; deploy job: image URI) |
| `/{app}/{env}/backend/{region}/ecs_cluster_name` | `infra-live-backend` | `deploy-`, `promote-` and `restart-live-backend` |
| `/{app}/{env}/backend/{region}/ecs_service_name` | `infra-live-backend` | `deploy-`, `promote-` and `restart-live-backend` |
| `/{app}/{env}/backend/{region}/ecs_worker_service_name` | `infra-live-backend` | `deploy-`, `promote-` and `restart-live-backend` (worker) |
| `/{app}/{env}/edge/cloudfront_distribution_id` | `infra-live-edge` | `deploy-live-frontend`, `promote-live-frontend` (cache invalidation) |
| `/{app}/{env}/edge/cloudfront_arn` | `infra-live-edge` | `infra-live-frontend` (S3 bucket policy) |
| `/{app}/{env}/edge/s3_bucket_name` | `infra-live-edge` | `infra-live-frontend` (precondition check), `deploy-live-frontend`, `promote-live-frontend` |
| `/{app}/{env}/edge/app_url` | `infra-live-edge` | — (public URL, for reference) |
| `/{app}/{env}/edge/deployed_git_sha` | `deploy-live-frontend`, `promote-live-frontend` (target env) | `promote-live-frontend` (source env — the commit to rebuild) |

Notes:
- The backend parameters are per region, so `deploy-live-backend` only needs the region list to
  find every cluster and repository.
- `deployed_git_sha` is not Terraform-managed. `terraform-live-edge` deletes it explicitly on
  `destroy`.
- **Apply order follows these dependencies:** backend (every region), then edge, then frontend.
  **Destroy runs in reverse:** frontend, then edge, then backend. That way each consumer is gone
  before the parameters it reads are deleted. `terraform-live-all.yml` encodes both orders.

---

## Terraform state

All state lives in the `STATE_BUCKET` bucket (`us-east-1`), one key per module, environment and
(for the backend) region:

```
terraform-state-files/{app}/{env}/backend/{region}/terraform.tfstate
terraform-state-files/{app}/{env}/edge/us-east-1/terraform.tfstate
terraform-state-files/{app}/{env}/frontend/us-east-1/terraform.tfstate
terraform-state-files/{app}/{env}/scheduler/us-east-1/terraform.tfstate
```

Locking uses native S3 lock files (`use_lockfile = true`) — there is no DynamoDB table. Each
backend region has its own state, so regions can be applied in parallel (`terraform-live-all`
runs them as a matrix). The edge state is a single shared distribution per environment, which is
why edge always receives the **full** region list.

---

## ECS task definitions — what each workflow changes

Each backend region runs two ECS services: the API (`backend` container) and the job worker
(`worker` container, same image, `python worker.py`).

### `terraform-live-backend` (apply)

Terraform manages both task definitions as normal resources. Changing any of the following
registers a **new revision**:

| Category | Examples |
|---|---|
| Compute | CPU, memory |
| Plain env vars | `MONGODB_DB_NAME`, `*_MODEL`, `APP_ENV`, `REDIS_URL`, `LLM_TIMEOUT_SECONDS`, `LLM_HOURLY_LIMIT`, `ASSETS_BUCKET_NAME`, `CORS_ORIGINS` / `COOKIE_DOMAIN` (derived from `SUBDOMAIN` + env + `DOMAIN_NAME`) |
| Secret references | Secrets Manager ARN pointers (not values). API: `MONGODB_URI`, `JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, the three LLM keys, `REDIS_AUTH_TOKEN`. Worker: `MONGODB_URI`, `JWT_PRIVATE_KEY`, the three LLM keys. |
| Infrastructure | log group, health check, execution/task role, network mode |
| Image | always `:latest` — a placeholder; see below |

Both ECS **services** have `ignore_changes = [task_definition, desired_count]`. Terraform
therefore registers the new revision but never switches a service to it. The revision stays idle
until the next deploy.

### `deploy-live-backend`

Builds the image once, pushes it as `:<YYYYMMDD>-<short-sha>` to every selected region's ECR, then
in each region:

1. Reads the **latest active revision** of each task definition family, so it picks up anything
   `terraform apply` just registered.
2. Patches only the container `image` to the pushed tag, and registers a new revision.
3. Updates the service to that revision. This is a rolling deployment with circuit-breaker
   rollback, waiting up to 15 minutes for steady state.

Everything else (env vars, secret references, CPU/memory, roles) is carried over unchanged. The
`:latest` placeholder never runs after the first deploy.

`promote-live-backend` does the same, but takes the image from the source environment's running
task definition instead of building one. `restart-live-backend` forces a new deployment of the
current revision without registering one.

### Which workflow to run

| What changed | Run |
|---|---|
| Application code | `deploy-live-backend` |
| Env var / model / CPU / memory (tfvars or GitHub secrets that feed env vars) | `terraform-live-backend` apply, **then** `deploy-live-backend` (apply registers, deploy activates) |
| Secret values in Secrets Manager | `put-secret-value` (below), then `restart-live-backend` |

### Scaling

- **`desired_count` is ignored after the first apply.** A manual
  `aws ecs update-service --desired-count N` is never reverted, and a later `apply` won't restore
  it either. Scale back explicitly.
- **The API service is also under App Auto Scaling** (`api_min_capacity` / `api_max_capacity`,
  with CPU, memory and ALB-request target-tracking policies). Change its range through those
  tfvars, not just `desired_count`. The worker service is not autoscaled.

---

## Secrets Manager — app secrets

Each backend region has its own secret, `{app}/{env}/backend-secrets`, in that region. It's a JSON
object with `JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `MONGODB_URI` and `REDIS_AUTH_TOKEN`.

- **Created with placeholders.** Terraform writes `REPLACE_ME` for every key and then ignores
  the value (`ignore_changes = [secret_string]`).
- **Filled on the first apply only.** After `terraform apply`, `terraform-live-backend` reads
  the secret. If any **required** key (`JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`,
  `MONGODB_URI`, `REDIS_AUTH_TOKEN`) is still `REPLACE_ME`, it writes all keys from the GitHub
  environment secrets. Otherwise it leaves the secret alone, so manual rotations are never
  overwritten. `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` stay `REPLACE_ME` if unset; the app starts,
  but those providers are unavailable.
- **Hard-deleted on destroy.** `recovery_window_in_days = 0` means `terraform destroy` deletes
  the secret immediately, with no 30-day recovery window, so a re-apply doesn't hit a name clash.
  ⚠ This is irreversible — back up the values first.

### Rotating a value

After the first apply this is the only way to change a secret. **Repeat it for every active
backend region.** `put-secret-value` replaces the whole JSON, so send every key:

```bash
for region in ap-south-1 eu-west-1 us-east-1; do   # the regions this environment runs in
  aws secretsmanager put-secret-value \
    --region "$region" \
    --secret-id "{app}/{env}/backend-secrets" \
    --secret-string file://backend-secrets.json
done
```

Running tasks keep the old values until they restart. Run `restart-live-backend` (service `all`,
same region set) afterwards. Delete the local JSON file once done.

JWT key rotation has its own procedure, because the Lambda@Edge validator also holds the public
keys: see [jwt-keys.md](jwt-keys.md).

---

## DNS names

| Name | Pattern | Example (`SUBDOMAIN=buddy`, `DOMAIN_NAME=example.com`) |
|---|---|---|
| Public app URL (CloudFront, one per environment) | non-prod `{SUBDOMAIN}-{env}.{DOMAIN_NAME}` · prod `{SUBDOMAIN}.{DOMAIN_NAME}` | `buddy-dev.example.com` · `buddy.example.com` |
| Internal ALB (one per environment **and** region) | non-prod `{SUBDOMAIN}-internal-{env}-{region}.{DOMAIN_NAME}` · prod `{SUBDOMAIN}-internal-{region}.{DOMAIN_NAME}` | `buddy-internal-dev-ap-south-1.example.com` · `buddy-internal-eu-west-1.example.com` |

The region suffix on the internal name is required. Route 53 is a global namespace, so without it a
second region's record would collide with the first region's. CloudFront is the only intended
client of the internal ALB: the ALB accepts only CloudFront's origin-facing IP range, plus the
`X-Origin-Verify` header (`ORIGIN_VERIFY_SECRET`).
