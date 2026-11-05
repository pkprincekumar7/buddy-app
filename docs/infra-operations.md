# Infrastructure Operations

Day-2 reference for the live AWS stack: how the Terraform modules and workflows hand data to
each other, where state lives, what each workflow changes on ECS, how app secrets are managed,
how the main resources are configured, and how hostnames are formed.

For the architecture and deployment sequence see
[infra-architecture-multi-region.md](infra-architecture-multi-region.md). For the resource
inventory see [aws-resources.md](aws-resources.md), and for workflows and GitHub secrets see
[ci-cd.md](ci-cd.md).

Placeholders used below: `{app}` = `APP_NAME` environment variable (e.g. `superpower`), `{env}` = `dev` / `sbx` /
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
| `/{app}/{env}/backend/{region}/ecs_cluster_name` | `infra-live-backend` | `deploy-`, `promote-` and `restart-live-backend` |
| `/{app}/{env}/backend/{region}/ecs_services` | `infra-live-backend` (from `services.tf`) | `deploy-`, `promote-` and `restart-live-backend`: a JSON array, in `deploy_order` order, of `{name, service, family, container, image_service, ecr_repository_url}`, one per ECS service. A worker's `image_service` and repository are its service's; the collector's are empty (public image) |
| `/{app}/{env}/backend/{region}/internal_public_keys` | `infra-live-backend` (`service_tokens.tf`) | — (the service-token public keys, `{service: {kid: PEM}}`, for anything outside the tasks that verifies them; the tasks get the same map as `INTERNAL_PUBLIC_KEYS`) |
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

**Provider versions are pinned** by a committed `.terraform.lock.hcl` in each stack (TF-01), with hashes for `linux_amd64` (CI), `darwin_arm64` and `darwin_amd64`. CI runs `terraform init -lockfile=readonly`, so it fails rather than pick up a different provider. To upgrade, run this in the stack directory and commit the result:

```bash
terraform init -upgrade -backend=false && terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64
```

State locking uses native S3 lock files (`use_lockfile = true`) — there is no DynamoDB table. Each
backend region has its own state, so regions can be applied in parallel (`terraform-live-all`
runs them as a matrix). The edge state is a single shared distribution per environment, which is
why edge always receives the **full** region list.

### If a Terraform job timed out or was cancelled

Every workflow job has a `timeout-minutes` (CI-16): Terraform backend, frontend and scheduler 60/30/30, edge 90 (CloudFront and Lambda@Edge are slow), deploys 30–45. A timeout or a cancel sends Terraform an interrupt: it stops starting changes and saves the state, but GitHub kills the job about 10 seconds later, so a slow change still in flight can be cut off. State is written as the apply goes, so only that change is in doubt. To recover:

1. Run `plan` again for the same environment (and region). Anything left undone shows up as a change; apply it as usual.
2. If the run fails with **"Error acquiring the state lock"**, the killed run left its lock file. Make sure no other run is using that state, then, in the stack directory, initialised against that state:

   ```bash
   terraform force-unlock <LOCK_ID>
   ```

   The lock ID is in the error message.
3. If an apply fails with **"already exists"**, AWS finished creating a resource that Terraform never recorded. Import it (`terraform import <address> <id>`, or an `import {}` block), then plan again.

**Scheduled starts and stops** (`infra-live-scheduler`, dev, sbx and stg): the dispatcher Lambda
isn't retried, and skips a dispatch whose run (same action, environment and regions) already
started in the last hour, so a schedule delivered twice runs once (SCH-01). Where
`enable_alarms` (stg), a failed dispatch emails `OPS_EMAIL` twice over: the
`scheduler-dispatch-failed` alarm, and the failed event itself through the function's
`on_failure` destination. The environment then didn't start or stop: run
`terraform-live-all` by hand if it must.

**Queued runs:** each Terraform and deploy workflow has a concurrency group (per environment, plus region for the backend), with `cancel-in-progress: false`. GitHub keeps one running and **one** pending run per group, so a third run started while one is pending replaces the pending one, without an error. That includes the scheduler's runs. If a run shows as cancelled without anyone cancelling it, that's why: start it again once the group is free.

---

## ECS task definitions — what each workflow changes

Each backend region runs one ECS service per runtime in `local.services`
(`infra-live-backend/terraform/services.tf`), 18 in all, derived from `local.split_services`:

- **9 HTTP runtimes**, one per service (auth, users, children, onboarding, discover, grow, transform,
  release, shared): the public API on 8000 behind the ALB, and (all but shared) the internal API
  on 8001, registered in Cloud Map as `<service>.<app>-<env>.internal`.
- **8 workers**, `<service>-worker` (no shared worker): the same image as their service, with the
  command `python -m <service>.worker` (outbox relay, event consumer, and for discover, grow,
  transform and release the LLM job worker).
- **`otel-collector`**: the AWS Distro for OpenTelemetry image (`otel_collector_image`), on 4318
  in Cloud Map. Every runtime sends it traces; it tail-samples them into X-Ray (`otel_collector.tf`).

A service and its worker share one ECR repository (`<app>/<env>/<service>`), one secret, one
service-token key and one Valkey user. The ALB routes by path from `shared/service-routes.json`.
The workflows' `service` input takes `all` or a comma-separated list of runtime names, e.g.
`users,users-worker`; anything else fails up front with the valid list. See [Adding a backend service](#adding-a-backend-service).

### `terraform-live-backend` (apply)

Terraform manages every task definition as a normal resource. Changing any of the following
registers a **new revision**:

| Category | Examples |
|---|---|
| Compute | CPU, memory |
| Plain env vars | Every service runtime: `SERVICE_NAME`, `APP_NAME`, `APP_ENV`, `AWS_REGION`, `MONGODB_DB_NAME` (= the service), `MONGODB_MAX_POOL_SIZE`, `REDIS_URL` + `REDIS_USERNAME` (its own RBAC user) + `REDIS_REPLICATION_GROUP_ID`, `INTERNAL_DNS_SUFFIX`, `INTERNAL_SIGNING_KID`, `INTERNAL_PUBLIC_KEYS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `PUBLIC_ORIGINS` (the web app's origin, `https://<cookie_domain>`: the cross-site cookie check, AUTH-05), the `JWT_*` verification settings (`JWT_KEY_ID`, `JWT_PUBLIC_KEYS`, `JWT_ISSUER`, `JWT_AUDIENCE`). HTTP runtimes: `BEHIND_PROXY`; auth's cookie settings (`COOKIE_SECURE`, `COOKIE_SAMESITE`; the cookies are host-only, so there's no domain to set). Auth and its worker: `DELETION_PARTICIPANTS`. Workers: their own `EVENTS_TOPIC_ARN` / `EVENTS_QUEUE_URL`. Generating services: `*_MODEL`, `LLM_TIMEOUT_SECONDS`, `LLM_HOURLY_LIMIT`. Children and transform (HTTP and worker): `UPLOADS_BUCKET_NAME`, `UPLOADS_URL_TTL_SECONDS`; shared: `ASSETS_BUCKET_NAME`. The collector: `AOT_CONFIG_CONTENT` |
| Secret references | ARN pointers (not values) into the runtime's own service secret, plus `INTERNAL_SIGNING_KEY` from its SSM SecureString. Auth: `MONGODB_URI`, `JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, `EMAIL_HMAC_PEPPER`. Generating workers: `MONGODB_URI` + the three LLM keys (their HTTP runtimes get `MONGODB_URI` only). Shared: `OPENAI_API_KEY`. The others: `MONGODB_URI`. The collector: none |
| Infrastructure | log group, health check, execution/task role, network mode |
| Image | the service's repository at `:latest` — a placeholder; see below (the collector: the pinned `otel_collector_image`) |

Every ECS **service** has `ignore_changes = [task_definition, desired_count]`. Terraform
therefore registers the new revision but never switches a service to it. The revision stays idle
until the next deploy.

### `deploy-live-backend`

A `resolve` job lists the selected runtimes and the images they need: one per service, since a
worker runs its service's. The collector runs the pinned `otel_collector_image`, so `all` skips it,
and naming it is an error. A build matrix then builds each image once
(`--build-arg SERVICE=<service>`), scans it with Trivy (a HIGH or CRITICAL CVE with a fix fails the
build before anything is pushed; `.trivyignore` holds the reviewed exceptions), and
pushes it as `:<YYYYMMDD>-<short-sha>` to that service's repository in every selected region,
with a second tag on the same image, `:<YYYYMMDD>-<short-sha>-scanned` (CI-03). A re-run finds
the tag already there; since that's another build of the commit, it pulls and scans it before
adding the marker.
`prod` can't be deployed this way, from the dropdown or through `workflow_call`. It gets
releases only through promote.
Then, in each region:

1. Reads the services to deploy from the region's `ecs_services` SSM list and rolls them all out
   **in parallel**: each is an independent ECS service, so the deploy takes as long as the
   slowest one. Log lines are prefixed with the service name. For each service, it reads
   the **latest active revision** of its task definition family, so it picks up anything
   `terraform apply` just registered.
2. Patches only the container `image` to its service's repository at the pushed tag, and registers a new revision.
3. Updates the service to that revision. This is a rolling deployment with circuit-breaker
   rollback, waiting up to 15 minutes for steady state.

Everything else (env vars, secret references, CPU/memory, roles) is carried over unchanged. The
`:latest` placeholder never runs after the first deploy. If a service fails to stabilise, the
ECS circuit breaker rolls it back and the others carry on. The step then fails, naming the services
left on their previous image and the `service=` value to re-run them with. Because the services
are rolled out together, any change must keep working while some services still run the previous
image (e.g. the API and the worker must both handle a job written by the other version). The rollout logic is shared by all
three workflows in `scripts/ecs-services.sh` (tested by `scripts/ecs-services.test.sh`).

`promote-live-backend` does the same, but takes the image from the source environment's running
task definition instead of building one: an export job (source environment's role) reads its tag
and digest, and the promote job (target's role) copies it by digest with `crane`, registry to
registry, into its service's repository in the target under the same tag before registering the
revision. The copy keeps the digest, and the job fails if the target's digest differs, or if the
tag is already in the target as another image. No image moves through workflow artifacts. Only an
image with the scan marker on the same digest in the source is promoted, and the promote job adds
the marker in the target too, so stg → prod accepts it in turn. The target runs from its own ECR,
never the source's, so it is unaffected when the source repo expires the image or the source
environment is destroyed.

Source and target can be different AWS accounts. Then the target's role has to read the source
repositories: list the target account in the source environment's `ecr_pull_account_ids`
(`infra-live-backend` tfvars; it adds a pull-only repository policy to every service repository),
and allow the target `ROLE_ARN` (managed outside this repo) `ecr:BatchGetImage`,
`ecr:GetDownloadUrlForLayer` and `ecr:BatchCheckLayerAvailability` on those repositories. In one
account, the role's own IAM permissions are enough and the list stays empty. `restart-live-backend` forces a new deployment of the
current revision without registering one.

### Which workflow to run

| What changed | Run |
|---|---|
| Application code | `deploy-live-backend` (dev, sbx, stg). For prod: `promote-live-backend` and `promote-live-frontend` from stg |
| Env var / model / CPU / memory (tfvars or GitHub secrets that feed env vars) | `terraform-live-backend` apply, **then** `deploy-live-backend` (apply registers, deploy activates) |
| Secret values in Secrets Manager | `put-secret-value` (below), then `restart-live-backend` |

### Adding a backend service

Add the service's name to `local.split_services` in `infra-live-backend/terraform/services.tf`
(and to `generating_services` if it runs LLM jobs). Its place in the list is its deploy order; the
name is lowercase with hyphens. That produces two runtimes, `<service>` and `<service>-worker`
(exclude it on the `worker_services` line if it has no database or events, as shared does), each
with:

| From | Created |
|---|---|
| `runtime_sizes` (its tier) | Task definition and ECS service (`modules/ecs-service`); autoscaling between the tier's `min_capacity` and `max_capacity` |
| The environment and secret locals | Its env vars and secret keys: add the service's own extras to `service_http_environment`, `service_worker_environment` and `secret_keys` |
| `task_policies` | Execution role (`<app>-<runtime>-exec-role-<env>-<region>`: only its service's secret and signing key) and task role (`<app>-<runtime>-task-role-<env>-<region>`: Valkey as its own user, metrics in `Superpower/<service>`, its own topic and queue for the worker, plus whatever is added here) |
| — | ECR repository and secret (one per service), a service-token key pair, a Valkey RBAC user, its security group `<app>-<runtime>-sg-<env>`, its log group `/ecs/<app>/<runtime>/<env>`, Cloud Map registration on 8001 (if in `internal_services`), alarms (when `enable_all_alarms`) |
| `deploy_order` (from the list) | Its place in the `ecs_services` SSM list, which the deploy / restart / promote workflows read. **No workflow logic change.** Add both runtime names to the name list in the `service` input description of `deploy-`, `restart-` and `promote-live-backend.yml`. That list is only help text, but CI (`scripts/check-service-lists.sh`) fails if it doesn't match. |

Then add its routes to `shared/service-routes.json` (the ALB and the local gateway both read it) and
its events to `backend/common/events/catalogue.json` (topics, queues and subscriptions follow,
`modules/events`).

Then:
1. Apply `terraform-live-backend` in every region of the environment, and fill the new service's
   secret (see [Secrets Manager](#secrets-manager--service-secrets)).
2. Run `deploy-live-backend` with `service` = the new runtimes (or `all`).

**HTTP routing.** Each HTTP runtime gets its own ALB target group, ingress from the ALB SG and
`alb-healthy-hosts-<runtime>` alarm (`modules/alb`). The listener rules come from
`shared/service-routes.json`: each rule has a priority, a target and 1–3 path patterns. There's
no catch-all: an origin-verified request matching no rule gets a JSON 404 from the fixed rule
at 50000.

- Lower priority is matched first.
- Each rule also requires `X-Origin-Verify`, and AWS allows **5 condition values per rule**: the
  origin-verify values (2 during a rotation) plus the path patterns. So keep it to 3 patterns;
  Terraform refuses more.
- Target group names are `<app>-<runtime>-<env>-<hash>`, at most 32 characters (no `-tg`: with it,
  `superpower-onboarding-tg-prod-xxxx` would be 34). The 4-character
  hash covers port, protocol, target type and VPC, which can't change in place. So a port change
  creates a new group (`create_before_destroy`), moves the listener rule and ECS service to it,
  and only then deletes the old one.
- CloudFront and Lambda@Edge need no change: they send all of `/api/*` to the ALB, which splits it.
- An `ALBRequestCountPerTarget` scaling policy tracks the service's own target group (`ecs.tf`
  fills in its `resource_label`).

**Internal calls.** Services call each other's `/internal/*` endpoints directly, at
`http://<service>.<app>-<env>.internal:8001` (Cloud Map, `service_discovery.tf`). Each
registered runtime admits its internal port only from the `internal-callers` security group,
which every service runtime joins. Each call carries a token signed with the caller's own
Ed25519 key (`service_tokens.tf`).

### Scaling

- **`desired_count` is ignored after the first apply.** A manual
  `aws ecs update-service --desired-count N` is never reverted, and a later `apply` won't restore
  it either. Scale back explicitly.
- **Every runtime is under App Auto Scaling**, between its tier's `min_capacity` and
  `max_capacity` (`runtime_sizes`). Change the range there, not just `desired_count`.
  - **HTTP runtimes** use CPU, memory and ALB-request target tracking. Auth has its own tier,
    because login and register are bcrypt-bound.
  - **Workers** have a CPU floor that never scales in. They scale out on queue depth (over 100
    messages) and back in when it stays at 10 or below for 5 minutes; the generating ones also
    scale out on `PendingJobCount`.
  - **The collector** uses CPU.
- **Tracing.** Every runtime sends its spans to the collector; the collector keeps every error
  and every trace slower than 2 s, plus `xray_default_sampling_rate` of the rest. With more
  than one collector task, a trace's spans can land on different tasks, which each decide
  alone: see [auth-users-split.md](auth-users-split.md) 15.5.

---

## Secrets Manager — service secrets

Each service has its own secret per region, `{app}/{env}/<service>-secrets`: a JSON object with
the keys in `local.secret_keys` (`services.tf`). Every service with a database has its own
`MONGODB_URI`. Auth's also holds `JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID` and `EMAIL_HMAC_PEPPER`;
discover, grow, transform and release hold the three LLM keys; shared holds `OPENAI_API_KEY`.
A service and its worker share the secret, and each runtime's execution role can read only its
own service's.

- **Created with placeholders.** Terraform writes `REPLACE_ME` for every key and then ignores
  the value (`ignore_changes = [secret_string]`).
- **Placeholders filled, key by key.** After every `terraform apply`, `terraform-live-backend`
  runs `scripts/fill-service-secrets.sh`. Each key still `REPLACE_ME` gets its value from the
  GitHub environment: the service's own entry of `MONGODB_URIS`, `JWT_PRIVATE_KEY`,
  `EMAIL_HMAC_PEPPER`, `GOOGLE_CLIENT_ID` or an LLM key. Every key with another value is kept
  as it is, so manual rotations are never overwritten, and only placeholder keys need their
  GitHub value (SEC-05). A secret with nothing to fill isn't written. Nothing is written unless
  every secret that needs it can be, so a missing `MONGODB_URIS` entry leaves no secret
  half-filled. An unset `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` stays `REPLACE_ME`: the services
  start, but those providers are unavailable; set it in GitHub later and the next apply fills it.
- **Hard-deleted on destroy.** `recovery_window_in_days = 0` means `terraform destroy` deletes
  the secret immediately, with no 30-day recovery window, so a re-apply doesn't hit a name clash.
  ⚠ This is irreversible — back up the values first.
- **Service-token keys aren't here.** Terraform generates them (`service_tokens.tf`) into
  `/{app}/{env}/backend/{region}/<service>/internal_signing_key` (SSM SecureString). To rotate one,
  bump its entry in `service_token_key_versions`, apply, and redeploy every runtime: the others
  learn the new public key from their `INTERNAL_PUBLIC_KEYS` when they restart.

### Rotating a value

This is how a secret's value changes. **Repeat it for every active backend region.** `put-secret-value` replaces the whole JSON, so send every key:

```bash
for region in ap-south-1 eu-west-1 us-east-1; do   # the regions this environment runs in
  aws secretsmanager put-secret-value \
    --region "$region" \
    --secret-id "{app}/{env}/<service>-secrets" \
    --secret-string file://<service>-secrets.json
done
```

Running tasks keep the old values until they restart. Run `restart-live-backend` afterwards for that
service's runtimes (e.g. `users,users-worker`, same region set). Delete the local JSON file once done.

JWT key rotation has its own procedure, because the Lambda@Edge validator also holds the public
keys: see [jwt-keys.md](jwt-keys.md).

### Rotating the origin-verify secret

`ORIGIN_VERIFY_SECRET` is the `X-Origin-Verify` header CloudFront sends to every regional ALB.
Each ALB's listener rule 403s requests without it. It lives in two places only: the
`alb-backend` origin's `custom_header` (`infra-live-edge/terraform/cloudfront.tf`) and each
ALB's listener rule (`modules/alb`, called from `infra-live-backend/terraform/alb.tf`). The Lambda@Edge copies the header
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

## First admin of an environment

A new environment has no admin and an empty allow-list, and both are needed to add anyone:
registration accepts only allow-listed emails, the allow-list API is admin-only, and
`auth.seed` runs only with `APP_ENV=local`. So the first email goes on the allow-list by hand,
and the first account is promoted with `auth.promote_admin` as a one-off ECS task (ECS Exec is
off). After that, admins manage the allow-list and roles from the admin screens. Locally, see
[getting-started.md](getting-started.md#admin-setup) instead.

The commands below use one region (the one whose site you'll sign up on); any region works,
since auth's `allowed_emails` and `admin_count` are unsharded global collections (section 14 of
[auth-users-split.md](auth-users-split.md)). Set these first:

```bash
APP=superpower ENV=sbx REGION=ap-south-1
EMAIL=admin@example.com   # the first admin's address
```

**1. Deploy auth.** `terraform-live-backend` then `deploy-live-backend` (at least `auth`,
`auth-worker`). Auth creates its database, collections, indexes and validators when it starts
(`ensure_collections`), so don't create any of them in Atlas by hand.

**2. Allow-list the email.** An entry's `_id` is the HMAC-SHA256 of the lower-cased email,
keyed with auth's `EMAIL_HMAC_PEPPER`; the plain email never matches. Compute it from the
secret without printing the pepper:

```bash
KEY=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$APP/$ENV/auth-secrets" \
  --query SecretString --output text \
  | EMAIL="$EMAIL" python3 -c 'import hmac,hashlib,json,os,sys
p = json.loads(sys.stdin.read())["EMAIL_HMAC_PEPPER"].strip()
if p.startswith("{"): v = json.loads(p); n = max(v, key=int); p = v[n]; print(n, end=" ")
else: print(1, end=" ")
print(hmac.new(p.encode(), os.environ["EMAIL"].strip().lower().encode(), hashlib.sha256).hexdigest())')
echo "key_version ${KEY%% *}, _id ${KEY#* }"
```

During a pepper rotation (a JSON map of versions) this uses the highest version, as auth does.
Then, in Atlas Data Explorer (or `mongosh` with an admin user), insert into database `auth`,
collection `allowed_emails`, matching its validator:

```js
{
  _id: "<_id from above>",
  key_version: 1,                                   // the key_version from above
  email_hint: "a***@example.com",                   // first character, ***, the domain
  added_by: "00000000-0000-4000-8000-000000000000", // the placeholder auth.seed uses
  created_at: new Date()
}
```

**3. Register** `$EMAIL` on the environment's site (password, or Google if that origin is an
authorized JavaScript origin of the OAuth client), and sign in.

**4. Get the user id.** Signed in, open `/api/v1/auth/me` on the site; its `id` is the UUID.

**5. Promote it** with a one-off task from auth's task definition. The task family and
container come from the deploy manifest in SSM, and the subnets and security group from the
running auth service, so nothing is copied by hand. `--user-id` (not the email) keeps the
address out of the task override and CloudTrail:

```bash
USER_ID=<uuid from step 4>
CLUSTER="$APP-backend-$ENV"
MANIFEST=$(aws ssm get-parameter --region us-east-1 --name "/$APP/$ENV/backend/$REGION/ecs_services" \
  --query Parameter.Value --output text)
FAMILY=$(jq -r '.[] | select(.name == "auth") | .family' <<<"$MANIFEST")
CONTAINER=$(jq -r '.[] | select(.name == "auth") | .container' <<<"$MANIFEST")
SERVICE=$(jq -r '.[] | select(.name == "auth") | .service' <<<"$MANIFEST")
NETWORK=$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration' --output json)

TASK=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$FAMILY" \
  --launch-type FARGATE --network-configuration "$NETWORK" \
  --overrides "$(jq -n --arg c "$CONTAINER" --arg u "$USER_ID" \
    '{containerOverrides: [{name: $c, command: ["python", "-m", "auth.promote_admin", "--user-id", $u]}]}')" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK"
aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode'
```

Exit code 0 means promoted; the output is in auth's CloudWatch log group. It refuses (exit 1,
with the reason) if an admin already exists, or if the account doesn't exist, is locked, is
being deleted or is already an admin.

**6. Sign in again.** The promotion ends the account's sessions; the next sign-in carries the
admin role, and the admin screens appear.

**Don't set `role: "admin"` in Atlas instead.** `promote_admin` does what a role change needs:
a new `authz_version` (so the Valkey authz cache and old tokens stop carrying the old role), the
account's sessions ended, `admin_count` set to 1 (which keeps `promote_admin` one-shot and stops
the last admin being demoted), an `audit` row and the `audit.role_changed` log line the
role-change alarm watches. A manual edit does none of them.

---

## MongoDB indexes: built once per release

Each service's indexes are declared in its `ensure_*` functions (`backend/CLAUDE.md`, "MongoDB &
indexes"). A task's startup creates the collections and validators only. The indexes are built in
the background (`common/index_builds.py`, DB-03): a new index on a large collection no longer
holds up startup or fails the health check, and an option conflict no longer crash-loops tasks.

- **Once per release:** the first task of a release (its `GIT_SHA`) to claim the
  `<service>:<release>` document in the service's `index_builds` collection builds them, with one
  `createIndexes` per collection. Every other task, in every region, waits for that build, then
  only checks that each index exists. Restarts and promotes of the same image build nothing.
- **A stopped builder:** a build still `running` after 30 minutes is taken over by the next task
  that starts.
- **Problems:** a failed build (an option conflict, or duplicates under a new unique index) or an
  index missing afterwards is logged with a top-level `index_problem` field (`failed` or
  `missing`). The tasks keep serving. In stg and prod, the `index-problems` alarm emails.
  1. Find the service, release and error in that service's log, or in
     `db.index_builds.find({status: "failed"})` in its database.
  2. Fix the cause (for example, drop the conflicting index, or remove the duplicates).
  3. Restart the service (`restart-live-backend`): the next start retries a failed build.
- **Until a new index exists,** queries that need it run unindexed, and a new unique rule isn't
  enforced. On a large collection, check the build finished (`index_builds` status `done`)
  before relying on it.
- **Through an Atlas election** (DB-05): a task starting while the replica set has no primary
  retries the collection step on connection and "not primary" errors, waiting 1, 2, 4, 8 and
  16 s (about 60 s in all, inside its health-check allowance), instead of exiting and being
  restarted in a loop. Other errors still stop it at once. Requests in flight during an
  election can fail; pymongo retries a single write once.
- **Before a release that changes MongoDB access,** run Atlas's *Test Failover* on the stg
  cluster while the services run: the API should recover within about a minute, with no task
  crash-looping and no generation job stuck (the `jobs-waiting` and `failed-jobs` alarms stay
  quiet).

---

## Finding a request in the logs

Every runtime writes JSON lines to its log group, `/ecs/<app>/<runtime>/<env>`. Each request
has one access line (`logger` `common.access`: `method`, `path`, `route`, `status`,
`latency_ms`, `user`), and every line logged for it carries the same `request_id`, which the
response returns in `X-Request-Id` (OBS-04). The id follows the work: internal calls send it,
a generation job keeps the id of the request that started it (so the worker's lines carry it
too), and an event carries it to its consumers. `user` is a hash of the user id
(`common.logging.user_hash`), so the id itself isn't in the access lines. Successful health
checks aren't logged.

In CloudWatch Logs Insights, across the service's log groups:

```
fields @timestamp, service, logger, message, status, latency_ms
| filter request_id = "<X-Request-Id from the response or the client's error report>"
| sort @timestamp asc
```

Slowest routes in the last hour, and the ones failing:

```
filter logger = "common.access"
| stats count(*) as requests, pct(latency_ms, 95) as p95 by route
| sort p95 desc
```

```
filter logger = "common.access" and status >= 500
| stats count(*) as errors by route, status
```

---

## Pausing LLM generation (the kill switch)

When LLM spend runs away (the `llm-tokens` alarm, a loop, abuse) or a provider misbehaves, pause generation in a region without a deploy. Each backend stack has one switch, an SSM parameter that Terraform creates as `true` and never resets (`infra-live-backend/terraform/generation_switch.tf`):

```bash
APP=superpower ENV=prod REGION=ap-south-1
aws ssm put-parameter --overwrite --region "$REGION" --type String \
  --name "/$APP/$ENV/backend/$REGION/llm_generation_enabled" --value false
```

Within about a minute, every task of discover, grow, transform and release has re-read it (`backend/common/generation/switch.py`):
- new generations get `503 generation_paused`, before the hourly limit is touched;
- the workers stop claiming jobs: a job already running finishes, and the rest wait.

To resume, run the same command with `--value true`. Waiting jobs are then taken in order. If the pause was long, the `jobs-waiting` alarm will have fired while it was off. That's expected, and it clears once the jobs are taken.

Notes:
- **Region by region.** Pause every backend region that serves the environment.
- **A failed read keeps the last value.** If a task can't read the parameter, it keeps the value it last read (on, if it has never read one), so an SSM outage doesn't stop generation by itself.
- **Local runs don't use it.** They set no `LLM_SWITCH_PARAMETER`, so generation is always on.

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
| ALB | HTTPS 443 only, TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`; ingress only from CloudFront's origin-facing prefix list, plus the `X-Origin-Verify` header check; target health check `GET /health`, 200, every 30 s (5 s timeout, 2 healthy / 3 unhealthy); deregistration delay `llm_timeout_seconds` + 30 s (90 s dev/sbx/stg, 120 s prod), so a rollout waits that long at most for old tasks' in-flight requests instead of AWS's 300 s default |
| ECS | 18 runtimes (9 HTTP, 8 workers, the OpenTelemetry collector), sized by `runtime_sizes`; Container Insights on in prod only (`enable_container_insights`; dev/sbx/stg rely on the free `AWS/ECS` metrics); HTTP container health check `GET http://127.0.0.1:8000/health` (30 s, 3 retries, 60 s start period); circuit breaker with rollback; ECS Exec on in dev/sbx/stg, off in prod |
| Cloud Map | Private DNS namespace `<app>-<env>.internal`: each HTTP service except shared on 8001, the collector on 4318, reachable only from the `internal-callers` security group |
| SNS / SQS | From `backend/common/events/catalogue.json` (`modules/events`): a topic per producing service (customer-managed KMS key), a queue + DLQ per consuming service (SSE-SQS), filtered subscriptions; DLQ and message-age alarms when `enable_all_alarms` |
| ECR | One repository per service, `<app>/<env>/<service>`; `scan_on_push`, **immutable** tags, AES256; lifecycle keeps the newest 30 tagged images and expires untagged ones after 7 days |
| ElastiCache Valkey 8.0 | At-rest encryption + TLS required + RBAC: one IAM-authenticated user per service, limited to its own keys (`modules/redis`); single node in dev/sbx (`cache.t4g.micro`) and stg (`cache.t4g.small`), primary + 1 replica with Multi-AZ failover in prod (`cache.t4g.medium`). Holds rate-limit counters, leader locks and the `authz:{user}` cache. `maxmemory-policy = noeviction` (TF-04): when memory is full, writes fail rather than evict a counter or lock (every key has a TTL, so Valkey's default `volatile-lru` would); the services then count per task, and the Valkey memory and `valkey-degraded` alarms fire |
| CloudWatch Logs | One log group per runtime, `/ecs/<app>/<runtime>/<env>`; retention 7 d (dev/sbx), 30 d (stg), 90 d (prod) |

### Frontend deploy (`deploy-live-frontend.yml`, `promote-live-frontend.yml`)

Both publish through `scripts/frontend-publish.sh` (CI-07):

1. Builds the React app (`VITE_API_URL` is baked in, derived from `SUBDOMAIN` + env + `DOMAIN_NAME`).
2. Syncs `dist/assets/` with `Cache-Control: public,max-age=31536000,immutable` (hashed files),
   **without** `--delete`, so open pages and the live `index.html` keep finding their chunks.
3. Syncs the rest (`index.html` …) with `no-cache,no-store,must-revalidate` and `--delete`,
   leaving `assets/` and `releases/` alone.
4. Keeps the build's unhashed files and its chunk list under `releases/<sha>/` (about 450 KB).
5. Invalidates only the unhashed files (and `/`), waits, and records `deployed_git_sha` in SSM.
6. Prunes: releases beyond the last 10, then chunks that neither this build nor a kept
   release uses and that are over 30 days old.

### Rolling the frontend back (`rollback-live-frontend.yml`)

A bad frontend release goes back to an earlier one in minutes, with no rebuild. Run
**Rollback Live Frontend** with the environment (prod included) and either a commit SHA or
nothing, which means the newest saved release that isn't live now. The run's log lists the
saved releases. It checks that every chunk the release uses is still in the bucket, copies
its files back over the root, invalidates them, and records that SHA as `deployed_git_sha`,
so a later promote from this environment promotes what's live. Only the last 10 releases
are kept; an older commit has to be deployed (or promoted) again. The backend isn't touched:
roll it back by deploying or promoting its earlier image.

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
