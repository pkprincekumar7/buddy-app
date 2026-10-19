# Infrastructure Operations

Day-2 reference for the live AWS stack: how the Terraform modules and workflows hand data to
each other, where state lives, what each workflow changes on ECS, how app secrets are managed,
how the main resources are configured, and how hostnames are formed.

For the architecture and deployment sequence see
[infra-architecture-multi-region.md](infra-architecture-multi-region.md). For the resource
inventory see [aws-resources.md](aws-resources.md), and for workflows and GitHub secrets see
[ci-cd.md](ci-cd.md).

Placeholders used below: `{app}` = `APP_NAME` secret (e.g. `superpower`), `{env}` = `dev` / `sbx` /
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
| `/{app}/{env}/backend/{region}/ecr_repository_url` | `infra-live-backend` | `deploy-live-backend` (build job: push targets; deploy job: image URI), `promote-live-backend` (target push) |
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
task definition instead of building one: an export job (source environment's role) pulls it, and
the promote job (target's role) pushes it into the target's own ECR under the same tag before
registering the revision. The target never references the source's ECR, so source and target can
be different AWS accounts, and the target is unaffected when the source repo expires the image or
the source environment is destroyed. `restart-live-backend` forces a new deployment of the
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

### Rotating the origin-verify secret

`ORIGIN_VERIFY_SECRET` is the `X-Origin-Verify` header CloudFront sends to every regional ALB.
Each ALB's listener rule 403s requests without it. It lives in two places only: the
`alb-backend` origin's `custom_header` (`infra-live-edge/terraform/cloudfront.tf`) and each
ALB's listener rule (`infra-live-backend/terraform/alb.tf`). The Lambda@Edge copies the header
from the origin config when it re-routes, so it's **not** in the function code and rotating it
needs no Lambda redeploy.

Rotation uses an optional second GitHub environment secret, `ORIGIN_VERIFY_SECRET_NEXT`:

| | ALB accepts | CloudFront sends |
|---|---|---|
| Normal | `ORIGIN_VERIFY_SECRET` | `ORIGIN_VERIFY_SECRET` |
| `_NEXT` set | `ORIGIN_VERIFY_SECRET` **or** `ORIGIN_VERIFY_SECRET_NEXT` | `ORIGIN_VERIFY_SECRET_NEXT` |

While `_NEXT` is set, `terraform-live-backend` and `terraform-live-edge` show a "rotation in
progress" warning on every run, so a half-finished rotation doesn't go unnoticed.

Steps, per environment:

1. **Add the new value.** Generate a long random string with no `*` or `?` (the ALB treats
   those as wildcards), e.g. `openssl rand -hex 32`. Save it as the `ORIGIN_VERIFY_SECRET_NEXT`
   environment secret.
2. **Let every ALB accept it.** Run `terraform-live-backend` (apply) for **every** region in
   the environment. Each listener rule now accepts both values.
3. **Switch CloudFront.** Run `terraform-live-edge` (apply) with the full `backend_regions`
   set and the **same `bootstrap_region`** as the last edge apply. (`bootstrap_region` applies
   per run: leaving it at `auto` when you'd named a region moves login to the first region in
   `backend_regions`.) CloudFront now sends the new value. Only do this once step 2 has
   finished in every region, or the regions you missed return 403. (`terraform-live-all` runs
   backend before edge, so one full-stack apply covers steps 2 and 3.)
4. **Wait for CloudFront.** Until the distribution's status is `Deployed`, some edge locations
   still send the old value. Check with
   `aws cloudfront get-distribution --id <id> --query Distribution.Status`.
5. **Promote it.** Set `ORIGIN_VERIFY_SECRET` to the new value and delete
   `ORIGIN_VERIFY_SECRET_NEXT`.
6. **Drop the old value.** Run `terraform-live-backend` (apply) for every region again. Each ALB
   now accepts only the new value. Order with the edge doesn't matter here: CloudFront already
   sends the new value either way.

The old value is still in older Terraform state versions (see SEC-01 in
[production-readiness-review.md](production-readiness-review.md)). Before EDGE-02, the secret
was also baked into the Lambda@Edge code, so **published function versions from before that
change still contain it.** Rotate once after deploying EDGE-02. You can only delete those old
versions once CloudFront no longer uses them and their edge replicas are gone, which can take
hours.

### Photo URLs (EDGE-05)

Child photos are private. The uploads bucket has Block Public Access on and **no** bucket policy:
nothing, not even CloudFront, can read it anonymously. Mongo stores only the S3 **key**
(`uploads/{location}/{child_id}/…`), and every API read returns an **S3 presigned GET URL**
(`https://{bucket}.s3.{region}.amazonaws.com/uploads/…?X-Amz-…`) valid for
`UPLOADS_URL_TTL_SECONDS` (default 1 h). The API fields keep their names (`avatar_url`,
`photos`) and stay URLs, so released mobile builds keep working. On PATCH the server accepts a
key or one of its own bucket URLs (as the client received it), keeps only the key, and rejects
anything outside that child's own prefix with 422 (APP-08).

- **Signed by** the API task role's own temporary credentials. There is no key pair, secret or
  rotation to manage; the role just needs `s3:GetObject` on `uploads/*` (`iam.tf`).
- **SigV4 only.** The API's S3 client forces SigV4 and the regional endpoint
  (`app/services/s3_uploads.py`), because botocore otherwise presigns with SigV2 in some regions,
  which S3 rejects for newer buckets.
- **Lifetime.** A URL can end before the TTL if the task role's credentials expire first. The SDK
  refreshes them shortly before expiry, so in the worst case a URL lives about 15 minutes. A
  screen left open past that shows a broken image until it refetches.
- **No caching across reads.** Each response gets a newly signed URL, so the browser downloads
  the photo again after each refetch. Photos are fetched straight from the regional bucket, not
  through CloudFront.
- **Deleted photos** stay reachable through an already-issued URL until it expires; after that
  no new URL can be minted, because the key is gone from the document. The S3 object itself is
  still not deleted (APP-07 / PRIV-02).
- **No setup step.** Environments start with a fresh database and uploads bucket, so there is
  nothing to migrate.

---

## Key resource settings

What [aws-resources.md](aws-resources.md) doesn't show: *how* the main resources are configured.
Values are per environment where they differ (`tfvars/<env>.tfvars` in each module).

### Edge — CloudFront (`infra-live-edge/terraform/cloudfront.tf`)

| Behaviour | Origin | Cache policy | Notes |
|---|---|---|---|
| Default `/*` | S3 frontend (OAC) | `CachingOptimized` | GET/HEAD/OPTIONS, compressed; full security response headers (HSTS 2 y + preload, CSP, frame options…); `spa-rewrite` CloudFront Function (viewer-request) |
| `/app-assets/*` | S3 assets bucket (OAC) | `CachingOptimized` | Static activity images; minimal headers (nosniff + HSTS) |
| `/api/*` | Regional ALB (chosen by Lambda@Edge, `origin-request`) | `CachingDisabled` | All methods, not compressed, `AllViewerExceptHostHeader`, its own security-headers policy; `origin_read_timeout = 60` s for slow LLM calls |

- **SPA fallback:** the `spa-rewrite` CloudFront Function (`infra-live-edge/functions/spa-rewrite.js`),
  on the **default behaviour only**. It rewrites a path to `/index.html` when its last segment has
  no `.` and it doesn't start with `/api/`, `/app-assets/`, `/assets/` or `/uploads/`. Everything
  else is served as-is: a missing frontend file is a real **404** (OAC has `s3:ListBucket`), and
  API 404s/403s reach the client untouched. There is no custom error page; the only
  `custom_error_response` sets `error_caching_min_ttl = 0` for 404s, so a chunk uploaded moments
  later isn't hidden behind a cached 404. A future client route with a `.` in its last segment,
  or a dotless file such as `/.well-known/apple-app-site-association`, needs an exception in the
  function.
- IPv6 on, `default_root_object = index.html`, minimum TLS `TLSv1.2_2021`.
- **Price class:** `PriceClass_100` in dev/sbx/stg, `PriceClass_All` in prod.

### Edge — WAF (`waf.tf`, **stg and prod only**; logging prod only)

| Priority | Rule | Action |
|---|---|---|
| 5 | Geo block — the blocked countries from `shared/routing.json` | Block (JSON `country_not_supported` body) |
| 10 | AWS Common Rule Set (OWASP-style) | Managed |
| 20 | AWS Known Bad Inputs | Managed |
| 30 | AWS IP Reputation List | Managed |
| 40 | Rate limit — 1,000 requests / 5 min per IP | Block |

### Backend (`infra-live-backend/terraform/`, per region)

| Resource | Setting |
|---|---|
| Networking | ECS tasks in **private** subnets (`assign_public_ip = false`); outbound via NAT (1 per region in dev/sbx, 2 stg, 3 prod); interface VPC endpoints (ECR, Secrets Manager, Logs, X-Ray) only when `nat_gateway_count > 1` |
| ALB | HTTPS 443 only, TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`; ingress only from CloudFront's origin-facing prefix list, plus the `X-Origin-Verify` header check; target health check `GET /health`, 200, every 30 s (5 s timeout, 2 healthy / 3 unhealthy) |
| ECS | Container Insights on; container health check `GET http://127.0.0.1:8000/health` (30 s, 3 retries, 60 s start period); circuit breaker with rollback; ECS Exec on in dev/sbx/stg, off in prod |
| ECR | `scan_on_push`, **immutable** tags, AES256; lifecycle keeps the newest 30 tagged images and expires untagged ones after 7 days |
| ElastiCache Redis 7.1 | At-rest encryption + TLS required + AUTH token (`REDIS_AUTH_TOKEN`); single node in dev/sbx/stg, 2 replicas with Multi-AZ failover in prod. Holds rate-limit counters and locks only |
| CloudWatch Logs | API and worker log groups, retention 7 d (dev/sbx), 30 d (stg), 90 d (prod) |

### Frontend deploy (`deploy-live-frontend.yml`)

1. Builds the React app (`VITE_API_URL` is baked in, derived from `SUBDOMAIN` + env + `DOMAIN_NAME`).
2. Syncs `dist/assets/` with `Cache-Control: public,max-age=31536000,immutable` (hashed files).
3. Syncs the rest (`index.html` …) with `no-cache,no-store,must-revalidate`; both syncs `--delete`.
4. Invalidates CloudFront `/*`, waits for completion, and records `deployed_git_sha` in SSM.

`infra-live-frontend`'s bucket policy has a precondition: apply fails if `spa_bucket_name` in its
tfvars differs from the bucket name `infra-live-edge` wrote to SSM.

---

## DNS names

| Name | Pattern | Example (`SUBDOMAIN=superpower`, `DOMAIN_NAME=example.com`) |
|---|---|---|
| Public app URL (CloudFront, one per environment) | non-prod `{SUBDOMAIN}-{env}.{DOMAIN_NAME}` · prod `{SUBDOMAIN}.{DOMAIN_NAME}` | `superpower-dev.example.com` · `superpower.example.com` |
| Internal ALB (one per environment **and** region) | non-prod `{SUBDOMAIN}-internal-{env}-{region}.{DOMAIN_NAME}` · prod `{SUBDOMAIN}-internal-{region}.{DOMAIN_NAME}` | `superpower-internal-dev-ap-south-1.example.com` · `superpower-internal-eu-west-1.example.com` |

The region suffix on the internal name is required. Route 53 is a global namespace, so without it a
second region's record would collide with the first region's. CloudFront is the only intended
client of the internal ALB: the ALB accepts only CloudFront's origin-facing IP range, plus the
`X-Origin-Verify` header (`ORIGIN_VERIFY_SECRET`).
