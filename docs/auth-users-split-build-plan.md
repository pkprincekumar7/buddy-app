# Service split: build plan

**Status:** not started.
**What this is:** the order in which to build [auth-users-split.md](auth-users-split.md) (the design) and [auth-users-split-api.md](auth-users-split-api.md) (the endpoints). Each task is one PR, small enough to review. Tick a task's box when its PR is merged, and update the progress table.
**Starting point:** a fresh deployment. Nothing runs today, every database starts empty, and no compatibility with today's API is needed (design, header and step 7).

---

## How to use this file

- **One task = one PR.** Each task lists what it delivers, what it depends on, how it's checked, and the design sections it implements.
- **Ticking:** `- [ ]` → `- [x]` when the PR is merged; add the PR link after the task title. A task in progress gets *(in progress)* after its title.
- **Order:** a task may start once everything in its **Needs** line is ticked. Tasks marked *parallel* can run at the same time as their neighbours.
- **Every PR:**
  - follows the repo's branch, PR-title and template conventions, with the ticket number;
  - includes its tests, and runs the narrow checks listed in **Check**: unit tests, `terraform test`, lint or typecheck for what changed. The full `./check.sh` runs at each **phase gate**, or when asked;
  - updates [auth-users-split.md](auth-users-split.md) or [auth-users-split-api.md](auth-users-split-api.md) if the implementation has to differ from them, in the same PR, so the design stays true;
  - never commits secrets; test values go in seed or fixture files.
- **Phase gates:** at the end of each phase, run the gate check, then stop for a review before the next phase. That's especially important after Phases 1, 3 and 5, which set the patterns later work copies.

## Progress

| Phase | What | Tasks | Done |
|---|---|---|---|
| P | Decisions and prerequisites | 4 | 0 |
| 0 | Foundations | 5 | 0 |
| 1 | `common`, the protocol layer | 7 | 0 |
| 2 | Infrastructure (parallel with Phase 1) | 7 | 0 |
| 3 | auth and users | 6 | 0 |
| 4 | children | 2 | 0 |
| 5 | Circle services, platform and the Connect visit | 7 | 0 |
| 6 | Deletion end to end | 2 | 0 |
| 7 | Web and mobile clients (alongside Phases 3–5) | 9 | 0 |
| 8 | Hardening | 6 | 0 |
| 9 | Launch | 4 | 0 |
| | **Total** | **59** | **0** |

---

## Phase P: Decisions and prerequisites

Settle these before any code.

- [ ] **P.1 Branch strategy.** Decide: merge phase by phase into `develop` (safe, because nothing runs), or one long-lived feature branch. Record the choice here.
- [ ] **P.2 Tickets.** One ticket per task (or per phase). Record the ticket prefix here; branch and PR names use it.
- [ ] **P.3 Atlas tiers and access.**
  - dev, sbx and stg on **Atlas M0 (free)**, one Atlas project each (one free cluster per project);
  - prod on a dedicated tier (M10+);
  - each environment's NAT Elastic IPs in the project's network access list.
  - Record the projects and cluster names here (no credentials).
- [ ] **P.4 Correct the design for M0.** *(in progress: done locally, waiting for review and merge)* In [auth-users-split.md](auth-users-split.md):
  - 9.3 says the change stream "needs a dedicated Atlas cluster (M10+)": M0 supports change streams.
  - Section 16 step 0 lists a dedicated Atlas cluster.
  - 15.3's "Atlas M10 per environment" applies to prod only (stg moves before its load test, 8.2).
  - Add the driver pool limit: `maxPoolSize=5` per task, so 17 runtimes stay under M0's 500 connections. The limit is 100 operations a second, so automated tests never run against Atlas.
  - **Check:** the edited sections read consistently; no stale "M10+" left.

**Gate P:** P.1–P.4 ticked.

---

## Phase 0: Foundations

No service code yet: the skeleton everything else builds on.

- [ ] **0.1 `common` package skeleton.** Needs: P. *(in progress: done locally, waiting for review and merge; P.1–P.3 are decisions that don't block local code)*
  - `backend/common/` as an installable, versioned package, with optional extras `[generation]` and `[uploads]`.
  - `backend/pyproject.toml`: the import-linter contract "services import only `common`, never each other" (design section 2).
  - Split requirements: `common`'s, then each service's own `requirements.txt`.
  - **Check:** the package installs with and without extras; import-linter runs in CI and fails a test import between two dummy services.
- [ ] **0.2 Routing data generator.** Needs: 0.1. *(in progress: done locally, waiting for review and merge)*
  - `scripts/sync-routing.mjs` writes `backend/common/regions_data.py` and `backend/auth/countries_data.py`, **as well as** today's `backend/app/routing_data.py`, which the running backend still needs until 8.6 removes it. The frontend outputs stay unchanged.
  - `common/regions.py` (lookups, `locations_for_region`) and `auth/countries.py` (`resolve_region`, blocked countries) read the generated files.
  - `backend/tools/atlas_zone_ranges.py` imports the region and zone maps from `common.regions`. Its collection names still come from `app.models` until the services' `db.py` files exist (switched in 8.6).
  - **Check:** `node scripts/sync-routing.mjs --check` passes; `atlas_zone_ranges.py` prints the same zones as today.
- [ ] **0.3 Local stack.** Needs: 0.1. *Parallel with 0.2.* *(in progress: done locally, waiting for review and merge)*
  - **Images, within the organisation's Docker policy.** Docker Desktop here only allows official-library images (`valkey/valkey` and `motoserver/moto` are blocked), so:
    - `mongo:8.0.34` as a single-node replica set (`--replSet rs0`, plus a health check that runs `rs.initiate`); clients use `directConnection=true`;
    - the cache image is `${VALKEY_IMAGE:-valkey/valkey:8.0.11-alpine}`. Locally `.env` sets `VALKEY_IMAGE=redis:7-alpine`, which is protocol-compatible for what the services use (GET/SET with expiry, Lua, `SET NX`, ACL users). CI keeps the real Valkey: GitHub's runners aren't under the Desktop policy.
    - **Moto from PyPI, not a Docker image:** `moto[server,sns,sqs,s3]==5.2.3` in `requirements-test.txt`. Tests use it in-process (`mock_aws`); local end-to-end runs start `moto_server` from the backend venv on port 5050 (macOS AirPlay Receiver holds 5000), which containers reach at `host.docker.internal:5050`. An optional compose profile `moto` runs the image where it's allowed.
  - **Local gateway** for end-to-end testing: an `nginx:1.31.6-alpine` container routing each `/api/*` path to its service, with the same rules as design 13.1.
    - The rules live in one file, `shared/service-routes.json`. `scripts/sync-gateway.mjs` generates `local/gateway/nginx.conf` from it (`--check` in CI), and Terraform's ALB rules read the same file in 2.5, so local and AWS routing can't drift.
    - Until 8.6, paths no new service claims fall through to today's backend, so the old and new code run side by side locally. The fallback is local-only.
  - **Presigned URLs from containers:** two settings, `AWS_ENDPOINT_URL` (what services call, `http://host.docker.internal:5050`) and `AWS_PUBLIC_ENDPOINT_URL` (what a presigned URL points at, `http://localhost:5050`, so the browser can open it). `scripts/local-aws-setup.py` creates the local buckets with a CORS rule for the frontend origins.
  - `MONGODB_URI` defaults to the local replica set, so Atlas is opt-in. CI (`check.yml`) and `check.sh` move from `mongo:7` to `mongo:8.0.34`; CI starts MongoDB as a replica set in a step, because service containers can't pass `--replSet`.
  - Seed data comes with the services that own it (the allow-list seed in 3.2), not in 0.3.
  - **Check:** `docker compose up -d mongo valkey gateway` is healthy; `moto_server` runs from the venv; `scripts/local-aws-setup.py` creates the buckets; `scripts/check-local-stack.py` passes (transactions and a change stream on MongoDB, the cache, SNS → SQS with a filter policy and the `TopicArn` envelope, S3); `node scripts/sync-gateway.mjs --check` passes; the gateway answers on `/gateway/health`.
- [ ] **0.4 Per-service image build.** Needs: 0.1. *(in progress: done locally, waiting for review and merge)*
  - `backend/Dockerfile` with `--build-arg SERVICE=<name>`: installs the pinned `common` version, that service's extras and that service only.
  - A `hello` service (FastAPI, `/health` on 8000, `/internal/ping` on 8001), used until real services exist and removed in 8.6.
  - `SERVICE=backend` (the default) builds today's app exactly as before, so the deploy and scan workflows are unchanged until 0.5.
  - A service declares its common version on one `buddy-common[extras]==X.Y.Z` line in its `requirements.txt`. The build makes a wheel from `backend/common` and installs that line with `--no-index`, so a mismatched pin fails the build instead of reaching PyPI.
  - `common/serve.py` runs `<service>.app.main:app` on 8000 and `internal_app` on 8001 in one process, with one signal handler that stops both.
  - `backend/Dockerfile.dockerignore` keeps venvs, caches, build output and tests out of the context.
  - **Check:** `docker build --build-arg SERVICE=hello` builds; the container answers both ports.
- [ ] **0.5 CI wiring for many services.** Needs: 0.4. *(in progress: done locally, waiting for review and merge; the mutation bullet moves to 3.1)*
  - `backend/tools/export-openapi.py` writes `backend/openapi/<service>.json`.
  - `check.yml` and `check.sh` run lint, tests, OpenAPI drift and spectral **per service**.
  - Mutation testing: `backend/tools/mutate_handlers.py` and `handler_mutants/` pointed at the new services' handlers. *Moved to the first service with real handlers (3.1).* hello has none, and the tool already takes a backend-relative `TARGET` such as `auth/app/routers/register.py`; new entries are named `<service>.<module>` so they don't clash with today's `auth` and `children`.
  - **As built:**
    - `backend/tools/services.py` finds the services: a directory under `backend/` with `__init__.py` and `requirements.txt`. `--check` fails on a bad name or a spec with no service.
    - `backend/tools/import_contracts.py` generates the import-linter contracts from it, so `pyproject.toml` keeps no service list.
    - `check.yml`:
      - `backend-service-list` → a `backend-service` matrix, with one job per service. Each job installs the service alone through `scripts/install-backend-service.sh` (common only from the local wheel), then runs mypy, pytest with a 99% gate and the `backend/openapi/<service>.json` drift check.
      - `backend-services` is one stable check name for branch protection.
      - The shared jobs cover `app`, `tools` and `common`. Bandit, Semgrep and pip-audit (`scripts/audit-backend-services.sh`) take the service list, and the DAST job runs Spectral on every committed service spec.
      - MongoDB starts through `scripts/ci-start-mongo.sh`.
    - `check.sh` loops over the same list.
  - **Check:** CI passes for `common` and `hello`; adding a second dummy service is picked up without editing CI.

**Gate 0:** `./check.sh` passes; `docker compose up` gives a healthy local stack.

---

## Phase 1: `common`, the protocol layer

Design section 2 rules apply: protocol code only, versioned, backward-compatible, one owner, full coverage. Each task ships with unit tests; `common` coverage target is 100% of branches.

- [ ] **1.1 Authorization.** Needs: 0.1. *(in progress: done locally, waiting for review and merge)*
  - `common/authz.py`:
    - JWT verification against `JWT_PUBLIC_KEYS`, including `iat_ms`;
    - the authz cache read: `authz:{user_id}`, with a 30-second in-process fallback when Valkey is down;
    - `require()` and `require_self_or()` as FastAPI dependencies (9.3, 11.2).
  - `common/permissions.py`: the role → permission table (11.2).
  - `common/routers.py`: the deny-by-default router (refuses a route without a policy) and the route-policy test helper.
  - `common/audit.py`: audit events from the permission check (11.3).
  - **Check:** unit tests for every rejection: deleting, locked, `revoked_at_ms >= iat_ms`, missing permission, 404 for non-owners; fail closed (503) when cache and auth are both unavailable.
  - **As built (common 0.2.0):**
    - `Authorizer(config, cache=…, fill=…)` goes on `app.state.authorizer`. The fill (auth's `GET /internal/authz/{user_id}`) is an injected callable, and 1.3's internal client provides it.
    - Policies: `public()` (in `routers.py`), `signed_in()`, `require(perm)` and `require_self_or(perm, param="user_id")`, where `me` is allowed and the owner needs the matching `:self` permission.
    - `PolicyRouter` refuses a route without one; `assert_every_route_has_a_policy(app)` is the route-policy test, and hello runs it.
- [ ] **1.2 Events.** Needs: 0.3. *(in progress: done locally, waiting for review and merge)*
  - `common/events/`:
    - the outbox (with `location`, `schema`, `traceparent`, `region`);
    - the relay, own-region rows only, using a change stream with a polling fallback;
    - the SNS publisher, to the service's own topic;
    - the SQS consumer, with the TopicArn check and the `user.data_deleted` exception (7.2);
    - version-checked upserts, one-way flags and tombstones (7.4);
    - the opt-in inbox (7.3).
  - `common/events/schemas/` with every event in 7.6 as `<event>.v1.json`. Reserved events get a schema too, but aren't published.
  - **Local topics and queues:** one definition of producers, consumers and filter policies, used by `modules/events` (2.4) and by `scripts/local-aws-setup.py` to create the same topics, queues and subscriptions in local Moto.
  - Contract-test and **replay-twice** test harnesses.
  - **Check:** against Moto and local MongoDB:
    - publish → consume round trip;
    - a duplicate event changes nothing;
    - an older version is ignored;
    - a tombstone blocks a late update;
    - an event type from the wrong topic is rejected.
  - **As built (common 0.3.0):**
    - `common/events/` holds `catalogue.json`, `schemas/` (16 events, reserved ones included), `envelope.py`, `store.py` (the outbox, tombstones and inbox, plus `versioned_upsert` and `set_flag`), `relay.py` (`Relay`, `SnsPublisher`), `consumer.py`, `topology.py` and `testing.py`.
    - `scripts/local-aws-setup.py` creates the 8 topics and 8 queues in local Moto from the catalogue.
- [ ] **1.3 Internal calls.** Needs: 0.1. *Parallel with 1.2.* *(in progress: done locally, waiting for review and merge)*
  - `common/internal_client.py`:
    - Ed25519 service tokens (60 s, `aud`, `sub`, `kid`) and verification against the public-key map;
    - per-endpoint caller allow-lists;
    - the Cloud Map DNS client: random IP, 2 s connect timeout, one retry on another IP, 30 s keep-alive (13.2);
    - **a local mode**, set by one setting (`INTERNAL_DNS_SUFFIX`, empty locally), where names resolve through Docker's DNS (`children`, `auth`, …) instead of `children.{app}-{env}.internal`.
  - **Check:** a token signed by service A with `sub = "B"` fails; key rotation (two keys for one `sub`) works; a stopped IP is retried; the local mode reaches a compose service by name.
  - **As built (common 0.4.0):**
    - Tokens: `ServiceTokenSigner` and `ServiceTokenVerifier`.
    - `allow_callers(...)` is the policy for internal routes: 401 without a valid token, 403 for a valid caller not on the list. It's marked like the other policies, so `PolicyRouter` and the route-policy test cover internal apps too.
    - `InternalClient` (`from_env`: `SERVICE_NAME`, `INTERNAL_SIGNING_KID`, `INTERNAL_SIGNING_KEY`, `INTERNAL_DNS_SUFFIX`).
    - `authz_fill(client)` is 1.1's Authorizer fill: 404 → no account; anything else that isn't a valid 200 → `AuthUnavailable`, so the request fails closed.
- [ ] **1.4 Operations helpers.** Needs: 0.1. *Parallel.* *(in progress: done locally, waiting for review and merge)*
  - `common/telemetry.py`: OpenTelemetry setup and instrumentations; every trace goes to the collector (15.5).
  - `common/metrics.py`: `PutMetricData` for the 16 metrics.
  - `common/logging.py`: JSON logs with `trace_id` and `request_id`; never emails, names or addresses.
  - `common/limiter.py`: rate limits in Valkey, falling back to per task.
  - `common/settings_base.py`: settings every service shares, including the MongoDB pool limit (`maxPoolSize=5`).
  - **Check:** unit tests; a log-line test asserts no personal-data fields are logged.
  - **As built (common 0.5.0):**
    - `settings_base.ServiceSettings` (`mongo_client()` with `maxPoolSize=5` and UTC dates; `events_prefix`).
    - `logging` (`JsonFormatter`, `configure_logging`, `RequestIdMiddleware`).
    - `metrics` (`MetricsPublisher` for the three metric kinds only, `oldest_unpublished_outbox_age`, `RegionLeader`).
    - `limiter.RateLimits` (`per_ip`, `per_user` dependencies).
    - `telemetry` (`setup_telemetry`, `XRayIdGenerator`, `current_traceparent`, `linked_span`). The consumer now runs each handler in a span linked to the producer's.
- [ ] **1.5 Shared collections.** Needs: 1.2. *(in progress: done locally, waiting for review and merge)*
  - Models, `$jsonSchema` validators and index definitions for `outbox`, `inbox`, `child_access` (with `confirmed`), `*_inputs`, `tombstones` and `jobs` (4.1, section 14).
  - `common/deletion.py`: `PARTICIPANTS`, plus the test that fails if a service with user data isn't on it.
  - **Check:** indexes are created on an empty local database; validators reject malformed documents.
  - **As built (common 0.7.0):** `common/models.py` and `common/deletion.py`.
    - `ensure_child_access`, `ensure_inputs` and `ensure_jobs(service)`.
    - The copy builders `child_access_fields`, `onboarding_inputs_fields`, `personality_inputs_fields` and `growth_inputs_fields`, plus `growth_inputs_id`.
    - `stage_done(copy, stage)`: progress or a confirmed unlock.
    - `outbox`, `tombstones` and `inbox` stay in `common/events/store.py` (1.2); its `ensure_validated_collection` is shared.
- [ ] **1.6 Generation extra.** Needs: 1.5. *(in progress: done locally, waiting for review and merge)*
  - `common/generation/`:
    - the job model;
    - the **atomic start**: a transaction with the upsert on `{_id: child_id, status: …}` and the job insert, where a duplicate key returns the existing job;
    - the region-scoped claim (`locations_for_region`), with backoff (`llm_attempt`, `retry_after`);
    - `completed_at` on completed **and** failed jobs;
    - the shared hourly LLM limit per user;
    - the LLM client and timeouts;
    - cancellation on tombstone (8, 4.1).
  - The per-region leader lock for `PendingJobCount` (`SET NX` with expiry, 15.5).
  - **Check:** two concurrent starts create one job; a failed insert leaves no stuck `generating`; jobs from another region's locations aren't claimed.
  - **As built (common 0.8.0, `[generation]` = the OpenAI, Anthropic and Gemini SDKs):**
    - `generation/jobs.py`: `start_job`, `claim_next`, `complete_job`, `fail_or_retry`, `cancel_jobs`, plus `pending_count` and `oldest_processing_age` for the metrics.
    - `generation/llm.py`: `LlmClient` and `LlmConfig`.
    - `generation/llm_limit.py`: `LlmHourlyLimit`.
    - `generation/prompts.py`: `render` and `system_message`.
    - The leader lock for `PendingJobCount` is `common.metrics.RegionLeader` (built in 1.4).
- [ ] **1.7 Uploads extra.** Needs: 0.1. *Parallel.* *(in progress: done locally, waiting for review and merge)*
  - `common/uploads.py`: presign PUT and GET, the key prefixes (`…/avatar/`, `…/ninety-day-plan/`), and the `HeadObject` check (allowed type, ≤ 5 MB). Ported from today's `services/s3_uploads.py`.
  - **Check:** against Moto, a 6 MB object is rejected and a key under the wrong prefix is rejected.
  - **As built (common 0.9.0, `[uploads]` = boto3):** `Uploads(UploadsConfig)`, with:
    - `new_key`, `presign_put` (5 min) and `presign_get` (the URL TTL);
    - `check_key`, `verify_uploaded` and `accept` (check, then verify);
    - `delete` and `delete_child`.

**Gate 1:** `./check.sh` passes; a demo service built only on `common` publishes and consumes an event, makes a signed internal call and passes the route-policy test. **Review before Phase 3.** *(met locally 2026-10-25, see Notes; waiting for review and merge)*

---

## Phase 2: Infrastructure

Runs alongside Phase 1. Every task: `terraform fmt`, `terraform validate`, `terraform test` for what changed; checkov and trivy config at the gate.

- [ ] **2.1 `modules/alb`.** Needs: P. Allow no catch-all target; fixed 404 at priority 50000 (13.1). **Check:** module tests, including mid-path patterns.
- [ ] **2.2 `modules/ecs-service`.** Needs: P. *Parallel.* An optional `service_discovery` input (Cloud Map registration) and an internal port (8001). **Check:** module tests with and without registration.
- [ ] **2.3 `modules/redis`.** Needs: P. *Parallel.* RBAC: a user group and one ElastiCache user per service with IAM authentication, instead of `auth_token` (9.3). **Check:** module tests; the access string per user matches 15.1.
- [ ] **2.4 `modules/events` (new).** Needs: P. *Parallel.*
  - One SNS topic per producing service;
  - one SQS queue + DLQ per consumer, subscribed to the topics it needs, with **raw delivery off**;
  - queue policies allowing `sqs:SendMessage` only from those topics;
  - filter policies, and alarms on DLQ depth and oldest-message age (7.2, 15.5).
  - **Source of truth:** `backend/common/events/catalogue.json` (`jsondecode(file(...))`), so Terraform and the services' TopicArn check can't drift. `python -m common.events.topology --prefix <app>-<env>` prints the topics, queues and per-topic filter lists the module should build.
  - **Check:** module tests.
- [ ] **2.5 `infra-live-backend` stack.** Needs: 2.1–2.4, 0.4.
  - `services.tf`: one entry per runtime (17 plus `otel-collector`), with `image_repository` and `secret_name`; the dev/sbx/stg/prod sizes from 15.3.
  - `ecs.tf`: per-service execution and task roles. `iam.tf`: per-service policies:
    - S3: children `…/avatar/*` only, transform `…/ninety-day-plan/*` only, platform the APK prefix;
    - `sns:Publish` on the service's own topic, and its own queue;
    - `cloudwatch:PutMetricData` by namespace.
  - `ecr.tf`: one repository per service.
  - `secrets.tf`: one secret per service with its service-token private key. Auth's also holds the user JWT key and the HMAC pepper.
  - `ssm_public_keys.tf` (new): the service-token public-key map.
  - `service_discovery.tf` (new): the Cloud Map namespace and the `internal-callers` security group.
  - `events.tf` (new): `modules/events` per region.
  - `alb.tf`: the rules in 13.1, no catch-all, **read from `shared/service-routes.json`**, the same file the local gateway uses (0.3).
  - `elasticache.tf`: RBAC users instead of `REDIS_AUTH_TOKEN`.
  - `cloudwatch.tf`: event, outbox, missing-metric and per-runtime alarms (15.5).
  - `ssm_write.tf`: the `ecs_services` manifest with each service's `ecr_repository_url`.
  - `tests/stack.tftest.hcl` updated.
  - **Check:** `terraform test`; `terraform plan` for dev shows only additions.
- [ ] **2.6 Workflows and scripts.** Needs: 2.5.
  - `deploy-live-backend.yml`: a build matrix with one image per selected service into its own repository (15.2).
  - `promote-live-backend.yml`: copy each service's image between its repositories.
  - `restart-live-backend.yml`: service help text.
  - `scripts/ecs-services.sh`: per-service repository URLs from the SSM manifest. `scripts/check-service-lists.sh`: the new runtime names.
  - **Check:** `scripts/ecs-services.test.sh`, `check-service-lists.sh`, shellcheck.
- [ ] **2.7 First dev apply.** Needs: 2.6, 0.4.
  - Fresh `terraform apply` in dev, with the `hello` image deployed for each runtime.
  - Checked by hand in dev:
    - each runtime registers in Cloud Map;
    - a call between two `hello` tasks over port 8001 succeeds with a service token;
    - an SNS → SQS round trip works;
    - the ALB returns the fixed 404 for an unknown path.
  - **Check:** the four items above; no manual console changes.

**Gate 2:** `./check.sh` passes, including checkov and trivy config; the dev environment runs `hello` everywhere.

---

## Phase 3: auth and users

Everything else depends on them. Build users first: auth's registration calls it.

- [ ] **3.1 users service.** Needs: Gate 1, 2.7.
  - Database and indexes (5.3, section 14); worker: outbox relay and `user.deletion_requested` handling (deletes the profile, writes a `user:` tombstone, publishes `user.data_deleted`).
  - Endpoints (each is in [auth-users-split-api.md](auth-users-split-api.md)):
    - [ ] `GET /api/v1/users/{user_id}/profile`
    - [ ] `PATCH /api/v1/users/{user_id}/profile`
    - [ ] `GET /api/v1/users/profiles`
    - [ ] `GET /api/v1/users/{user_id}/preferences`
    - [ ] `PATCH /api/v1/users/{user_id}/preferences`
    - [ ] `PUT /internal/users/{user_id}`
    - [ ] `DELETE /internal/users/{user_id}`
  - **Check:** route-policy test; ownership matrix (self, admin with `?location=`, another user gets 404); event contract tests.
- [ ] **3.2 auth: registration and sign-in.** Needs: 3.1.
  - Database: `auth`, `sessions`, `email_index`, `allowed_emails`, `deletions`, `audit`, `admin_count`, `outbox` (5.1, 5.2, section 14); `auth/emails.py`, `auth/countries.py`.
  - **Local seed:** a script adds a test email (from `.env`, never committed) to the local allow-list, so registration works in local end-to-end runs.
  - Endpoints:
    - [ ] `POST /api/v1/auth/register` (the saga in 10.1, with `authz_version: 1`)
    - [ ] `POST /api/v1/auth/login` (throttle per key and IP first; password before lock)
    - [ ] `POST /api/v1/auth/google`
    - [ ] `POST /api/v1/auth/refresh` (rotation with `rotated_at`, 30 s window, reuse detection, ms comparison)
    - [ ] `POST /api/v1/auth/logout`
    - [ ] `POST /api/v1/auth/logout-all`
    - [ ] `GET /api/v1/auth/me`
  - **Check:**
    - saga failure tests at every step, including takeover of a stale reservation and the profile-undo call;
    - pepper-rotation duplicate check;
    - refresh reuse after 30 s revokes the family.
- [ ] **3.3 auth: authz cache.** Needs: 3.2.
  - The worker: the change stream over **all** of `auth.auth` in each region, the versioned Lua write (strictly higher `ver`), 1 h TTL, the reservation reaper (9.3).
  - [ ] `GET /internal/authz/{user_id}`
  - **Check:**
    - a slow fill can't overwrite a lock;
    - every authz-changing write increments `authz_version`;
    - a Valkey outage falls back to the 30-second cache.
- [ ] **3.4 auth: admin endpoints.** Needs: 3.3.
  - Endpoints:
    - [ ] `GET /api/v1/auth/accounts`
    - [ ] `POST /api/v1/auth/accounts/search`
    - [ ] `POST /api/v1/auth/accounts/{id}/lock`
    - [ ] `POST /api/v1/auth/accounts/{id}/unlock`
    - [ ] `PATCH /api/v1/auth/accounts/{id}/role`
    - [ ] `GET /api/v1/auth/allowed-emails`
    - [ ] `POST /api/v1/auth/allowed-emails/search`
    - [ ] `POST /api/v1/auth/allowed-emails`
    - [ ] `DELETE /api/v1/auth/allowed-emails/{key}`
  - The admin counter counts **unlocked** admins (10.3).
  - **Check:**
    - two admins demoting each other at once leave one admin;
    - unlock keeps `tokens_revoked_at`;
    - no email appears in any URL or log.
- [ ] **3.5 auth: account deletion and email lookup.** Needs: 3.4.
  - Endpoints:
    - [ ] `DELETE /api/v1/auth/account` (the start of the saga, 10.3; `deletions` outside the transaction)
    - [ ] `GET /internal/auth/users/{user_id}/email` (no callers allowed yet)
  - The worker: `user.data_deleted` confirmations taken from the TopicArn, the 24 h alarm, credentials deleted last.
  - **Check:** the saga completes with users as the only participant so far; a confirmation carrying another service's name in its payload is ignored.
- [ ] **3.6 First admin tool.** Needs: 3.4.
  - `backend/tools/promote-admin.py`: once per environment, refuses if an admin exists, writes an audit event, increments the admin counter (11.4).
  - **Check:** a second run refuses.

**Gate 3:** `./check.sh` passes; in dev, sign-up, Google sign-in, login, refresh, lock, unlock and role change work end to end. **Review before Phase 4.**

---

## Phase 4: children

It gates every circle.

- [ ] **4.1 children service.** Needs: Gate 3.
  - Database and indexes (12.1, section 14), including the partial `{deleted_at}` index.
  - Endpoints:
    - [ ] `GET /api/v1/children`
    - [ ] `POST /api/v1/children`
    - [ ] `GET /api/v1/children/{id}`
    - [ ] `PATCH /api/v1/children/{id}`
    - [ ] `DELETE /api/v1/children/{id}`
    - [ ] `POST /api/v1/children/{id}/avatar/presign`
    - [ ] `GET /internal/children/{id}`
  - One `child.changed` snapshot per write; `progress.profile` set by children itself.
  - **Check:**
    - avatar keys only under `…/avatar/`;
    - files over 5 MB rejected;
    - the 10-children limit;
    - unknown fields rejected.
- [ ] **4.2 children worker.** Needs: 4.1.
  - Consumes the completion events (`onboarding.conversation_completed`, `discover.completed`, `grow.completed`, `transform.completed`, `release.completed`) and sets each flag **without** an order check (12.4).
  - Runs the 30-day purge (soft-deleted children, then `child.deleted`).
  - Handles `user.deletion_requested`.
  - **Check:** completion events arriving out of order all set their flags; the purge publishes `child.deleted` with the final version.
**Gate 4:** `./check.sh` passes; in dev, Home lists children with progress from one query.

---

## Phase 5: Circle services and platform

Build onboarding first, because it fixes the circle pattern: `child_access`, unlock, confirm-before-deny, events. 5.3–5.6 can then run in parallel once discover (5.2) is reviewed, each in its own session if wanted; 5.7 follows release.

- [ ] **5.1 onboarding.** Needs: Gate 4.
  - Database: `conversations` (`_id` = child id), `child_access`, `outbox`, `tombstones` (12.1).
  - Endpoints:
    - [ ] `GET /api/v1/children/{id}/onboarding`
    - [ ] `PUT /api/v1/children/{id}/onboarding` (once, at the end of the chat)
    - [ ] `GET /internal/onboarding/children/{id}/status`
    - [ ] `GET /internal/onboarding/children/{id}/answers`
  - **Check:**
    - the unlock via children's read-through (the exception to "don't overwrite");
    - `conversation_completed` published once;
    - identical answers publish nothing.
- [ ] **5.2 discover.** Needs: 5.1.
  - Database: `personalities`, `jobs`, `child_access`, `onboarding_inputs`, `outbox`, `tombstones`. The server-built `view_model`, ported from `adaptAiPersonalityToViewModel` (12.1).
  - Endpoints:
    - [ ] `GET /api/v1/children/{id}/personality`
    - [ ] `POST /api/v1/children/{id}/personality/generation`
    - [ ] `GET /api/v1/children/{id}/personality/generation/{job_id}`
    - [ ] `POST /api/v1/children/{id}/personality/viewed`
    - [ ] `GET /internal/discover/children/{id}/status`
    - [ ] `GET /internal/discover/children/{id}/summary`
  - The automatic start on `onboarding.conversation_completed`.
  - **Check:**
    - the automatic start and the endpoint racing create one job;
    - `viewed` refused unless `ready`;
    - `view_model` matches today's adapter output for a set of fixtures (also checked visually in 8.4).
- [ ] **5.3 grow.** Needs: 5.2. *Parallel with 5.4–5.6 once 5.2's pattern is reviewed.*
  - Database: `growth_areas` (`_id` = `{child_id}:{area_id}`), `jobs`, copies, `outbox`, `tombstones`. `area_id` must match `^[a-z0-9_-]{1,50}$` and not start with another circle's path word.
  - Endpoints:
    - [ ] `GET /api/v1/children/{id}/growth-areas`
    - [ ] `PUT /api/v1/children/{id}/growth-areas/{area_id}`
    - [ ] `POST /api/v1/children/{id}/growth-areas/{area_id}/generation` (`parent_questions`, `child_rounds`, `recommendations`)
    - [ ] `GET /api/v1/children/{id}/growth-areas/{area_id}/generation/{job_id}`
    - [ ] `GET /internal/grow/children/{id}/status`
    - [ ] `GET /internal/grow/children/{id}/areas`
  - **Check:**
    - today's area ids (`self_care`, `life_ambition`, …) are accepted;
    - generated fields can't be PUT;
    - `grow.area_updated` is published when AI recommendations arrive for a completed area.
- [ ] **5.4 transform.** Needs: 5.2. *Parallel.*
  - Database: `plans` (`_id` = child id, with `life_pathway`), `jobs`, copies, `outbox`, `tombstones`.
  - Endpoints:
    - [ ] `GET /api/v1/children/{id}/transform`
    - [ ] `PATCH /api/v1/children/{id}/transform`
    - [ ] `POST /api/v1/children/{id}/transform/generation` (`life_pathway`, `plan`, `event_tracker`)
    - [ ] `GET /api/v1/children/{id}/transform/generation/{job_id}`
    - [ ] `POST /api/v1/children/{id}/transform/photos/presign`
    - [ ] `GET /internal/transform/children/{id}/status`
  - **Check:**
    - completion only with a plan **and** the event set;
    - Life Pathway cleared on an `age` or `gender` change and on `grow.area_updated`;
    - photos `{key, url}` round trip, with keys only under `…/ninety-day-plan/`.
- [ ] **5.5 release.** Needs: 5.2. *Parallel.*
  - Database: `observations` (`_id` = child id), `jobs`, copies, `outbox`, `tombstones`.
  - Endpoints:
    - [ ] `GET /api/v1/children/{id}/observations`
    - [ ] `PATCH /api/v1/children/{id}/observations`
    - [ ] `POST /api/v1/children/{id}/observations/generation`
    - [ ] `GET /api/v1/children/{id}/observations/generation/{job_id}`
    - [ ] `GET /internal/release/children/{id}/status`
  - **Check:**
    - completion when `watching` first becomes non-empty;
    - regeneration clears `watching` but keeps completion;
    - at most 8 items.
- [ ] **5.6 platform.** Needs: Gate 3. *Parallel; doesn't need children.*
  - Endpoints:
    - [ ] `POST /api/v1/speech/transcriptions` (≤ 10 MB, parents only)
    - [ ] `GET /api/v1/downloads/apk` (parents only)
    - [ ] `GET /api/health`
  - **Check:** the audio is never stored or logged; the APK link expires in 300 s.

- [ ] **5.7 Connect visit (children).** Needs: 4.1, 5.5. It asks release's status before refusing, so it comes after release exists.
  - [ ] `POST /api/v1/children/{id}/connect/visit`: served by children until a connect service exists; asks release's status before refusing.
  - **Check:** locked before Release is done; sets `progress.connect` once.

**Gate 5:** `./check.sh` passes; in dev, one child goes from profile to Connect through every circle. **Review before Phase 6.**

---

## Phase 6: Deletion end to end

- [ ] **6.1 Account deletion across every service.** Needs: Gate 5.
  - Every participant handles `user.deletion_requested`:
    - deletes the user's data, copies and S3 objects;
    - cancels pending jobs;
    - writes a `user:` tombstone;
    - publishes `user.data_deleted` on its own topic.
  - `PARTICIPANTS` matches every service with user data. Connect stays out until it exists.
  - **Check:** deleting an account with data in every circle leaves nothing behind, in MongoDB or S3.
- [ ] **6.2 Failure and convergence tests.** Needs: 6.1.
  - Kill any service mid-deletion, restart it, and the deletion still completes.
  - A late event or a finishing job after deletion stores nothing (tombstones).
  - Child deletion: a soft delete hides the child at once; the purge after 30 days (time-shifted in the test) removes every circle's data.
  - **Check:** these as automated integration tests against the local stack.

**Gate 6:** `./check.sh` passes, including the convergence tests.

---

## Phase 7: Web and mobile clients

Start alongside Phase 3 and follow the backend: each client task needs its services deployed in dev. Every task applies to **both** `frontend` (web) and `frontend-app` (React Native) unless marked. The list is design section 16, step 7.

- [ ] **7.1 Generated API clients.** Needs: 0.5.
  - One generated client per service spec in each app, replacing the hand-written `api/client.ts` calls.
  - Error handling matches on `detail.code`.
  - **Check:** typecheck in both apps; one existing screen switched as a proof.
- [ ] **7.2 Sign-in and account.** Needs: 7.1, Gate 3.
  - Register: `first_name` (required), `middle_name`, `last_name`, three optional address lines. Login handles `429 too_many_attempts`.
  - The name comes from `GET /users/me/profile` (header, welcome screens, mobile `ChildCard`), replacing `full_name` from `/auth/me`.
  - `DELETE /user/me` → `DELETE /auth/account`. Preferences: `/users/me/preferences`, `tts_enabled` only.
  - **New account settings screen** (`pages/AccountSettings.tsx` and the mobile screen): edit names and address; "Sign out of all devices" (`POST /auth/logout-all`).
  - Remove the `last_visited_path` writes (`lib/AuthContext.tsx`, `hooks/useStartOver.ts`).
  - **Check:** jest (mobile) and existing web tests; manual sign-up, login, logout-all in dev.
- [ ] **7.3 Admin screens.** Needs: 7.1, 3.4.
  - `AdminAllowedEmails.tsx` (web), `Admin.tsx` (mobile):
    - accounts list;
    - `POST …/accounts/search` with the email in the body;
    - lock and unlock with `?location=`;
    - names from `GET /users/profiles?ids=…`;
    - allow-list list, `POST …/search`, add, and delete by `key`.
  - **New role control** (parent / admin), `PATCH /auth/accounts/{id}/role`, showing `409 last_admin`.
  - **Check:** no email in any request URL (asserted in a test).
- [ ] **7.4 Home and children.** Needs: 7.1, Gate 4.
  - Child updates send only profile fields. Home reads `progress.{profile, conversation, discover, grow, transform, release, connect}`.
  - Avatar: upload with `avatar/presign`, then PATCH the `avatar_key`; show the 5 MB limit. Sort by `-created_at`.
  - Remove every `markProgress(...)` call.
  - **Check:** Home and the child profile step in dev.
- [ ] **7.5 Onboarding and discover.** Needs: 7.4, 5.2.
  - **Onboarding chat:** answers stay in the app; one `PUT …/onboarding` with all seven at the end; `GET …/onboarding` on opening; no personality job started by the client.
  - **Discover:**
    - read `GET …/personality` and its `status`;
    - `POST …/generation` only for a retry and for `not_started`;
    - the reveal splash calls `POST …/personality/viewed`;
    - remove `adaptAiPersonalityToViewModel` (`components/shared/PersonalityAnalysis.tsx`) and the personality `Child.update`.
  - **Check:** the chat → personality → reveal flow in dev on both apps.
- [ ] **7.6 Grow.** Needs: 7.5, 5.3.
  - `completedGrowthAreas.list` / `append` → `GET …/growth-areas` / `PUT …/growth-areas/{area_id}`.
  - Questions, rounds and recommendations via `POST …/{area_id}/generation` with `kind`, polling the job; no `pending_recommendations` step. Delete `completedGrowthAreas.clear`.
  - **Check:** a growth area from start to completion in dev.
- [ ] **7.7 Transform, release and connect.** Needs: 7.6, 5.4, 5.5, 5.7.
  - **Transform:**
    - one `GET …/transform`;
    - Life Pathway via `kind: "life_pathway"` with `area_id`; plan and tracker via `plan` and `event_tracker`;
    - `PATCH …/transform` and `…/photos/presign`, with photos as `{key, url}`;
    - no `transform_visited`.
  - **Release:** `GET` / `PATCH …/observations`; "Start tracking" sends `watching` and `span`; patterns via `POST …/observations/generation`; no `release_visited`.
  - **Connect:** `POST …/connect/visit`.
  - **Check:** Release unlocks only after the plan and event are done; Connect only after a pattern is watched.
- [ ] **7.8 Shared features.** Needs: 7.1, 5.6.
  - Voice input: `POST /speech/transcriptions` (response field `transcript`). APK download unchanged.
  - Generation, every circle: handle `429 llm_limit` and `409 already_generated`.
  - **Check:** voice input works in every circle that has it.
- [ ] **7.9 Remove old client code.** Needs: 7.2–7.8.
  - Delete:
    - `lib/*Prompt.ts` and `lib/prompts.ts` in both apps;
    - `useJob`'s prompt and `write_back` payload;
    - `components/onboarding/RecommendationsPhase.tsx` and `ChildActivityGame.tsx` (web);
    - `InvokeLLM`;
    - every client method for a removed path.
  - **Check:** both apps build; a search finds no call to `/user/`, `/admin/`, `/jobs`, `/llm/` or `/audio/`.

**Gate 7:** both apps pass lint, typecheck and tests, and complete every journey against dev.

---

## Phase 8: Hardening

- [ ] **8.1 Full check and image scans.** Needs: Gates 6 and 7. `./check.sh`, plus trivy and dockle on every service image. **Check:** no unignored HIGH or CRITICAL finding.
- [ ] **8.2 stg on a dedicated Atlas tier, then load test.** Needs: 8.1.
  - Move stg from M0 to M10 (P.3), then load-test.
  - Confirms the task sizes, autoscaling, the Valkey node size (`cache.t4g.medium`) and the prod collector (2 × 512/1024).
  - Update 15.3 if the sizes change.
  - **Check:** the load-test report, attached to the PR.
- [ ] **8.3 Failure drills in stg.** Needs: 8.2.
  - Valkey down (the 30-second fallback, then recovery);
  - auth down (fail closed, 503);
  - a DLQ redrive;
  - one region down, if multi-region;
  - a deploy during traffic (Cloud Map deregistration).
  - **Check:** each drill's result recorded here.
- [ ] **8.4 Visual check of Discover.** Needs: 5.2, 7.5. Compare the server-built personality view with today's for a set of real answer sets. **Check:** sign-off recorded here.
- [ ] **8.5 Tracing check.** Needs: 8.2. One user action is traced end to end: request → database → outbox → SNS → SQS → worker → LLM. Error traces are kept by tail sampling. **Check:** a trace screenshot in the PR.
- [ ] **8.6 Remove the old backend.** Needs: 8.1.
  - Delete `backend/app/`, `backend/worker.py`, `backend/tests/` (old), the root `openapi.json` and the `hello` service.
  - Remove the local gateway's fall-through to today's backend: unmatched paths get the fixed 404, as on the ALB.
  - `scripts/sync-routing.mjs` stops writing `backend/app/routing_data.py`; `tools/atlas_zone_ranges.py` takes its collection names from each service's `db.py`.
  - Remove the old `backend`, `worker`, `auth` and `admin` ECS entries.
  - Update the current-code docs (`infra-operations.md`, `aws-resources.md`, `aws-cost-estimate.md`, `api.md`, `tests.md`) to describe the new services.
  - **Check:** `./check.sh` passes with no reference to the removed paths.

**Gate 8:** all of 8.1–8.6 ticked.

---

## Phase 9: Launch

- [ ] **9.1 Prod infrastructure.** Needs: Gate 8. Fresh `terraform apply` in prod: dedicated Atlas, the tfvars sizes and alarms. **Check:** plan reviewed; apply clean.
- [ ] **9.2 Deploy and first admin.** Needs: 9.1. Deploy every service; run `promote-admin` once. **Check:** the post-deploy smoke test (sign-up, add a child, one event round trip) passes in prod, then its test data is deleted.
- [ ] **9.3 Release the apps.** Needs: 9.2. The web app and the first public mobile build, published together (step 7, "Fresh deployment"). **Check:** both apps against prod.
- [ ] **9.4 Watch and close.** Needs: 9.3. Watch the first week's alarms, DLQs and deletion ages; then mark the design's status "implemented". **Check:** a week with no unresolved alarm.

---

## Notes and decisions

Record decisions taken during the build here, with the date, so the plan and the design stay in step.

- 2026-10-25: local MongoDB is the official `mongo:8.0` image, pinned to **8.0.34** (pulled; 1.25 GB). `mongo:7` removed locally.
- 2026-10-25: dev, sbx and stg on Atlas M0 (free); prod dedicated; automated tests never run against Atlas (P.3, P.4).
- 2026-10-25: 0.1 uses **import-linter 2.15** for the service boundaries. `common` is a flat-layout package (`backend/common/` is the package, `pyproject.toml` inside it), named `buddy-common`, version 0.1.0. Since 0.5 the contracts are generated from the services in the tree (`tools/import_contracts.py`).
- 2026-10-25: 0.3 runs within the organisation's Docker Desktop policy, which allows only official-library images. Locally the cache is `redis:7-alpine` (`VALKEY_IMAGE`); CI keeps `valkey/valkey:8.0.11-alpine`. Moto is installed from PyPI (5.2.3) and runs from the venv. The gateway is `nginx:1.31.6-alpine`.
- 2026-10-25: local Moto listens on **5050**, not its default 5000, because macOS's AirPlay Receiver holds 5000 (it answers 403 with an empty body).
- 2026-10-25: 0.3 checked locally. `check-local-stack.py`: 9 of 9 pass (mongo 8.0.34 rs0; redis 7.4.11; Moto SNS → SQS filter, `TopicArn` envelope, S3). `local-aws-setup.py` is idempotent, and the CORS preflight from `localhost:5173` is allowed. The generated `nginx.conf` passes `nginx -t`, and stub services confirmed each rule's routing, the 502 for a service that isn't running, the legacy fallback and the 404. The routing check used the local `nginx:alpine` (1.31.2). After `nginx:1.31.6-alpine` was pulled, `docker compose up -d gateway` came up healthy and answered `/gateway/health`; with no services running, a claimed path gives 502 and an unclaimed one 404.
- 2026-10-25: 0.4 checked locally. `docker build --build-arg SERVICE=hello` produces 262 MB. The container answers `/health` on 8000 and `/internal/ping` on 8001, and gives 404 for each on the other port. It runs as `appuser`, has no pip and sends no `server` header. Health reports healthy, and `docker stop` exits 0 at once. The default build still gives today's backend (`app/`, `worker.py`, no `common`). A bad `SERVICE` fails with a clear message, and `buddy-common==9.9.9` fails with only the local 0.1.0 visible. hadolint is clean. The tests for `common` and `hello` pass at 100% coverage; the 3 import contracts hold, including the new "services are independent" contract.
- 2026-10-25: services run through `python -m common.serve <service>`, a `common` module that's not in the original section 16 tree. One process serves both ports, and a single SIGTERM handler stops both: uvicorn's per-server handlers would stop only one. `common` now depends on `uvicorn>=0.34`.
- 2026-10-25: 0.5 checked locally.
  - Discovery: `auth` and `hello` (auth got a `requirements.txt` with only `buddy-common==0.1.0`).
  - Generated contracts: 3 kept.
  - Each service installs alone in a fresh venv and passes mypy, tests (100%) and its spec check. hello's spec is Spectral-clean, and `openapi.json` is unchanged.
  - Shared suite: 1,182 passed, 11 skipped, 99.72%.
  - A temporary second service, `dummy2`, was picked up with no edits: it appeared in the matrix list and the contracts, its own checks passed and its image built. An import from hello broke "services are independent". Then it was removed.
  - shellcheck and bandit are clean; actionlint reports only the existing SC2012 info.
  - Not run: the full `check.sh`, Semgrep, and the workflow on GitHub.
- 2026-10-25: a service's tests aren't part of its package (no `tests/__init__.py`), so import-linter doesn't see a test importing another service. The Docker build drops `tests/`, so nothing of that ships.
- 2026-10-25: `pip wheel` on `backend/common` writes `build/` and `*.egg-info` into the source, so the install script and check.sh build from a copy. `.gitignore` and `backend/Dockerfile.dockerignore` cover both as well.
- 2026-10-25: **Gate 0 met locally.** The full `./check.sh` passed (75 of 75), with the new per-service runs for auth and hello (mypy, pytest, hello's spec and Spectral), the generated import contracts, pip-audit for the services and the gateway sync. `docker compose up -d mongo valkey gateway` is healthy (0.3). Still to do: CI on GitHub after the push (the per-service matrix is new), and adding the `Backend Services` check to branch protection. Trivy warned that some CloudFront policies need Trivy ≥ 0.72 and were skipped; that's unrelated to this work.
- 2026-10-25: 1.1 built; it's 0.2.0 because common gained modules and dependencies (FastAPI, PyJWT, cryptography, redis). hello and auth pin `buddy-common==0.2.0` and those packages at the versions in `backend/requirements.txt`.
  - Access tokens must carry `iat_ms`, and `sub` must be a UUIDv4. Auth mints both in 3.2; today's tokens have no `iat_ms`, so they don't pass the new checks.
  - Permissions: a parent holds `profiles:read:self` and `profiles:write:self`. Everything else in 11.1 is admin-only, so using it is privileged and audited. An unknown role holds nothing.
  - Audit: privileged accesses and every denial go to the `buddy.audit` logger as one JSON line each. A missing or invalid token isn't audited: there's no actor. auth adds its `audit` collection sink in 3.x.
  - Deferred:
    - Internal routes (`internal_app`) get their own policy with service tokens in 1.3.
    - The child-data policy ("own child, or `children:read:any`", where the owner is known only after the lookup) comes with the children service in 4.1.
  - Checked locally: common at 100% line and branch coverage (133 tests); the shared suite 1,276 passed, 99.76%. hello and auth each install alone and pass. The contracts are kept, bandit is clean and pip-audit finds nothing for the services. The hello image imports the new modules, and hello's spec is unchanged and Spectral-clean.
- 2026-10-25: the repo's scripts are run with `bash scripts/…` (mode 644, as committed), and the usage lines say so.
- 2026-10-25: 1.2 built; it's 0.3.0 because common gained `pymongo` and `jsonschema` 4.25.1 (the version semgrep also needs; added to `requirements-test.txt` for the shared test job). hello and auth pin both.
  - **pymongo's async API**, not Motor (deprecated). New services use `AsyncMongoClient`.
  - **One catalogue** (`common/events/catalogue.json`) drives everything: `Event.new` refuses an event its producer doesn't own or a reserved one; the consumer's TopicArn check; the local topology; and `modules/events` (2.4). `user.data_deleted`'s producer is `*`, meaning any of `data_services`, and the consumer passes the topic's service to the handler.
  - **Topic and queue names:** `{app}-{env}-{service}-events`, a DLQ `…-events-dlq` after 5 receives, and one subscription per (consumer, producer topic), with that topic's event types as the filter and raw delivery off.
  - **Rejected messages** (wrong topic, unknown or reserved type, attribute ≠ body, bad payload, raw delivery) aren't deleted: they reach the DLQ after 5 receives, so the DLQ alarm surfaces forgeries and misconfigurations. A handler that raises also leaves its message for retry.
  - **`versioned_upsert` reads the stored version first**, so a stale event never relies on a write error. Inside a transaction, any write error aborts it.
  - **Payload schemas allow extra fields** (`additionalProperties: true`), so additive changes (7.8) don't break consumers still on the old code. grow's area fields are typed loosely (object, array or null) until grow's own contract tests in 5.3.
  - **Tests:** `common/tests/conftest.py` runs live tests against `MONGODB_TEST_URI` only, and skips are failures under `REQUIRE_LIVE_SERVICES=1`, as in `tests/conftest.py`.
  - **Checked locally:** common at 100% line and branch coverage (233 tests); the shared suite run as CI runs it, with live MongoDB and Valkey: 1,387 passed, no skips, 99.80%. hello and auth each install alone and pass; the hello image carries the catalogue and schemas. The 1.2 check list passed end to end against in-process Moto and local MongoDB: the round trip, a duplicate (replay twice), an older version, a tombstone and the wrong topic. So did the filter policies, the inbox, and the DLQ and queue policy.
- 2026-10-25: 1.3 built; it's 0.4.0 because common gained `httpx` (pinned 0.27.2 in hello and auth, as in `requirements-test.txt`).
  - **Keys:** `INTERNAL_PUBLIC_KEYS` is a JSON object `{service: {kid: PEM}}`; the verifier picks the key by the token's `sub`, then `kid`. Only EdDSA is accepted (HMAC and `none` are refused), and a token may live at most 60 s, with 5 s of leeway.
  - **The client:**
    - It resolves the name on every call and picks a random address.
    - On a connection error or a connect timeout it retries once, on a different address when the answer has one, then raises `InternalUnavailable`.
    - Timeouts are 2 s to connect and 5 s overall; keep-alive expires after 30 s; redirects aren't followed.
    - Each call logs one `internal_call` JSON line: caller, callee, method, path, status, ms and whether it retried.
  - **Not wired yet:** the service settings and `.env` entries for the keys come with the first service that makes or serves internal calls (3.1/3.2). hello's `/internal/ping` stays unauthenticated, so its image runs without keys.
  - **Checked locally:**
    - The 1.3 check list passed: a token signed by grow's key with `sub = "auth"` fails the signature; both rotation keys verify, and the old one fails once removed; a refused address is retried on the other; the local mode reached a real server by name in the tests, and on the compose network, where a container using `InternalClient` with an empty suffix called the `hello` container by name (200 on port 8001).
    - `internal_client` is at 100% line and branch coverage (38 tests).
    - The shared suite, run as CI runs it: 1,425 passed, 99.81%. hello and auth each install alone with 0.4.0; the contracts hold; bandit and pip-audit are clean.
- 2026-10-25: 1.4 built as 0.5.0; common gained OpenTelemetry (API, SDK, OTLP/HTTP exporter), `pydantic-settings` and `limits`.
  - **Metrics:** each service publishes to its own namespace `Superpower/<service>`, so its task role can be limited to it with the `cloudwatch:namespace` condition (15.5). The only dimension is `Environment`, as today's `Superpower/Worker`. Only `PendingJobCount`, `OldestRunningJobAgeSeconds` and `OldestUnpublishedOutboxAgeSeconds` are accepted.
  - **Logs:** one JSON object per line, with `trace_id`, `span_id` and `request_id`. Personal-data keys (email, names, address, phone, tokens, …) are dropped at any depth of `extra`, and email-shaped text is masked in messages and tracebacks.
  - **Rate limits:** a fixed window in Valkey, counted per task while Valkey is down, retrying Valkey after 30 s (today's limiter stays on the fallback for the life of the task). The client address comes from `CloudFront-Viewer-Address` behind the proxy. Valkey credentials go in the URL, as the RBAC users will (2.3).
  - **Telemetry:**
    - Trace ids are X-Ray-compatible from a small built-in generator, without the AWS SDK extension.
    - The FastAPI, PyMongo, httpx, botocore and redis instrumentations are switched on when their packages are installed; none are yet, see the open item.
  - **Open item, blocking CI:** pip-audit flags `opentelemetry-api` 1.37.0 (GHSA-xcq7-p3pf-p88h: an O(N²) `tracestate` parse; one large header stalls an asyncio server, and `uvicorn[standard]`'s httptools parser lets it through). The fix is 1.45.1. The services' pins (and `requirements-test.txt`) need to move to 1.45.1, and the instrumentation packages need adding at the matching version. Both mean downloading packages. semgrep (same local venv) pins OpenTelemetry `~=1.37.0`, so locally semgrep would need its own environment. CI keeps semgrep in its own job.
  - **Checked locally:** common at 100% line and branch coverage (306 tests). The no-personal-data log test passes. The shared suite, run as CI runs it: 1,460 passed, 99.83%. hello and auth install alone with 0.5.0; the contracts hold; bandit is clean; the hello image imports every new module. pip-audit (services): the one finding above.
- 2026-10-25: 1.4's open item resolved (common 0.6.0).
  - **OpenTelemetry 1.45.1**, the GHSA-xcq7-p3pf-p88h fix, and the FastAPI, PyMongo, httpx, botocore and redis instrumentations at **0.66b1**. All are common dependencies (so every service gets tracing from `setup_telemetry`), pinned in hello, auth and `requirements-test.txt`.
  - **semgrep's own venv:** semgrep 1.179.0 pins OpenTelemetry `~=1.37`, so `check.sh` now installs it alone in `backend/.venv-semgrep` (git-ignored: `.venv-*/`). `backend/.venv` gets every other security tool. CI is unchanged: the security job installs `requirements-security.txt` on its own. In the existing local venv, semgrep and its two 0.58b0 instrumentations (`requests`, `threading`, used by nothing else) were uninstalled; `pip check` is clean.
  - **Checked locally:**
    - The tests now cover the real instrumentations: a FastAPI request span continues the caller's `traceparent`, and a 100 KB `tracestate` header is parsed in under 0.5 s, which took seconds before 1.45.1.
    - common at 100% line and branch coverage (309 tests). The shared suite, run as CI runs it: 1,463 passed, 99.83%. hello and auth install alone with 0.6.0 (`pip check` clean).
    - pip-audit is clean for the services and for `requirements.txt`; semgrep from its new venv over the backend (common and services too) and both frontends: exit 0. Lint, types, contracts and bandit are clean.
    - The hello image instruments FastAPI, PyMongo, httpx and redis. botocore is skipped there because hello doesn't install boto3, and services that do will get it.
- 2026-10-25: full `./check.sh` after 1.1–1.4 (run with `MONGODB_TEST_URI` and `REDIS_URL` pointing at the compose replica set and Valkey, so the live tests run): 74 of 75 passed. The one failure was "gateway config in sync": `local/gateway/nginx.conf` was missing from commit `9f21cbf` and from disk. It's regenerated (`node scripts/sync-gateway.mjs`), and `--check` and the compose gateway's health check pass. It isn't git-ignored, so it shows as untracked: add `local/` in the next commit, or CI's matching step fails too. Everything else passed: the 1,463-test backend suite, the auth and hello runs, semgrep from `backend/.venv-semgrep`, pip-audit for the services, and the image scans.
- 2026-10-25: 1.5 built.
  - **`schema_version`** (section 4) is required on every copy and job, and the builders set it, so consumers store one shape.
  - **Validators:**
    - `child_access.confirmed` accepts only the seven stage names.
    - A service's `jobs` validator accepts only its own job types (`jobs_validator(service)`).
    - A job's `error` is limited to 500 characters (a short reason, never the prompt).
  - **Copies:** onboarding, personality and growth events carry no `user_id`, so the builders take it from the consumer's `child_access` copy.
  - **Deletion:** `PARTICIPANTS` is checked against the catalogue (`data_services` and the consumers of `user.deletion_requested`). Every directory under `backend/` with a `requirements.txt` must be in `PARTICIPANTS` or in `NOT_PARTICIPANTS` with a reason (auth, platform, hello).
  - **Checked locally:** the 1.5 check passed against the compose replica set: every index from section 14 exists after running the `ensure_*` functions twice on an empty database, and each validator rejects the malformed cases while accepting valid documents, including each copy written through `versioned_upsert` from its event. common at 100% line and branch coverage. The shared suite, run as CI runs it: 1,488 passed, 99.83%. hello and auth install alone with 0.7.0; the contracts hold; bandit and pip-audit are clean; the hello image imports the new modules.
- 2026-10-25: 1.6 built.
  - **Atomic start:**
    - One `with_transaction` checks for a tombstone, finds the target's lock and returns the running job if there is one. Otherwise it upserts the target (`status: generating`, the lock, insert-only fields) and inserts the job.
    - Concurrent starts conflict on the target document, MongoDB retries the loser, and the loser then sees the lock. A duplicate key from two first inserts is retried up to 3 times.
    - A lock naming a job that has ended or no longer exists is taken over.
    - Locks are `active_job_id`, or `active_jobs.<type>` (grow, transform).
  - **The job's target:** stored as `{collection, id, lock}`, so completion and failure release exactly that lock. A result is dropped (the job fails with `cancelled` or `superseded`) if the child or user has a tombstone, or if the lock moved on.
  - **Claims and retries:** a worker takes the oldest due job in its region's locations (`None` = unscoped), and a job left `processing` more than 10 min is taken over. Backoff is 30 s doubling, capped at 15 min; `permanent=True` (no provider configured) skips the retries. `completed_at` is set on completed and failed jobs, and errors are cut to 500 characters.
  - **LLM:** today's providers and default models, the timeout on every call (Gemini, synchronous, also gets an outer timeout in its thread), and one `llm_call` log line per call with tokens, duration and outcome, never the prompt. Unusable answers are `LlmResponseError` (retryable); a missing provider is `LlmConfigError` (permanent).
  - **Hourly limit:** today's sliding-window Lua script, keyed `llm:hourly:{user_id}`, so every circle shares one count; per task while Valkey is down, retried after 30 s; `enforce` gives a 429.
  - **Prompts:** parent data goes into `[DATA name]` JSON blocks, a forged `[END DATA]` inside a value is broken up, and every `$placeholder` must be filled and every value used.
  - **Checked locally:** the 1.6 check list passed against the compose replica set: 5 concurrent starts made 1 job; a failed job insert (another service's job type, refused by the validator) left no target document; another region's job wasn't claimed. common at 100% line and branch coverage (373 tests). The shared suite, run as CI runs it: 1,527 passed, 99.84%. hello and auth install alone with 0.8.0; `common[generation]` installs and imports with today's SDK pins. The contracts hold; bandit, semgrep and pip-audit are clean.
- 2026-10-25: 1.7 built.
  - **Keys:** `uploads/{location}/{child_id}/{avatar|ninety-day-plan}/{uuid}.{ext}`. A key is accepted only under this child's prefix *for its kind*, so a plan photo can't become an avatar, and transform's cleanup can't touch children's avatars. It's a strict pattern: UUIDv4 ids, the allowed extensions, no `..`.
  - **Keys only:** today's acceptance of our own bucket URLs (for released mobile builds) isn't carried over; the deployment is fresh and the clients send keys.
  - **Errors:** each `UploadError` carries the API's error code: `unsupported_image_type`, `invalid_avatar_key` / `invalid_photo_key`, `not_uploaded`, `too_large`, `uploads_not_configured`.
  - **Endpoints:** in AWS, presigned URLs are virtual-hosted SigV4 on the regional endpoint, as today. With `AWS_ENDPOINT_URL` set (Moto) they're path-style, and `AWS_PUBLIC_ENDPOINT_URL` gives them the browser's address while the service calls the container's.
  - **Checked locally:**
    - The 1.7 check list passed against Moto: a 6 MB object is `too_large` (exactly 5 MB is accepted); a plan-photo key, another child's, another location's, a path trick and a URL are all `invalid_avatar_key`.
    - A real presigned PUT and GET ran end to end through a Moto server started in the test, so it runs in CI too.
    - The tests never read this machine's AWS profile.
    - common at 100% line and branch coverage. The shared suite, run as CI runs it: 1,544 passed, 99.85%. hello and auth install alone with 0.9.0; `common[uploads]` installs with today's boto3 pin. The contracts hold; bandit, semgrep and pip-audit are clean.
- 2026-10-25: **Phase 1's tasks (1.1–1.7) are all built locally.** Gate 1 still needs its demo: a service built only on `common` that publishes and consumes an event, makes a signed internal call and passes the route-policy test. hello is the natural candidate (it already serves both ports), then the full `./check.sh`.
- 2026-10-25: **Gate 1 met locally.** hello is the demo, built only on `common` (0.9.0).
  - **What it does:**
    - `POST /pings` (signed in) writes a ping and its `hello.pinged` outbox row in one transaction.
    - `python -m hello.worker` relays it to hello's topic and consumes it from hello's queue into a version-checked copy.
    - `GET /pings/{id}/via-internal` reads it back through a signed internal call to `GET /internal/pings/{id}`, which allows only the `hello` caller (another service's token gets 403, none 401).
    - Every route on both apps declares a policy.
  - **The demo event:** `hello.pinged` is in the catalogue (producer and consumer hello), so the TopicArn check, the topology (now 9 topics and 9 queues locally) and `modules/events` (2.4) treat it like any event. That gives Gate 2's "hello publishes and consumes an event in dev" for free. It goes with hello in 8.6.
  - **Without MONGODB_URI** hello serves `/health` and the demo routes answer 503, so the 0.4 image check still runs keyless (checked: `/health` 200, `POST /pings` 503).
  - **Found and fixed while building it:** a collection created implicitly inside a transaction conflicts with a concurrent create (the worker's `ensure_outbox`), and MongoDB aborts the transaction (`WriteConflict`, transient). Services must create their collections at startup (hello's `Demo.prepare()` in the lifespan) and run writes with `session.with_transaction(...)`, which retries transient errors. `add_to_outbox`'s docstring says so.
  - **Checked:**
    - hello's tests (15, 100% coverage) also pass as its CI job runs them: a fresh venv with hello installed alone, live MongoDB and Valkey, and skips counted as failures.
    - The spec regenerates in sync and passes Spectral.
    - The full `./check.sh` (with `MONGODB_TEST_URI` and `REDIS_URL` on the compose stack): **75 of 75 passed**.
