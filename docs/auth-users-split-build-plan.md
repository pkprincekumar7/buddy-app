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
| 5 | Circle services, shared and the Connect visit | 7 | 0 |
| 6 | Deletion end to end | 2 | 0 |
| 7 | Web and mobile clients (alongside Phases 3–5) | 9 | 0 |
| 8 | Hardening | 6 | 0 |
| 9 | Launch | 4 | 0 |
| | **Total** | **59** | **0** |

---

## Phase P: Decisions and prerequisites

Settle these before any code.

- [x] **P.1 Branch strategy.** Decide: merge phase by phase into `develop` (safe, because nothing runs), or one long-lived feature branch. Record the choice here.
  - **Decided (2026-10-25): one long-lived feature branch** (today `feature/develop-changes-2`), merged into `develop` once everything is done. Tasks marked "done locally, waiting for review and merge" are pushed on that branch; they're ticked when it merges.
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

- [ ] **2.1 `modules/alb`.** Needs: P. Allow no catch-all target; fixed 404 at priority 50000 (13.1). **Check:** module tests, including mid-path patterns. *(in progress: done locally, waiting for review and merge)*
  - **As built:**
    - **No catch-all:** at most one catch-all target (before: exactly one). With none, a `not_found` rule at 50000 answers origin-verified requests with a JSON 404; requests without the header still get the listener's 403.
    - **A new `routes` input** (priority, target, 1–3 path patterns) gives one target several rules. It maps one-to-one onto `shared/service-routes.json`, for 2.5. Route rules are keyed `route-<priority>`, and the `targets`-style rules keep their keys, so today's stack is unchanged.
    - **Target group names** are `<app>-<service>-<env>-<hash>`, without `-tg`.
- [ ] **2.2 `modules/ecs-service`.** Needs: P. *Parallel.* An optional `service_discovery` input (Cloud Map registration) and an internal port (8001). **Check:** module tests with and without registration. *(in progress: done locally, waiting for review and merge)*
  - **As built:**
    - **`internal_port`**, a second container port: 8001, or 4318 for the collector, which has no public port.
    - **`service_discovery`** (`namespace_id`, optional `name` = role, `dns_ttl` = 10) creates an `aws_service_discovery_service` with multivalue `A` records and ECS-reported health, and attaches it to the ECS service with `service_registries`.
    - **New outputs:** `service_discovery_arn`, `service_discovery_name` and `internal_port`.
    - The namespace and the `internal-callers` security group come in 2.5.
- [ ] **2.3 `modules/redis`.** Needs: P. *Parallel.* RBAC: a user group and one ElastiCache user per service with IAM authentication, instead of `auth_token` (9.3). **Check:** module tests; the access string per user matches 15.1. *(in progress: done locally, waiting for review and merge)*
  - **As built:**
    - `rbac_services` (per service: `writes_authz`, auth only; `llm_limit`) creates one `aws_elasticache_user` each (engine valkey, IAM authentication, user ID = user name = `<app>-<env>-<service>`), an optional disabled `default` user, and a user group. The replication group then takes `user_group_ids` instead of `auth_token`; setting both is refused.
    - **Outputs:** `replication_group_arn`, `rbac_user_names`, `rbac_user_arns` (for each task role's `elasticache:Connect`, 2.5) and `rbac_access_strings`.
    - Today's `auth_token` mode is unchanged.
- [ ] **2.4 `modules/events` (new).** Needs: P. *Parallel.* *(in progress: done locally, waiting for review and merge)*
  - One SNS topic per producing service;
  - one SQS queue + DLQ per consumer, subscribed to the topics it needs, with **raw delivery off**;
  - queue policies allowing `sqs:SendMessage` only from those topics;
  - filter policies, and alarms on DLQ depth and oldest-message age (7.2, 15.5).
  - **Source of truth:** `backend/common/events/catalogue.json` (`jsondecode(file(...))`), so Terraform and the services' TopicArn check can't drift. `python -m common.events.topology --prefix <app>-<env>` prints the topics, queues and per-topic filter lists the module should build.
  - **Check:** module tests.
  - **As built:** `modules/events` reads the catalogue (`catalogue_path`, defaulting to the repo's file).
    - **Topics:** one per producer (9, hello included), encrypted with the environment's customer-managed KMS key (rotating).
    - **Queues:** one per consumer, with a DLQ after `max_receive_count` (5); SSE-SQS, 20 s long polling, 14-day DLQ retention, and only the service's own queue may redrive into its DLQ.
    - **Subscriptions:** one per (consumer, producer topic), with the `event_type` filter on message attributes and raw delivery off.
    - **Queue policies:** `sqs:SendMessage` only from the subscribed topics (`aws:SourceArn`).
    - **Alarms (`enable_alarms`):** DLQ depth > 0, and oldest message > 10 min, both `notBreaching`.
    - **Outputs:** `topic_arns`, `queue_urls`, `queue_arns`, `dlq_arns`, `subscriptions`, `key_arn` and `prefix`.
- [ ] **2.5 `infra-live-backend` stack.** Needs: 2.1–2.4, 0.4.
  - `services.tf`: one entry per runtime (17 plus `otel-collector`), with `image_repository` and `secret_name`; the dev/sbx/stg/prod sizes from 15.3.
  - `ecs.tf`: per-service execution and task roles. `iam.tf`: per-service policies:
    - S3: children `…/avatar/*` only, transform `…/ninety-day-plan/*` only, shared the APK prefix;
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
  - *(in progress: done locally, waiting for review and merge; the dev `terraform plan` is 2.7's, with the workflows from 2.6)*
  - **As built:**
    - **`services.tf`** derives the runtimes from `split_services` and `generating_services` instead of listing them: 9 HTTP runtimes, 8 workers (`<service>-worker`, none for shared) and `otel-collector`. Each runtime's size comes from one of five tiers in the new `runtime_sizes` variable (`http`, `auth`, `worker`, `generating-worker`, `collector`), which replaces the per-service sizing variables. The tfvars carry 15.3's sizes; prod uses the **lean** variant (one task per worker, decided in 2.5).
    - **Environment:** every service runtime gets `SERVICE_NAME`, its own `MONGODB_DB_NAME` (= the service), `MONGODB_MAX_POOL_SIZE` (5), `REDIS_URL` + `REDIS_USERNAME` (its RBAC user), `INTERNAL_DNS_SUFFIX`, `INTERNAL_SIGNING_KID`, `INTERNAL_PUBLIC_KEYS` and `OTEL_EXPORTER_OTLP_ENDPOINT`. Workers also get their own `EVENTS_TOPIC_ARN` / `EVENTS_QUEUE_URL`; the generating services get the LLM settings.
    - **Secrets:** one `<app>/<env>/<service>-secrets` per service with REPLACE_ME placeholders. A generating circle's HTTP runtime doesn't get the LLM keys; only its worker does.
    - **Service-token keys (decided in 2.5: Terraform generates them):** `service_tokens.tf` makes one `tls_private_key` (Ed25519) per service. The private key goes into an SSM SecureString in the region, injected as `INTERNAL_SIGNING_KEY`; the public map goes to every runtime and to `/<app>/<env>/backend/<region>/internal_public_keys`. The kid is `<service>-v<n>`, and bumping `service_token_key_versions[service]` rotates it. The private keys are also in Terraform state. The `hashicorp/tls` provider was added.
    - **IAM:** one execution and one task role per runtime. The execution role reads only its service's secret and signing key. Task policies: `valkey` (`elasticache:Connect` as its own user), `metrics` (`PutMetricData` in `Superpower/<service>`), `s3-uploads` (children's and transform's prefixes), `events` (workers: publish to its own topic with the KMS key, consume its own queue), `s3-apk` (shared) and `xray` (collector only).
    - **Cloud Map:** the `<app>-<env>.internal` namespace. HTTP services register on 8001, the collector as `otel-collector` on 4318, and they admit those ports only from the `internal-callers` group, which every service runtime joins.
    - **Collector:** `otel_collector.tf` is the ADOT config (`AOT_CONFIG_CONTENT`). It tail-samples (errors, latency > 2 s, then `xray_default_sampling_rate`) and exports to X-Ray. The X-Ray sampling rules, `enable_adot_sidecar` and `enable_xray_error_rule` were removed.
    - **Events:** `modules/events` gets a new `services` input, which builds only events between the deployed services. The catalogue still holds hello's demo event, which the stack must not create. The stack passes `split_services`.
    - **Scaling:**
      - HTTP runtimes scale on CPU, memory and ALB requests;
      - workers have a CPU floor (no scale-in), plus step scaling on queue depth (out at > 100, in at ≤ 10 for 5 min) and, for the generating ones, `PendingJobCount`;
      - the collector scales on CPU.
    - **Alarms:** `pending_jobs_high`, `processing_stuck` and `pending_jobs_missing` per generating service, and `outbox_stale` per worker. The dashboard is built in HCL (`dashboard.json.tpl` was removed).
    - **SSM / outputs:** the `ecs_services` manifest adds `image_service` and `ecr_repository_url` per runtime, with empty values for the collector, and the single `ecr_repository_url` parameter was removed. New outputs: `ecr_repository_urls`, `service_secret_arns`, `internal_dns_namespace`, `event_topic_arns` and `event_queue_urls`.
    - **Checked:**
      - `terraform validate`, `terraform test` (stack 5/5, events 6/6) and tflint;
      - checkov and trivy config: 0 failed. New skip: CKV_AWS_337 on the signing keys, which use the AWS-managed key like the secrets.
    - **Deviations:**
      - Worker scale-in is a separate queue-low step policy, not 15.5's combined metric-math alarm.
      - The collector's tail sampling sees a whole trace only when one task gets all of its spans. With 2 collector tasks (stg/prod), a trace's spans can be split between them, so a load-balancing exporter tier is needed before relying on the sampling there.
    - **Follow-ups:**
      - **Valkey clients:** the services' Redis clients need an IAM-token credential provider (`REDIS_USERNAME` + a SigV4 token) before they can connect in AWS (Phase 3, with `common`). *(Done: `common.valkey`, buddy-common 0.10.0; see the 2026-10-25 note.)*
      - **Workflows:** done in 2.6.
      - **hello in 2.7:** the hello image has no `<service>.worker` modules, so the worker runtimes can't start on it as-is.
- [ ] **2.6 Workflows and scripts.** Needs: 2.5.
  - `deploy-live-backend.yml`: a build matrix with one image per selected service into its own repository (15.2).
  - `promote-live-backend.yml`: copy each service's image between its repositories.
  - `restart-live-backend.yml`: service help text.
  - `scripts/ecs-services.sh`: per-service repository URLs from the SSM manifest. `scripts/check-service-lists.sh`: the new runtime names.
  - *Done early in 2.5:* `check-service-lists.sh` now derives the runtime list from `split_services` (the stack test asserts the real manifest order), and the three workflows' `service` help text lists the 18 runtimes.
  - *(in progress: done locally, waiting for review and merge)*
  - **As built:**
    - **Deploy:**
      - a `resolve` job lists the selected runtimes and their images (`image_services`: one per service) and fixes the tag once;
      - a `build` matrix builds each with `--build-arg SERVICE=<service>` and pushes it to that service's repository in every selected region (`repository_for`, from the manifest);
      - the per-region `deploy` rolls each runtime onto its own repository's image.
      The collector runs the pinned `otel_collector_image`: `all` skips it, and naming it is an error (`image_runtimes`). A new optional `build_from` input builds every image from one service's code, the hello placeholder for 2.7.
    - **Promote:** the export records each runtime's `image_service`; the promote job pushes each (service, image) pair into that service's target repository, and rolls each runtime onto its own. The collector isn't promoted.
    - **Restart:** no logic change (help text only). It still restarts the collector.
    - **`terraform-live-backend.yml`:**
      - `REDIS_AUTH_TOKEN`, `TF_VAR_redis_auth_token`, `TF_VAR_mongodb_db_name` and the single-secret fill were removed;
      - `MONGODB_URIS` (a JSON object, service → its own URI) and `EMAIL_HMAC_PEPPER` are new required secrets;
      - the new `scripts/fill-service-secrets.sh` fills every service's secret on its first apply. It takes the keys from the secret itself, never overwrites a filled one, and writes nothing unless every secret that needs filling can be.
    - **Tests:**
      - `scripts/fill-service-secrets.test.sh` is new (12 cases, fake `aws`, fake values);
      - `ecs-services.test.sh` gains the three new helpers (29 pass);
      - both run in `check.sh` and CI, with shellcheck.
  - **Check:** `scripts/ecs-services.test.sh`, `check-service-lists.sh`, shellcheck.
- [ ] **2.7 First dev apply (infrastructure only).** Needs: 2.6, P.3.
  - Fresh `terraform-live-backend` apply in dev, with no images deployed. The real services are deployed from Phase 3 onwards, as each one is built. Until then, the ECS services have no image to start (their task definitions point at `:latest`, which no repository holds yet), which is expected.
  - **Before it:** in the `dev` GitHub environment, add `MONGODB_URIS` (one Atlas user per service, P.3) and `EMAIL_HMAC_PEPPER`; delete `MONGODB_URI` and `REDIS_AUTH_TOKEN`.
  - Checked by hand in dev:
    - the apply succeeds, and the 9 service secrets are filled (no `REPLACE_ME` left in a required key);
    - the Cloud Map namespace `<app>-dev.internal` exists, with a service for each of the 8 internal APIs and the collector;
    - an SNS → SQS round trip works: a test message published to one topic with an `event_type` attribute reaches only the queues subscribed to that event;
    - the ALB returns the fixed 404 for an unknown path with the origin-verify header, and 403 without it;
    - ElastiCache accepted the RBAC users' access strings, including `%R~`, and the user group with or without the default user (2.3).
  - **Moved to the first service deploy (3.1):** each runtime registering in Cloud Map, and an internal call over port 8001 with a service token.
  - **Check:** the items above; no manual console changes.

**Gate 2:** `./check.sh` passes, including checkov and trivy config; the dev infrastructure is applied and passes 2.7's checks. Real services are deployed from Phase 3, not on a placeholder.

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
  - **First deploy to dev (moved from 2.7):** users and users-worker run their own image; users registers in Cloud Map (`users.<app>-dev.internal`), and a signed internal call to it on 8001 succeeds while an unsigned one is refused.
  - *(in progress: code done locally, waiting for review and merge; the dev deploy waits for 2.7)*
  - **As built** (`backend/users/`, the same shape as hello: `app/runtime.py`, `app/store.py`, `app/main.py`, `worker.py`):
    - **`users.users`:** validator and the `{location, _id}` unique index, created at startup with `outbox` and `tombstones`. The optional `{location, last_name, first_name}` admin-search index isn't added: no endpoint searches by name.
    - **Endpoints:** the seven in the API reference, every route on a `PolicyRouter`.
      - Reads and writes are filtered by `{_id, location}`: your own location, or an admin's `?location=`. An admin without it gets `422 location_required`.
      - Someone else's id is refused by `require_self_or` with a plain 404. An exception handler gives every 404 on a `{user_id}` route the `profile_not_found` body, so a refusal and a missing profile look the same and ids can't be probed.
      - Rate limits are per user (60/min reads, 30/min writes), keyed under `users` as its Valkey user requires (2.3).
    - **Auditing:**
      - `GET /profiles` records one privileged event per id requested, after `require`'s own;
      - an admin's PATCH records a second event carrying the changed field **names**, since `require_self_or` runs before the body is known.
    - **`PUT /internal/users/{id}`:**
      - a retry with the same body writes nothing, and a changed one bumps `version`;
      - a different location is `409 location_mismatch`;
      - **decided here:** a tombstoned id is `409 profile_deleted`, so a deleted account's profile can't come back (7.4);
      - a concurrent insert answers as "already existed"; if the profile was also deleted in between, it's `409 profile_conflict` and the saga retries.
    - **Worker:** relay plus a `user.deletion_requested` handler. It deletes the profile, writes the `user:` tombstone (version = the event's) and queues `user.data_deleted`, in one transaction. It always confirms, even with no profile, and a redelivery confirms again, which auth's `$addToSet` ignores.
  - **Checked locally:**
    - `pytest users/tests`: 46 passed, 100% line and branch coverage. They cover the route-policy test, the ownership matrix, validation, auditing, the rate limit, the internal API, and the deletion handler (replay-twice, consumer contract, a forged topic rejected, and the SQS → worker → relay round trip on Moto);
    - ruff, mypy, bandit, import-linter (3 contracts kept) and `tools/services.py --check` (3 services);
    - `backend/openapi/users.json` exported, and Spectral is clean;
    - `common.serve` builds both servers.
  - **Not run yet:** a `docker build --build-arg SERVICE=users` (it downloads packages; left for the full `check.sh` or CI), and the dev deploy.
  - **Still open:**
    - the Valkey IAM-token credential provider in `common`, needed before users can reach Valkey in AWS; *(Done: `common.valkey`, buddy-common 0.10.0; see the 2026-10-25 note.)*
    - a users container in `docker-compose.yml` for the local gateway's `/api/v1/users/*` route.
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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/auth/`):
    - `emails.py`, `app/store.py`, `app/tokens.py`, `app/authz_cache.py`, `app/throttle.py`, `app/sessions.py`, `app/registration.py`, `app/runtime.py`, `app/main.py`, `seed.py`.
    - **Collections:** all eight, with validators and the section-14 indexes, created at startup with `outbox` and `tombstones`. The sessions TTL index replaces today's cleanup task. The `{status, reserved_at}` index is partial on `reserved`.
    - **Emails:**
      - `normalise()` trims and lower-cases, nothing else. `email-validator` only checks that an address is valid; it no longer normalises.
      - `EMAIL_HMAC_PEPPER` is one pepper (v1), or, during a rotation, a JSON object of version → pepper with the highest version current. **Decided here:** it's still one secret key, so the Terraform secret and the fill script need no change for a rotation.
      - Lookups try the current pepper first; the allow-list and registration's "taken" check look at every version (6.5).
    - **The saga** (`registration.py`) is shared by register and Google sign-up. The undo order and responses follow the API reference, with these additions:
      - **Takeover cleanup:** if the old attempt's profile can't be deleted, the stale row is put back as it was (`503`). Otherwise neither the reaper nor anyone else could find those leftovers again. The old credentials are deleted only after the profile is gone.
      - **users refusing the profile** with a 4xx is `500 registration_failed`, after the undo; unreachable or 5xx is `503`.
      - **A reservation removed under the duplicate check** (the reaper) is `409`, and the client may retry.
    - **Sign-in** issues tokens with `role` and `iat_ms` (access) and `family_id` (refresh), writes the session row and cookies, and writes `authz:{id}`.
      - **Decided here:** the versioned Lua write that 3.3 lists is built now, because 3.2's sign-ins need it. It accepts only a strictly higher `ver`, or the same `ver` with identical canonical JSON, with a TTL of 1 h. 3.3 reuses it.
      - auth is its own authz fill: it reads `auth.auth` instead of calling itself.
    - **Login:** the per-key-and-IP throttle (5 / 15 min, keyed `auth/login-failures/<key[:16]>/<ip>`) runs before any lookup. The dummy bcrypt check covers unknown, reserved and being-deleted accounts, and the lock is checked only after the right password.
    - **Refresh:** rotation marks `rotated_at` / `replaced_by`. Within 30 s a reused token gets a pair in the same family; later it deletes the family, sets `tokens_revoked_at`, bumps `authz_version` and writes the cache. The milliseconds comparison is `revoked_at_ms >= iat_ms`. Every refusal clears both cookies.
    - **`logout-all`:** one transaction (revocation, `$inc authz_version`, delete the sessions), then the cache write.
    - **Startup check:** auth refuses to start if `JWT_PUBLIC_KEYS[JWT_KEY_ID]` isn't the public half of `JWT_PRIVATE_KEY`.
    - **Local seed:** `python -m auth.seed` (`APP_ENV=local` only) upserts `LOCAL_ALLOWED_EMAIL` into the allow-list as an HMAC key with a masked hint. `EMAIL_HMAC_PEPPER` and `LOCAL_ALLOWED_EMAIL` were added to both `.env.example` files.
  - **Checked locally:**
    - `pytest auth/tests`: 109 passed, 100% line and branch coverage, against the compose Mongo and Valkey. They cover:
      - a failure at every saga step: unsaved credentials, users down / 5xx / 4xx, a failed undo leaving everything for the reaper, the reservation reaped before activation;
      - the stale-reservation takeover, its failed cleanup, and a takeover lost to another attempt;
      - the pepper-rotation duplicate and allow-list checks;
      - refresh reuse after 30 s revoking the family and every older token;
      - the throttle and its Valkey fallback, and the Lua write against real Valkey (a slow write can't undo a lock);
      - logs carrying `email_key`, never the email.
    - ruff, mypy, bandit, import-linter (3 contracts kept) and `tools/services.py --check`;
    - `backend/openapi/auth.json` exported, and Spectral is clean.
  - **Not run:** `docker build --build-arg SERVICE=auth`, and the dev deploy.
  - **Known gaps, by design or for later tasks:**
    - Without Valkey, a revocation reaches each task's 30-second in-process copy only when it expires (9.3). With Valkey, sign-in, logout-all and reuse write the new entry at once.
    - `auth-worker`: built in 3.3.
    - auth's audit records go to the log sink only; the `audit` collection sink comes with the admin endpoints (3.4).
    - The Valkey IAM-token credential provider in `common` is still open (also for users). *(Done: `common.valkey`, buddy-common 0.10.0; see the 2026-10-25 note.)*
- [ ] **3.3 auth: authz cache.** Needs: 3.2.
  - The worker: the change stream over **all** of `auth.auth` in each region, the versioned Lua write (strictly higher `ver`), 1 h TTL, the reservation reaper (9.3).
  - [ ] `GET /internal/authz/{user_id}`
  - **Check:**
    - a slow fill can't overwrite a lock;
    - every authz-changing write increments `authz_version`;
    - a Valkey outage falls back to the 30-second cache.
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built:**
    - **`GET /internal/authz/{user_id}`** (`app/main.py`) is open to the services that verify tokens: users, children, the four circles, shared and hello; auth itself gets 403. It returns the entry and refills the region's cache through the versioned write; no account, or a non-UUID id, is 404. `common.internal_client.authz_fill` was tested end to end against it.
    - **The change stream** (`app/authz_stream.py`) watches every `update`, `replace` and `delete` on all of `auth.auth`, with `updateLookup`:
      - it rewrites `authz:{id}` only if the region already holds it (a new `only_existing` mode of the versioned Lua write) and drops the entry of a deleted account;
      - **decided here:** the resume token is kept in a new tiny unsharded `worker_state` collection (`authz-stream:<region>`), saved after every change and as the cluster's time advances;
      - a token the oplog no longer has (codes 260 / 280 / 286) restarts from now; other errors retry after 5 s.
    - **The reaper** (`app/reaper.py`) runs every minute over reservations older than 15 minutes, 100 at a time, in its own region's locations only (every location locally).
      - **Decided here:** it claims a row by deleting it (an exact match on the row read) **before** cleaning up. A saga activating it in that moment fails its conditional activation and undoes itself, so an account can never become active after its credentials are gone.
      - It then deletes the profile through users and the credentials. If users can't confirm, it puts the row back to retry, unless a new registration has taken the key meanwhile.
    - **Every authz change bumps the version:** `store.authz_change(fields, now)` builds every update to role, lock, deletion or revocation with `$inc: {authz_version: 1}`, and refuses other fields. logout-all and refresh reuse use it, and a test scans `auth/app/` for any other `$set` of those fields.
    - **Worker:** `python -m auth.worker` runs the stream and the reaper; the relay and the `user.data_deleted` consumer join in 3.5.
  - **Checked locally:**
    - `pytest auth/tests`: 124 passed, 100% line and branch coverage. The three checks:
      - **a slow fill can't overwrite a lock:** a fill reads the account, the stream applies the lock (ver 2), and the fill's write of ver 1 is refused;
      - **every authz change bumps the version:** the helper's tests and the source scan;
      - **a Valkey outage falls back to the 30-second cache:** with Valkey unreachable, three requests cost one `auth.auth` read, and a lock takes effect once the 30 s are up.
    - Also covered: the stream (only held keys, deletes, resuming after a stop, a lost token), the reaper (region scope, users down, a row that changed meanwhile, a key taken by a new registration), the worker loop, and the endpoint's callers;
    - ruff, mypy, bandit and import-linter; the public spec is unchanged (the new route is internal).
  - **Needs in AWS:** change streams need the dedicated Atlas tier (M10+, P.3) (the IAM-token Valkey client is done: `common.valkey`).
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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`auth/app/admin.py`, `auth/app/audit.py`; the shared dependencies moved to `auth/app/deps.py`):
    - **All nine endpoints**, each behind its permission (`accounts:list` / `:lock` / `:role`, `allowed_emails:read` / `:write`) and limited to 60/min per user. Searches are `POST`s with the email in the body, and allow-list entries are removed by HMAC key, so no email is ever in a URL.
    - **The admin counter** (`admin_count {_id: "admins", active}`) counts unlocked admins:
      - locking, or demoting an unlocked admin, first does `$inc: -1` matching only while `active > 1` (`409 last_admin` otherwise);
      - the account update then matches exactly the role and lock it read. If it misses, the counter is put back and the step retried, up to three times. **New code:** `409 account_changed` when it keeps missing.
      - Unlocking an admin, or promoting an unlocked account, adds one. Demoting or promoting a locked account leaves it alone.
      - Already-so requests (lock a locked account, the same role) answer 200 and change nothing.
    - **Lock and role change** set `tokens_revoked_at`, end the sessions and write `authz:{id}` through `authz_change` (so `authz_version` goes up). **Unlock keeps `tokens_revoked_at`**: old tokens stay invalid, and the user signs in again.
    - **Audit:** `AuthAuthorizer` (common's Authorizer) also writes every recorded check to auth's `audit` collection, with the caller's location, because `common.audit.AuditEvent` has none. Rows are inserted as their own task, after the change and never in its transaction; a failure is logged.
      - Each change adds an event with the changed field **names**.
      - A role change logs `audit.role_changed` as the line for 11.3's alarm. The CloudWatch metric filter and alarm on it are a follow-up in `infra-live-backend` (Phase 8).
    - **Found while testing:** adding `" Name@Example.com "` to the allow-list was refused, because the address was validated before trimming. It's now normalised first, as register does.
  - **Checked locally:**
    - `pytest auth/tests`: 142 passed, 100% line and branch coverage. The plan's checks:
      - two admins demoting each other at once (`asyncio.gather` on the live stack) leave exactly one admin and a counter of 1;
      - unlock keeps `tokens_revoked_at`, and the pre-lock token stays refused;
      - no route path takes an email, searches are `POST`, and no audit row or service log line (at INFO, as deployed) holds an `@`.
    - Also covered: the permission matrix with every denial audited, the counter rules, a lost race retried with the counter put back, and the allow-list with a pepper rotation and a concurrent add;
    - ruff, mypy, bandit and import-linter; `backend/openapi/auth.json` re-exported, and Spectral is clean.
  - **Deviation from the API reference, recorded:** `GET /internal/authz/{id}` (3.3) takes no `?location=`, because `common.internal_client.authz_fill` sends only the user id. The read is by `_id` (once sharded, a scatter read). Adding the location means changing common's fill signature and the services' calls, a `buddy-common` version bump; it's left until the cluster is sharded.
  - **Not here:** the first admin's `promote-admin` tool is its own later task (it also seeds the counter).
- [ ] **3.5 auth: account deletion and email lookup.** Needs: 3.4.
  - Endpoints:
    - [ ] `DELETE /api/v1/auth/account` (the start of the saga, 10.3; `deletions` outside the transaction)
    - [ ] `GET /internal/auth/users/{user_id}/email` (no callers allowed yet)
  - The worker: `user.data_deleted` confirmations taken from the TopicArn, the 24 h alarm, credentials deleted last.
  - **Check:** the saga completes with users as the only participant so far; a confirmation carrying another service's name in its payload is ignored.
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`auth/app/deletion.py`, `auth/worker.py`):
    - **`DELETE /api/v1/auth/account`** (3/min per user; `202 {"status": "deleting"}`):
      - checks `confirm_email` (normalised) against the account, and takes a non-locked admin off the counter first (`409 last_admin`); the counter is put back if the start fails;
      - then one transaction (`is_being_deleted` + `tokens_revoked_at` through `authz_change`, every session deleted, and the `user.deletion_requested` outbox row, version = the new `authz_version`);
      - then the `deletions` upsert outside it, the `deleting` cache entry, and cleared cookies;
      - a second request that a task's 30-second cached entry lets through is a 401, not a second deletion.
    - **`GET /internal/auth/users/{id}/email?location=`:** `allow_callers` refuses an empty list, so it has its own policy, which verifies the service token and allows only `EMAIL_CALLERS`. That list is **empty**, so every caller gets 403. A future caller is added there, and every read is audited (`emails:read`).
    - **The worker** adds the outbox relay (publishing `user.deletion_requested`), the `user.data_deleted` consumer and the stuck report to the stream and the reaper:
      - each confirmation is recorded as `received.source_service`, from the topic, with `$addToSet`. The payload is never read, so one service can't confirm for another;
      - a confirmation that arrives before the `deletions` row creates it;
      - when `confirmed ⊇ expected`, it deletes `email_index`, then `auth.auth`, then `authz:{id}`, then the row: credentials last.
    - **Decided here: the participants.** `common.deletion.PARTICIPANTS` lists all seven services, so with every one expected, no deletion could finish until all are built. auth takes `DELETION_PARTICIPANTS`, a subset in the catalogue's order, defaulting to all seven. `services.tf` sets it to `users` for auth and auth-worker (`local.deletion_participants`): **add each service there as it ships.**
    - **Decided here: the 24 h alarm.** `common.metrics` deliberately allows only the 15.5 metrics, so instead the worker logs `auth.deletion.stuck id=… waiting_for=…` every 10 minutes for each of its region's deletions over 24 h. A log metric filter on the auth-worker's log group (`Superpower/auth` `StuckDeletions`) and an alarm (`enable_all_alarms`) were added to `cloudwatch.tf`.
  - **Checked locally:**
    - `pytest auth/tests`: 153 passed, 100% line and branch coverage. They cover:
      - **the saga completes with users as the only participant:** the request, then users' confirmation from its own topic; the credentials go, and the email registers again;
      - **a confirmation naming another service in its payload is ignored:** users' event saying `children` counts only for users, and a topic from a non-data service is rejected;
      - the worker end to end on Moto (the relay publishes to auth's topic and SNS delivers to users' queue; users' confirmation reaches auth's queue and the worker finishes), the last-admin rule, the counter put back on a failed start, the stuck report, and the email endpoint refusing every caller;
    - `infra-live-backend`: validate, `terraform test` (5 passed, with the new assertions), tflint, checkov (0 failed) and trivy config;
    - ruff, mypy, bandit, import-linter and Spectral.
- [ ] **3.6 First admin tool.** Needs: 3.4.
  - `backend/tools/promote-admin.py`: once per environment, refuses if an admin exists, writes an audit event, increments the admin counter (11.4).
  - **Check:** a second run refuses.
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built:** `python -m auth.promote_admin` (`backend/auth/promote_admin.py`).
    - **Decided here, against the plan's path:** it's a module of the auth service, not `backend/tools/promote-admin.py`, because the auth image ships only `backend/auth/` and prod has ECS Exec off. So 9.2 runs it as a one-off ECS task on the auth image, with this command.
    - **By user id (`--user-id`)**, so no email is in a command line, task override or CloudTrail; locally `--email-stdin` reads the email instead. The account must be a parent, and neither locked nor being deleted.
    - **Once:** it refuses if any account is an admin. The admin counter is the atomic gate: it inserts `{active: 1}`, or claims `active < 1 → 1`. If the account changed before the update, the counter is put back to 0.
    - **The change:** `authz_change({role, tokens_revoked_at})` and the sessions deleted, so the next sign-in carries the role. Each region's worker updates its cached entry from the change stream.
    - **Audited:** an `audit` row (actor `promote-admin`) and the `audit.role_changed` log line.
  - **Checked locally:**
    - `pytest auth/tests`: 160 passed, 100% line and branch coverage. They cover a second run refusing (the plan's check), two runs at once making one admin, a counter left at 0 being claimed, a counter that says an admin exists refusing, the refusals, and the counter given back when the account changes meanwhile;
    - ruff, mypy and bandit; `getting-started.md` says how to run it.

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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/children/`, the same shape as users; `buddy-common[uploads]==0.10.0`):
    - **`children.children`:** validator, `{location, _id}` unique, `{location, user_id, is_deleted}` (Home and the 10-limit), and the partial `{deleted_at}` where `is_deleted` (the purge, 4.2).
    - **The seven endpoints**, every route on a `PolicyRouter`.
      - **Ownership:** a parent's queries filter by `{location, user_id}`, so another family's child is `404 child_not_found`.
      - **Writes are parents only:** **decided here:** a role check (`caller.role == "parent"`, `403 parents_only`). The spec has admins refused, and the permission table gives admins every permission, so no permission can express it.
      - **Admin reads** use `children:read:any` with the owner's `?location=` (and `?user_id=` for the list), each audited as privileged; a parent sending `?user_id=` gets 403.
    - **Events:** one `child.changed` with the full snapshot (`user_id`, name, age, gender, `is_deleted`, progress), in the write's transaction: on create, on delete, and on a patch that changes a copied field or completes the profile. A school or avatar change publishes nothing, and the same value again isn't a change.
    - **`progress.profile`** is set by children, one-way, when name, age and gender are first all present. Clearing a field later doesn't unset it.
    - **Photos:** presign (`415 unsupported_image_type`, `502 upload_url_failed`, `503 uploads_not_configured`), then `PATCH {avatar_key}`.
      - **The plan's first two checks:** the key must be under this child's `uploads/{location}/{id}/avatar/` (`422 invalid_avatar_key`), and `HeadObject` must find an allowed image of at most 5 MB (`avatar_not_uploaded`, `avatar_too_large`, `unsupported_image_type`).
      - `avatar_id` and `avatar_key` exclude each other; a replaced or cleared photo is deleted after the change commits, best effort.
    - **`GET /internal/children/{id}?location=`:** for the circles' read-through (onboarding, discover, grow, transform, release), deleted children included.
  - **Checked locally:**
    - `pytest children/tests`: 34 passed, 100% line and branch coverage, on Mongo and Moto (SNS, SQS, S3). They cover the four checks, ownership and the admin reads, the event rules, the profile flag, the photo flow (replace, clear, old objects deleted), S3 failures, a child deleted during a change, the internal read and the rate limit;
    - ruff, mypy, bandit, import-linter (now 4 services) and `tools/services.py --check`;
    - `backend/openapi/children.json` exported, and Spectral is clean.
  - `children-worker` (`python -m children.worker`): built in 4.2. The gateway already routes `/api/v1/children*` to children.
- [ ] **4.2 children worker.** Needs: 4.1.
  - Consumes the completion events (`onboarding.conversation_completed`, `discover.completed`, `grow.completed`, `transform.completed`, `release.completed`) and sets each flag **without** an order check (12.4).
  - Runs the 30-day purge (soft-deleted children, then `child.deleted`).
  - Handles `user.deletion_requested`.
  - **Check:** completion events arriving out of order all set their flags; the purge publishes `child.deleted` with the final version.
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`children/app/lifecycle.py`, `children/worker.py`): the worker runs the relay, the consumer and the purge.
    - **Flags:** the five completion events set `conversation`, `discover`, `grow`, `transform` and `release`, with no order check. The conditional update (`progress.<flag> ≠ true`) means only a real change bumps `version` and publishes one `child.changed`, so a duplicate does nothing.
      - A soft-deleted child still records the flag; a purged or unknown one is skipped quietly.
      - A completion from another service's topic is rejected by the consumer (the DLQ).
      - connect's visit comes with 5.7.
    - **The purge** runs hourly, in batches of 100 until none is left, over its region's locations (every location locally), for children deleted more than 30 days ago:
      - the avatar objects first (only `…/avatar/`: plan photos are transform's to delete);
      - then one transaction: the document, matching exactly the version read so a child restored meanwhile isn't purged, plus a `child:` tombstone and `child.deleted` (`{user_id}`), both at the final version (the last version + 1).
    - **Account deletion:** every child of the user goes at once, soft-deleted or not, with no 30-day wait: the avatars, then one transaction for the documents, a `child:` tombstone each (version + 1), the `user:` tombstone and `user.data_deleted`.
      - It always confirms, even with no children, and a redelivery confirms again.
      - **Decided here:** no `child.deleted` per child. The circles consume `user.deletion_requested` themselves.
  - **Checked locally:**
    - `pytest children/tests`: 43 passed (9 new), 100% line and branch coverage with `REDIS_URL` set, as in CI. They cover:
      - **the out-of-order check:** the five events arrive backwards and every flag is set, with one snapshot per change;
      - **the purge check:** the final version 3 (create 1, soft delete 2, purge 3) on both `child.deleted` and the tombstone;
      - a duplicate (replay-twice), the consumer contract, a forged completion, a restored child not purged, the region scope, account deletion (including soft-deleted children, another parent's kept, avatars, tombstones, re-confirmation), no uploads bucket, the purge loop's retry and full batches;
      - the worker end to end on Moto: discover's event is consumed, the old child purged, and `child.changed` and `child.deleted` reach grow's queue from children's topic.
    - ruff, mypy, bandit and import-linter.
  - **Deletion participants:** children can now confirm account deletion. Add `children` to `local.deletion_participants` in `services.tf` when children is deployed (3.5).

**Gate 4:** `./check.sh` passes; in dev, Home lists children with progress from one query.

---

## Phase 5: Circle services and shared

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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/onboarding/`, the same shape as children; `buddy-common==0.11.0`):
    - **`onboarding.conversations`:** `_id` = the child id, the seven answers (validator with the API's limits), `completed_at`, `version`; `{location, _id}` unique, `{location, user_id}` (account deletion). Plus `child_access` (common.models), `outbox`, `tombstones`. No `jobs`, no `inbox`: it calls no LLM, and every handler is safe to run twice.
    - **Access** (`onboarding/app/access.py`), the pattern the other circles follow:
      - the `child_access` copy answers; a missing one is read through from `GET /internal/children/{id}` and stored as a version-checked upsert (never over a tombstone); a purged child (a `child:` tombstone) is 404 without asking;
      - ownership by `user_id` and `is_deleted`: `404 child_not_found`;
      - unlock on `progress.profile`, confirmed with children before `403 circle_locked`; children's answer is stored the same way (12.4's exception), never as a `confirmed` flag;
      - children unreachable or answering anything but 200 / 404: `503 children_unavailable` with `Retry-After: 2`.
    - **Endpoints:**
      - `GET` returns `child_name` from `child_access` too (12.2). Admins with `children:read:any` pass `?location=`, are audited, and skip the unlock check.
      - `PUT` validates strictly (no coercion; trimmed; 1–20 items of 1–200, texts 1–500). It runs one transaction per attempt: a tombstone check, then insert (201 + `conversation_completed`), nothing (identical answers), or a version-conditional update (200 + `answers_updated`). A lost race (`DuplicateKeyError` or a moved version) is decided again, up to 3 times, then `409 conversation_changed`.
      - **Decided here:** writes need ownership, so an admin's `PUT` on a child is 404 (they have no children); no separate role check.
      - The internal `status` (callers: discover) and `answers` (callers: discover, grow, transform, release; `404` until completed).
    - **Worker** (`onboarding/worker.py`, `onboarding/app/lifecycle.py`): relay (with the outbox-age metric) and consumer:
      - `child.changed` → `child_access`;
      - `child.deleted` → the conversation and copy go, with a `child:` tombstone at the final version;
      - `user.deletion_requested` → every conversation and copy of the user, a `user:` tombstone (covering their children's copies) and `user.data_deleted`, in one transaction.
    - **Found on the way:** the first save's response had `completed_at` in microseconds while MongoDB keeps milliseconds, so a later `GET` showed a different time. Dates are written truncated to the millisecond (`store.to_millis`).
    - **Wired in:** `onboarding` joins `DELETION_PARTICIPANTS` (`services.tf` and compose); compose runs `onboarding` and `onboarding-worker` under the `split` profile (the gateway already routed `/api/v1/children/*/onboarding*`); `scripts/local-keys.py` makes its key; `backend/openapi/onboarding.json`.
    - **Checked locally:**
      - onboarding's 31 tests, at 100%: the plan's three checks, ownership, validation, both races, the internal routes and their callers, the worker end to end on Moto (discover's and children's queues get `conversation_completed`);
      - ruff, mypy, import-linter; the spec, Spectral clean; `terraform test` (5 passed).
    - **Not run:** the full `./check.sh`; the compose stack with onboarding.
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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/discover/`, the same shape as onboarding; `buddy-common[generation]==0.11.0` with the LLM SDKs pinned as in `backend/requirements.txt`):
    - **`discover.personalities`:** `_id` = the child id; `status`, `view_model`, `analysis`, `source`, `active_job_id`, `finalised_at`, `viewed_at`, `version` (validator); `{location, _id}` unique, `{location, user_id}`. Plus `jobs` (`generate_personality_analysis` only), `child_access`, `onboarding_inputs`, `outbox`, `tombstones`.
    - **The port** (`discover/app/personality.py`): today's archetype table, `personalityLlmSchema`, the prompt and `adaptAiPersonalityToViewModel` with `personalizedDescriptionOneLiner`.
      - The prompt puts the child's name, age, gender and answers in data blocks (common.generation.prompts); only server text is in the instructions. `school` is no longer in the questionnaire block: discover's copy doesn't hold it.
      - **The plan's fixture check:** `discover/tests/fixtures/regenerate.sh` copies today's adapter verbatim out of the web app and runs it with Node on 8 fixtures (a full answer, missing or invalid fields, clamping, the description's `{childName}` and `their`, cut sentences, `NaN` scores). The Python port gives the same JSON for all 8.
      - The LLM answer is checked against the schema before anything is stored; a mismatch is retried, and the job's error names the paths only, never the text.
    - **Access** (`discover/app/access.py`): onboarding's pattern, with the unlock on `progress.conversation` confirmed with onboarding (stored as `child_access.confirmed.conversation`, 7.5), and a read-through of the answers when a start comes before `onboarding.conversation_completed`.
    - **Generation** (`discover/app/generation.py`):
      - `start` only from `not_started` / `failed` (`409 already_generated` once ready), through `common.generation.jobs.start_job`. The running job comes back with `200`, and the hourly LLM limit is counted only for a new job.
      - The worker's `process`: copies missing, an LLM error or a schema mismatch is retried with backoff, then `failed`; no provider configured fails at once. `ready` is stored with `discover.personality_finalised` in one transaction; `version` goes 1 (start), 2 (finalised), 3 (viewed).
      - `report_jobs`: `PendingJobCount` and `OldestRunningJobAgeSeconds` every minute from one leader per region (`leader:discover:jobs:<region>`, which its Valkey user may write), in the HTTP runtime's lifespan.
    - **Events:** the automatic start on `onboarding.conversation_completed`. **Decided here:** onboarding's events now carry the child's `user_id` (an optional field in both schemas, onboarding sends it), so discover can start a job before its `child_access` copy arrives; without either, the message is retried. `child.deleted` and `user.deletion_requested` delete the personality and copies and cancel the jobs (`cancel_jobs`), and the deletion confirms.
    - **`personality_finalised`'s `traits`:** `{dominant_style, personality_category, traits, description}`, with the profile's strengths as `strengths`. The internal summary returns the same.
    - **Wired in:** `discover` joins `DELETION_PARTICIPANTS` (`services.tf`, compose); compose runs `discover` (no LLM keys) and `discover-worker` (the keys from `.env`); `scripts/local-keys.py`; `backend/openapi/discover.json`.
    - **Checked locally:**
      - discover's 48 tests, at 100%: the plan's three checks (the race run five times per test; the fixtures; `viewed` refused unless ready), retries, failures, cancellation, the leader, the internal routes, and the worker end to end on Moto with a fake provider behind the real `LlmClient` (grow's queue gets `personality_finalised`);
      - onboarding (31) and common (405) after the schema change; ruff, mypy, import-linter; the spec, Spectral clean; `terraform test` (5 passed).
    - **Not run:** the full `./check.sh`; a real LLM call; the compose stack with discover.
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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/grow/`, the same shape as discover; `buddy-common[generation]==0.12.0`):
    - **`grow.growth_areas`:** `_id` = `{child_id}:{area_id}`; the fields of 12.1 (validator), `active_jobs` (one lock per kind); `{location, _id}` unique, `{location, user_id}`, `{location, child_id, created_at}`. Plus `jobs`, `child_access`, `onboarding_inputs`, `personality_inputs`, `outbox`, `tombstones`.
    - **The port:**
      - `grow/app/area_data.json` is generated from the web app's `growthAreaData.ts` by `grow/tests/fixtures/regenerate.sh`: the six areas, their archetypes (the rounds' tags), the 22 icon keys, the counts, the pronoun tokens.
      - `grow/app/areas.py` ports `normalizeGeneratedQuestions`, `normalizeGeneratedRounds`, `normalizeRecommendations`, `fillTemplate`, `pickedOptions` and `topArchetype`. The same script runs today's normalisers on 20 fixtures, and the port matches all 20. Icons are stored as keys (the apps draw them), and ids are assigned by the server, so `PUT` can check answer keys against them.
      - `grow/app/prompts.py` ports the three prompts with the parent's data in data blocks.
    - **`PUT`:** decided against the area as read, version-conditional, retried up to 3 times (`409 area_changed`); unknown answer keys, generated or unknown fields, `completed → in_progress`, over 64 KB and reserved area ids are 422. Completing publishes `grow.area_completed`, plus `grow.completed` when no other area of the child is completed (counted in the transaction); editing a completed area publishes `grow.area_updated`; an identical save is a no-op.
    - **Generation:** per-kind locks; `parent_questions` creates the area `in_progress`; the question sets once (`409 already_generated`); recommendations need answers. **Decided here:** generation only for the six known areas (`422 unknown_area`): the child rounds need an area's archetypes, and the prompts its description. The copies are read through at the start; the job never touches the area's `status`. Recommendations bump `version`, and for a completed area publish `grow.area_updated` in the job's transaction.
    - **Found on the way, in `common`:** `start_job` set the target's `status` to `generating`, and `fail_or_retry` to `failed`. Right for a personality, wrong for a growth area, whose status is the parent's. Both gained `target_status` (`None` leaves it alone), backward compatible: **buddy-common 0.12.0**, every service pins it.
    - **Events:** grow's two area events carry `user_id`. `discover.personality_finalised` gained it too (optional, discover sends it), so grow keeps its `personality_inputs` copy without waiting for `child_access`.
    - **Wired in:** `grow` joins `DELETION_PARTICIPANTS`; compose runs `grow` and `grow-worker`; `scripts/local-keys.py`; `backend/openapi/grow.json`.
    - **Checked locally:**
      - grow's 74 tests, at 100%: the plan's three checks, the area's whole journey (questions → answers → rounds → picks → recommendations → completion), per-kind locks, both races, retries and failures, the circle rules, the internal routes, and the worker end to end on Moto (transform gets `grow.area_completed`, children `grow.completed`);
      - common (406), discover (48) and onboarding (31) after the `common` change; ruff, mypy, import-linter; the spec, Spectral clean; `terraform test` (5 passed).
    - **Not run:** the full `./check.sh`; a real LLM call; the compose stack with grow.
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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/transform/`, the same shape as grow; `buddy-common[generation,uploads]==0.12.0`):
    - **`transform.plans`:** `_id` = the child id; the fields of 12.1 (validator), `active_jobs`; `{location, _id}` unique, `{location, user_id}`. Plus `jobs`, `child_access`, `onboarding_inputs`, `personality_inputs`, `growth_inputs`, `outbox`, `tombstones`.
    - **The port:**
      - `transform/app/pathway.py`: `lifePathwayAreaSchema`, `buildLifePathwayAreaPrompt` and `normalizeLifePathwayArea`, including the nested-slot repair and the legacy `{milestones}` shape. `transform/tests/fixtures/regenerate.sh` runs today's normaliser on 11 fixtures, and the port matches all 11. What's stored is keyed by slot, so the apps' normaliser reads it back the same.
      - `transform/app/plans.py`: the plan and tracker schemas and prompts. Answers are checked against the schemas before they're stored.
      - Parent data goes in data blocks. **Decided here:** the tracker uses the parent's `ask` instead of the app's keyword-derived interest label.
    - **PATCH:** the API's fields with strict types and map-key patterns. Photos are checked through `common.uploads` (prefix, uploaded, image, ≤ 5 MB), and a field's replaced keys are deleted after the commit. `clear_track_steps`; ≤ 64 KB for the body and the document. Saves are version-conditional with up to 3 attempts (`409 plan_changed`).
    - **Completion:** `complete_if_ready` sets `completed_at` once and publishes `transform.completed`, from PATCH or from the plan job's transaction, whichever comes last.
    - **Generation:**
      - per-kind locks, the Life Pathway's per area (`generate_life_pathway:<area_id>`);
      - `life_pathway` reads grow's areas through when the copy is behind;
      - **decided here:** `plan` needs an `ask` (`409 needs_ask`);
      - the tracker needs the plan and the event;
      - jobs never touch a status (`target_status=None`).
    - **Clearing:** a `child.changed` that was applied and changed `age` or `gender` clears every milestone; an applied `grow.area_updated` clears that area's.
    - **Deletions:** a purged child's or deleted account's plan, copies and photos (`delete_child` on the plan-photo prefix), jobs cancelled, tombstones, the confirmation.
    - **Wired in:** `transform` joins `DELETION_PARTICIPANTS`; compose runs `transform` and `transform-worker` with the uploads bucket; `scripts/local-keys.py`; `backend/openapi/transform.json`. Terraform already gave transform the uploads environment and its S3 prefix.
    - **Checked locally:**
      - transform's 68 tests, at 100%: the plan's three checks (completion both ways, clearing both ways, the photo round trip with keys only under the prefix), the generation rules, PATCH validation, the circle rules, both races, retries and failures, deletions with photos, and the worker end to end on Moto (children gets `transform.completed`);
      - ruff, mypy, import-linter; the spec, Spectral clean; `terraform test` (5 passed).
    - **Not run:** the full `./check.sh`; a real LLM call; the compose stack with transform.
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
  - *(in progress: code done locally, waiting for review and merge)*
  - **As built** (`backend/release/`, the same shape as discover; `buddy-common[generation]==0.13.0`):
    - **`release.observations`:** `_id` = the child id; `status`, `source`, `items`, `watching`, `span`, `started_at`, `active_job_id`, `completed_at`, `version` (validator); `{location, _id}` unique, `{location, user_id}`. Plus `jobs`, `child_access`, `onboarding_inputs`, `growth_inputs`, `outbox`, `tombstones`.
    - **The port** (`release/app/observations.py`):
      - `normalizeObservations` (with `tidyNote` and the child-choice whitelist), `selectObservations`, `observationsLlmSchema` and `buildObservationsPrompt`, plus the page's evidence builders. Parent data goes in data blocks, named in the instructions by source key only.
      - `release/tests/fixtures/regenerate.sh` runs today's code on 7 fixtures; the port matches all 7. What's stored is what today's page promoted: at most the six cards, every offered block on one first.
    - **Found on the way:** release's `growth_inputs` copy had no question texts and no child picks, so today's grow and child evidence couldn't be built. **Decided here:**
      - grow's area events, its internal `areas` read and the shared `growth_inputs` copy gain `reflections` and `child_choices`, as optional fields (additive, 7.8);
      - grow computes them from its questions, answers, rounds and selections;
      - **buddy-common 0.13.0** (`GROWTH_FIELDS` and the copy's validator), and every service pins it.
    - **PATCH:** `{watching, span}` only, strict; unknown pattern ids are 422; `started_at` is the server's. The first non-empty `watching` sets `completed_at` and publishes `release.completed` in the same transaction. Version-conditional with 3 attempts (`409 observations_changed`).
    - **Generation:** from any status (a new set replaces the last; `start_job` sets `generating`); missing copies are read through from onboarding and grow; **decided here:** `409 needs_evidence` when there's nothing to read back. The job stores `items` (`source: llm`, `ready`), clears `watching`, keeps `completed_at` and bumps `version`. With no evidence the job fails at once.
    - **Wired in:** `release` joins `DELETION_PARTICIPANTS`, which now lists all seven participants (`services.tf`, compose); compose runs `release` and `release-worker`; `scripts/local-keys.py`; `backend/openapi/release.json`.
    - **Checked locally:**
      - release's 52 tests, at 100%: the plan's three checks (completion on the first watch, regeneration clearing `watching` but not completion, at most the six cards), the evidence and its read-through, the circle rules, both races, retries and failures, and the worker end to end on Moto (children gets `release.completed`);
      - grow (75) with the new fields; ruff, mypy, import-linter; the specs (grow's, transform's, discover's and onboarding's unchanged), Spectral clean; `terraform test` (5 passed).
    - **Not run:** the full `./check.sh`; a real LLM call; the compose stack with release.
- [ ] **5.6 shared.** Needs: Gate 3. *Parallel; doesn't need children.*
  - Endpoints:
    - [ ] `POST /api/v1/speech/transcriptions` (≤ 10 MB, parents only)
    - [ ] `GET /api/v1/downloads/apk` (parents only)
    - [ ] `GET /api/health`
  - **Check:** the audio is never stored or logged; the APK link expires in 300 s.
  - **As built** (`backend/shared/`):
    - **Renamed from `platform`:** a `backend/platform` package shadows Python's `platform` module for every import under `backend/`. The service, its Terraform keys (`split_services`, the ALB routes, `sg-shared`, the secret), the gateway, `shared/service-routes.json` (rules 130 and 140), the workflows' descriptions, auth's authz callers and common's `NOT_PARTICIPANTS` all say `shared`. The proposal and the API reference were updated to match.
    - **No database and no worker:** `SharedSettings` makes `MONGODB_URI` optional; the runtime holds the authorizer, the internal client (for the authz fill), the limits, an OpenAI client (only with `OPENAI_API_KEY`) and an S3 client (only with `ASSETS_BUCKET_NAME`; SigV4, `us-east-1`). The internal app serves `/internal/ping` only.
    - **Speech-to-text:** parents only, 10/min per user. Reads at most 10 MB + 1 byte (`413 audio_too_large`); the type is the last extension after control characters are stripped (`415 unsupported_audio_type`). OpenAI gets `whisper-1`, `en`, a fixed `recording.<ext>` and the allow-listed MIME. A failure is `502 transcription_unavailable` and logs the error type only; no key is `503 transcription_not_configured`.
    - **APK link:** parents only, 10/min per user. Lists `app-assets/applications/android/`, takes the newest `.apk` key and presigns it for 300 s with `Content-Disposition: attachment; filename="superpower-android.apk"`. `404 apk_not_available`, `503 downloads_not_configured`, and (**decided here**) `503 downloads_unavailable` when the bucket can't be listed.
    - **`/api/health`:** public, 30/min per IP, today's build metadata from the `GIT_*` env; it answers even before the runtime is configured.
    - **Wired in:** compose runs `shared` (profile `split`, with `OPENAI_API_KEY` and `ASSETS_BUCKET_NAME` from `.env`); `scripts/local-keys.py`; `backend/openapi/shared.json`.
    - **Checked locally:**
      - shared's 16 tests, at 100%, on a fake OpenAI client and Moto S3: the plan's two checks (the recording isn't logged and goes out under a fixed name; `X-Amz-Expires=300` and the download name), parents only, both limits, every refusal, configuration and the lifespan;
      - common (406) and auth (165) after the rename; ruff, mypy, import-linter; Spectral clean on the new spec; `terraform test` (alb 23, ecs-service 14, stack 5); the ecs-services (29) and fill-secrets (12) script tests; the routing and gateway syncs.
    - **Found by the Gate 5 walk:** against a local endpoint (Moto) the S3 client now uses path-style addressing, as `common.uploads` does. Virtual-hosted style made the APK link `503 downloads_unavailable` locally (`<bucket>.host.docker.internal` doesn't resolve); AWS keeps virtual-hosted style. Tested both ways, and on the compose stack: `404` with no build, then a 300 s link that downloads as `superpower-android.apk`.
    - **Not run:** a real transcription.

- [ ] **5.7 Connect visit (children).** Needs: 4.1, 5.5. It asks release's status before refusing, so it comes after release exists.
  - [ ] `POST /api/v1/children/{id}/connect/visit`: served by children until a connect service exists; asks release's status before refusing.
  - **Check:** locked before Release is done; sets `progress.connect` once.
  - **As built** (`children/app/main.py`, `connect_visit`):
    - Parents only (`403 parents_only` for admins, as children's other writes; **decided here**), 30/min per user; someone else's child is `404 child_not_found`.
    - Already visited: returns the progress, asks nobody and publishes nothing.
    - **Unlock:** the child's own `progress.release`; otherwise release's `GET /internal/release/children/{id}/status` (children is already its only allowed caller). A `404` is "not done"; unreachable or any other status is `503 release_unavailable`, `Retry-After: 2`.
    - **Decided here:** release's yes also sets `progress.release` in the same write. children owns progress, and Home would otherwise show Connect visited with Release not done until `release.completed` arrives; that event is then a no-op.
    - One `find_one_and_update` conditional on `progress.connect` not set, with `child.changed` in its transaction, so two visits at once publish once. A child deleted in between is `404`.
    - `connect` stays out of `common.deletion.PARTICIPANTS`; no connect database, queue or ECS service.
    - **Checked locally:** children's 50 tests at 100% (5 new: the lock and release's confirmation, set once, concurrent visits, a racing delete, the refusals and the limit, on a fake release); ruff, mypy; `backend/openapi/children.json` regenerated, Spectral clean.
    - **Not run:** the full `./check.sh`; the compose stack (Gate 5's walk through every circle).

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
  - **As built:** every participant (users, children and the five circles) already handled `user.deletion_requested` from its own task, with data, copies, jobs cancelled, the `user:` tombstone and `user.data_deleted` in one transaction. The audit and the end-to-end run found two gaps, both fixed:
    - **Outbox rows (buddy-common 0.14.0):** a published row keeps its payload (child snapshots, answers, reflections) for 7 days. `common.events.delete_user_events` removes this service's rows whose aggregate is the user or one of their children, or whose payload names the user, published or not, in the deletion's transaction. `user.data_deleted` rows stay (ids only; a repeat confirms again). Each circle takes the child ids from its `child_access` copies, children from its documents. `ensure_outbox` adds a `{location, aggregate_id}` index for it. The proposal's 10.3 step 2 says so now.
    - **transform photos:** deleted for every child transform knows (`plans` and `child_access`), not only those with a plan: a photo can be uploaded before the plan exists.
    - **Kept by design:** `tombstones`; `user.data_deleted` and auth's `user.deletion_requested` outbox rows (ids only, 7 days after publishing); cancelled `jobs` (ids only, 7 days after they end); auth's `audit` (the agreed retention); Valkey's rate-limit and LLM-hour counters (ids only, expiring within the hour). `PARTICIPANTS` was already the seven services with user data; connect stays out.
    - **The check, automated:** `scripts/e2e/account-deletion.py` (with `scripts/e2e/journey.py`, the Gate 5 walk as a script) gives one account a child through every circle, an avatar and a 90-day-plan photo, deletes it through the gateway, waits for auth to finish, then scans every split database, Valkey and the uploads bucket for the user's id, the child's id and the email.
    - **Checked locally:** on the compose `split` stack, the check failed on the 0.13.1 images (13 outbox rows left across six services) and passed on 0.14.0 (the saga took 3 s); every participant's deletion test asserts the outbox (seeded rows: theirs gone, another user's kept); the new common and transform tests; common, users, children, the five circles and auth at 100%; ruff and mypy.
    - **Not run:** the full `./check.sh`.
- [ ] **6.2 Failure and convergence tests.** Needs: 6.1.
  - Kill any service mid-deletion, restart it, and the deletion still completes.
  - A late event or a finishing job after deletion stores nothing (tombstones).
  - Child deletion: a soft delete hides the child at once; the purge after 30 days (time-shifted in the test) removes every circle's data.
  - **Check:** these as automated integration tests against the local stack.
  - **As built:** `scripts/e2e/convergence.py`, three scenarios, each on a new account and each ending with the scan `account-deletion.py` uses (now shared in `scripts/e2e/stack.py`, with `journey.py` split into one step per circle):
    1. **Killed mid-deletion:** every participant's worker is killed (SIGKILL) before the request, so it waits in their queues and nothing is confirmed. auth-worker is killed once it has relayed it. The participants come back, delete and confirm, while auth keeps the account. auth-worker comes back and finishes. Nothing is left. discover's worker is killed mid-generation in passing.
    2. **A late event and a finishing job:** a growth area's questions are generating when the account is deleted. The job is cancelled and its result, arriving later, stores nothing. Then a `child.changed` at version 1000 is published on children's topic; every circle's queue drains with nothing dead-lettered, and nothing is stored (the user's tombstone).
    3. **Purge:** a child walked through every circle is deleted: children `404`s at once and every circle within moments. `deleted_at` moved 31 days back and children-worker restarted (the purge runs at start), the child, every circle's data, copies, photos and outbox rows about it go.
  - **Found and fixed (buddy-common 0.15.0):** a purged child's earlier outbox rows (snapshots with its name, answers) stayed for 7 days in children and in every circle. `common.events.delete_child_events` removes them in the purge's transaction; `child.deleted` rows stay. Every circle's purge test and children's assert it with seeded rows. The proposal's 10.2 says so now (and that a cancelled job's error is `cancelled`, as built).
  - **In `./check.sh`:** with `RUN_E2E=1`, after the other checks, `account-deletion.py` and `convergence.py` run against the local stack; without it they're skipped with a note, since they need the compose stack and Moto, make LLM calls and stop and start workers.
  - **Checked locally:** all three scenarios passed on the compose `split` stack on 0.15.0; common, children and the five circles at 100%; ruff and mypy.
  - **Not run:** the full `./check.sh` (with or without `RUN_E2E=1`).

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
  - **Deletion:** `PARTICIPANTS` is checked against the catalogue (`data_services` and the consumers of `user.deletion_requested`). Every directory under `backend/` with a `requirements.txt` must be in `PARTICIPANTS` or in `NOT_PARTICIPANTS` with a reason (auth, shared, hello).
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
- 2026-10-25: P.1 decided: one long-lived feature branch, merged into `develop` at the end. Phase 0, Phase 1 and Gate 1 are pushed on `feature/develop-changes-2`.
- 2026-10-25: 2.1 built.
  - **Found by the new test that feeds the real `shared/service-routes.json` through the module:** with the old `<app>-<key>-tg-<env>-<hash>` names, `onboarding` (34 characters) and `transform` (33) are over AWS's 32-character limit for target group names. Without the fix, the module's precondition would refuse the 2.5 plan. The fix drops `-tg`: `superpower-onboarding-prod-xxxx` is 31. Nothing is deployed, so the rename is free. `docs/environments.md` (app name + environment ≤ 15 characters, now because of `onboarding`) and `docs/infra-operations.md` say so.
  - **How the checks are split:** Terraform can't have two variables' validations refer to each other. So `routes` validates its own rules (priorities 1–49999 and unique, targets known, 1–3 patterns), and the checks on `targets` that depend on `routes` are target-group preconditions: at most one catch-all, no `path_patterns` with routes, every target routed.
  - **Checked locally:** `modules/alb` `terraform test`: 23 passed. Five runs are new: the 404 without a catch-all, none with one, the full shared route list (10 rules to 9 target groups, the mid-path `/api/v1/children/*/onboarding*` passed through unchanged, circle rules before children's, shared's two rules), plus the six refusals. `infra-live-backend` `terraform test`: 4 passed, so today's stack is unaffected. tflint, checkov (19 passed, 0 failed) and trivy config are clean; `terraform fmt` is clean.
- 2026-10-25: 2.2 built.
  - **Registration requires `internal_port`:** only services with internal endpoints register (13.2). The internal port must also differ from the public one. Both are checked as ECS-service preconditions.
  - **Health:** ECS reports task health to Cloud Map from the container health check, so a starting, unhealthy or stopping task isn't answered. `failure_threshold` is deprecated in AWS provider 6 (AWS always uses 1), so the custom health-check block is empty.
  - **Checked locally:**
    - `modules/ecs-service` `terraform test`: 14 passed. The 6 existing runs are unchanged, so today's services are unaffected.
    - 8 runs are new: a registered service on 8000 + 8001 behind the ALB; the collector on 4318 only, with a custom name and TTL; an unregistered service with null outputs; and the refusals (registration without an internal port, the same port twice, a non-DNS name, a TTL over 300, a port over 65535).
    - `infra-live-backend` `terraform test`: 4 passed. tflint, checkov (9 passed, 0 failed), trivy config and `terraform fmt` are clean.
- 2026-10-25: 2.3 built.
  - **Access strings, built by the module:** `on ~LIMITS:LIMITER/<service>/* ~leader:<service>:* %R~authz:* [~llm:hourly:*] -@all +@read +@write +@scripting +@connection -@dangerous`, with `~authz:*` (read-write) for auth only.
  - **The key names are the code's own:** `common.limiter` writes `LIMITS:LIMITER/<prefix>/…`, the LLM limit `llm:hourly:<user>`, and leader locks use `leader:<service>:…`. Services must use their own name as the limiter prefix and in leader-lock keys.
  - **Proven on the local stand-in** (Redis 7.4, the same ACL syntax as Valkey 8), with temporary users that were deleted afterwards. A reader can `GET authz:*` but `SET` and a Lua write are denied; auth can do both. A service reaches its own limiter and leader keys but not another's. Only `llm_limit` services reach `llm:hourly:*`. Other keys, `KEYS`, `FLUSHALL` and `CONFIG` are denied.
  - **To confirm at the first dev apply (2.7):** whether ElastiCache's Valkey user groups still require a `default` user. The module adds a disabled one (`off -@all`, no password) by default, and `include_default_user = false` drops it if AWS doesn't need it. Also confirm that ElastiCache accepts `%R~` key permissions in access strings, as Valkey does.
  - **Follow-up in `common`, before any service connects in AWS:** IAM authentication means the Redis clients sign in with a short-lived token (SigV4 for `elasticache:Connect`, valid 15 min, refreshed). The services' Valkey clients need that credential provider (redis-py's `credential_provider`). Locally they keep plain `redis://`. That belongs with 2.5 / the first service (3.1). *(Done: `common.valkey`, buddy-common 0.10.0; see the 2026-10-25 note.)*
  - **Checked locally:** `modules/redis` `terraform test`: 11 passed. The 4 existing runs are unchanged; 7 are new: per-service users with their exact access strings, no default user, no RBAC resources in token mode, and the refusals (both modes at once, neither, a non-auth `writes_authz`, a bad service name). `infra-live-backend` `terraform test`: 4 passed. tflint, checkov (15 passed, 0 failed), trivy config and `terraform fmt` are clean.
- 2026-10-25: 2.4 built.
  - **Same plan as the code:** the module's subscriptions were compared with `common.events.topology.plan("superpower-prod")` through `terraform console`: 33 (consumer, producer) subscriptions, identical event types, the same topics. Both read the same catalogue.
  - **Topic encryption:** trivy flagged the AWS-managed SNS key (AWS-0136, HIGH). Events carry personal data (`child.changed` has the child's name and age), so the topics use one customer-managed key per environment and region (about $1 a month each): rotation on, a 7-day deletion window, and a key policy for the account plus SNS for this account's topics only. **Publishers' task roles need `kms:GenerateDataKey` and `kms:Decrypt` on `key_arn` (2.5).** The queues use SSE-SQS, so SNS can deliver without a key grant. Checkov's three key-policy findings (`Resource "*"`, which in a key policy means the key itself) are suppressed on the policy document, with reasons.
  - **Checked locally:** `modules/events` `terraform test`: 5 passed. They cover the topics, queues, DLQs, redrive, filters and queue policy against the real catalogue, hello's demo subscription, auth hearing `user.data_deleted` from every data service, the alarms, the refusal without an alarm topic, and reserved events creating nothing (a fixture catalogue). tflint, checkov (34 passed, 3 skipped with reasons) and trivy config are clean. `check.sh` and CI loop over `modules/*/`, so the new module runs everywhere with no wiring. The lock file and `.terraform/` are git-ignored, as for every module.
- 2026-10-25: Phase 2's module tasks (2.1–2.4) are built locally. Next is 2.5, the `infra-live-backend` stack, which wires them together. It needs P.3 (Atlas) only for the MongoDB URIs, but it does need `services.tf` per runtime, per-service IAM (S3 prefixes, own topic and queue, the events KMS key, `elasticache:Connect` on the replication group and the service's user) and the Cloud Map namespace. Then 2.6 (workflows) and 2.7 (first dev apply, yours).
- 2026-10-25: 2.5 built.
  - **Decided:**
    - Terraform generates the service-token key pairs (`tls_private_key`), so no person handles a private key, and rotation is a version bump.
    - Prod workers run **lean**: one task per worker. SQS holds messages while a task is replaced, and this saves about $224 a month per region (15.3).
  - **Found by the stack test:** the catalogue still has hello's demo event, so the events module would have created a hello topic and queue that no runtime uses. `modules/events` now takes `services`, and the stack passes `split_services`. The module's new run checks that only events between the deployed services are built, and that `user.data_deleted` comes only from the deployed data services.
  - **The worker list is derived, not typed:** `services.tf` builds the 18 runtimes from `split_services`. `check-service-lists.sh` derives the same order from that line, and the stack test pins the real `ecs_services` manifest to it, so the help text, the script and Terraform can't drift apart.
  - **Checked locally:**
    - `infra-live-backend`: `terraform validate` and `terraform test` (5 passed: prod wiring with 50 assertions, dev, the JWT key check, the `runtime_sizes` tiers, key rotation);
    - `modules/events`: `terraform test`, 6 passed;
    - `check-service-lists.sh`, `ecs-services.test.sh` (23 passed) and shellcheck;
    - tflint; checkov (0 failed); trivy config (0 misconfigurations); `terraform fmt`.
  - **Not run:** a `terraform plan` against the real dev account. It's 2.7's, after 2.6 updates the workflows that supply the variables.
- 2026-10-25: 2.6 built.
  - **Found by the new fill test:** shared's secret holds only `OPENAI_API_KEY`, one of the optional LLM keys. So a "required key still REPLACE_ME" rule would never fill it. A secret whose keys are all still REPLACE_ME now counts as needing a fill too.
  - **Secrets you add to each GitHub environment before the first apply:**
    - `MONGODB_URIS`: one entry per service with a database (every service but shared). It needs P.3's Atlas users, one per service.
    - `EMAIL_HMAC_PEPPER`: `openssl rand -hex 32`, backed up.
    - Delete `MONGODB_URI` and `REDIS_AUTH_TOKEN`.
  - **Also fixed:** two older shellcheck SC2129 style findings that actionlint reports, in deploy (git metadata) and terraform-live-backend (model variables).
  - **Checked locally:**
    - actionlint on the four backend workflows and `terraform-live-all.yml` (an older SC2012 info in `check.yml` remains, untouched);
    - shellcheck;
    - `ecs-services.test.sh` (29 passed), `fill-service-secrets.test.sh` (12 passed) and `check-service-lists.sh`.
  - **Not run:** the workflows themselves; their first run is 2.7.
  - **Still open for 2.7:** hello has no `<service>.worker` modules, so the 8 worker runtimes won't start on the hello placeholder (`build_from=hello`). Either deploy only the HTTP runtimes and the collector in 2.7, or give hello's image those modules first.
- 2026-10-25: Gate 2, code half: the full `./check.sh` (with `MONGODB_TEST_URI` and `REDIS_URL` on the compose stack) passed **78 of 78**. That includes checkov, trivy config, every module and stack `terraform test`, tflint, and the new `fill-service-secrets.sh` tests. The other half, a running dev environment, waits for 2.7.
- 2026-10-25: 2.7 and Gate 2 changed (decided): the first dev apply is **infrastructure only**, and the real services are deployed from Phase 3 onwards, as each is built, instead of running `hello` in every runtime first. This makes the "Still open for 2.7" item under 2.6 moot (hello's image has no worker modules). The two checks that need running tasks move to 3.1: Cloud Map registration and a signed internal call on 8001. 2.7 now needs P.3 (the Atlas users behind `MONGODB_URIS`) rather than 0.4. The `build_from` input stays in the deploy workflow for any later placeholder use.
- 2026-10-25: Gate 3, code half: the full `./check.sh` (with `MONGODB_TEST_URI` and `REDIS_URL` on the compose stack) passed **84 of 84**. It includes mypy and pytest + coverage for auth, hello and users; import-linter; the auth, hello and users OpenAPI specs (up to date, Spectral clean); semgrep, bandit, gitleaks and pip-audit for the services; and every Terraform test. Nothing needed fixing. The other half, the end-to-end runs in dev (sign-up, Google sign-in, login, refresh, lock, unlock, role change), waits for the dev apply (2.7) and the first deploy of auth and users.
- 2026-10-25: The Valkey IAM-token client, in `common` (**buddy-common 0.10.0**; auth, users and hello now pin it).
  - **`common/valkey.py`:** `ElastiCacheIAMProvider` is a redis-py `CredentialProvider` returning `(user, token)`.
    - The token is a SigV4-presigned `GET https://<replication group>/?Action=connect&User=<user>` (service `elasticache`, 900 s), signed with the task role's credentials through botocore.
    - It's made on a new connection and reused for 10 minutes. ElastiCache's 12-hour disconnect just reconnects with a fresh one.
  - **Settings:** `ServiceSettings` gains `REDIS_USERNAME` and `REDIS_REPLICATION_GROUP_ID` (a user needs the group: a validation error otherwise), plus `valkey_options()` and `valkey_client()`. Locally neither is set, and the URL alone connects, as before.
  - **Every Valkey client now uses it:** each service's authz cache client, `common.limiter.RateLimits` (a new `redis_options`) and auth's `LoginThrottle`. `botocore>=1.35` is a core dependency of common.
  - **Terraform:** every service runtime gets `REDIS_REPLICATION_GROUP_ID` (`module.redis.replication_group_id`) next to `REDIS_USERNAME`; the stack test was updated.
  - **Found on the way:** `auth/requirements.txt` was missing `boto3`, which the worker's SNS and SQS clients (3.5) import. Local runs share one venv, so it passed here; CI's install-alone step would have failed. It's added.
  - **Checked locally:**
    - `common/tests/test_valkey.py` (7): the token's shape and signing scope, the 10-minute reuse, missing credentials, the settings in AWS and locally, the limiter, and a live sign-in against the local Valkey: an ACL user whose password is the token is signed into by a client that has only the provider, as ElastiCache checks it;
    - the backend suite: 1551 passed, 99.85%; users 46, hello 15 and auth 160 tests, all at 100%;
    - ruff, mypy; `terraform test` (5 passed).
  - **To confirm at the first deploy:** a real IAM sign-in to ElastiCache (2.7 / 3.1's dev checks).
- 2026-10-25: Gate 4, code half: the full `./check.sh` (with `MONGODB_TEST_URI` and `REDIS_URL` on the compose stack) passed **88 of 88**, now with mypy, pytest + coverage, the OpenAPI spec and Spectral for children. The first run found 2 failures, both in the new `common/tests/test_valkey.py`: unformatted, and two mypy errors (an unused `type: ignore`, and a `limits` `Storage` attribute now narrowed to `RedisStorage`). Fixed, and the second run was clean. The other half, Home listing children with progress from one query in dev, waits for the dev deploy.
- 2026-10-26: Review before Phase 5 (four parallel reviews, each finding checked in the code). Fixed, with tests; **buddy-common 0.11.0** (every service pins it):
  - **The outbox-stale alarm had no metric.** The relay now reports `OldestUnpublishedOutboxAgeSeconds` every minute (0 when idle) through `MetricsPublisher`. Each worker's runtime has a CloudWatch client for it; in tests there's none, so nothing is sent.
  - **One bad outbox row could stop a service's events for good.** An event over SNS's 256 KiB (body and attributes) is refused when it's built (`EventTooLarge`), so it's never written. A row the relay still can't publish (unreadable, or too large) is set aside (`set_aside_at`, `set_aside_reason`) and logged as `outbox.row.set_aside`, and the rows behind it go out. A new log metric filter and alarm per worker (`outbox-set-aside`, `enable_all_alarms`) reports it. SNS errors are still retried, never set aside.
  - **The HTTP services had no JSON logs, request ids or traces.** `common.serve` now calls `common.telemetry.setup_observability` (JSON logs and tracing for both apps, from `APP_ENV`, `AWS_REGION`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `LOG_LEVEL`) and wraps each app in `RequestIdMiddleware`. The workers call the same function. Internal calls carry the current request's id by default.
  - **A down Valkey would hang requests** instead of falling back to auth: `valkey_client()` now sets 2-second connect and socket timeouts, as the rate limits' client does.
  - **Deletions would get stuck in AWS:** `services.tf` now lists `users` and `children` as `DELETION_PARTICIPANTS`, as compose already did.
  - **The admin counter could drift:**
    - `DELETE /account` puts a taken admin back only if the deletion's transaction didn't commit (`deletion.start(..., undo=)`; nothing is undone when the commit result is unknown). After the commit, a failed `deletions` upsert or cache write is logged, and the worker makes it good.
    - That transaction finds the account only with the role and lock the counter step was decided on (`409 account_changed` otherwise).
    - Admin changes refuse an account being deleted (`409 account_deleting`).
  - **A session could outlive a logout-all, lock or role change** that raced a login or refresh. `sign_in` checks the account's `authz_version` once the session is written. If it moved, the session is deleted again and the answer is `401 session_revoked`.
  - **A PATCH racing another could skip `child.changed`.** It's now decided against the version read and conditional on it, retried up to 3 times, then `409 child_changed`.
  - **Found on the way:** the Valkey IAM signer could fail at random with `ReferenceError`, because botocore's `RequestSigner` holds its session's event emitter weakly and the session was a local. The provider now keeps its session.
  - **Left for later (low):** the 10-children limit race; `avatar_key: ""` skipping validation; S3 errors on PATCH giving 500; the purge's avatar delete before its version-guarded delete; users' internal `PUT` tombstone race; error codes on the users 403 and `account_locked`; Pydantic lax coercion; a redelivered `user.data_deleted` after finish; login timing; the sync `limits` storage; auth's own fill giving 500, not 503; a second schema version (7.8); IAM credential errors not counting as Valkey being unavailable; any authz 404 read as "no account".
  - **Checked locally:**
    - ruff, mypy;
    - common 404 tests and the backend suite (1559 passed, 99.85%); auth 165, users 46, children 45 and hello 15 tests, all at 100%;
    - every service's OpenAPI spec is unchanged;
    - `terraform validate` and `terraform test` (5 passed).
  - **Not run:** the full `./check.sh`.
- 2026-10-26: 5.1 built (onboarding, as-built notes under 5.1). It fixes the circle pattern: the `child_access` copy, read-through, confirm-before-deny with the previous circle's owner, `503` with `Retry-After` when that owner can't be asked, and version-checked saves. discover (5.2) copies `onboarding/app/access.py`'s shape, with onboarding as the owner it asks.
- 2026-10-26: 5.2 built (discover, as-built notes under 5.2). The first generating circle: grow, transform and release follow `discover/app/generation.py` (start / process / report_jobs) and its tests' fake provider. onboarding's two events gained an optional `user_id`.
- 2026-10-26: 5.3 built (grow, as-built notes under 5.3). **buddy-common 0.12.0:** `start_job` and `fail_or_retry` take `target_status`. transform and release can start from grow's shape for a circle with several kinds of generation per document.
- 2026-10-26: 5.4 built (transform, as-built notes under 5.4). Release (5.5) follows the same pattern, unlocked by transform's status.
- 2026-10-26: 5.5 built (release, as-built notes under 5.5). **buddy-common 0.13.0:** `growth_inputs` gains `reflections` and `child_choices`, which grow now sends. Every deletion participant is built, so `DELETION_PARTICIPANTS` lists all seven. Left in Phase 5: 5.6 (shared, then named platform) and 5.7 (the Connect visit in children, which asks release's new status).
- 2026-10-26: 5.6 built (shared, as-built notes under 5.6). The proposal's `platform` service is now `shared` everywhere, because a `platform` package shadows Python's standard library. Left in Phase 5: 5.7 (the Connect visit in children).
- 2026-10-26: 5.7 built (the Connect visit in children, as-built notes under 5.7). Every Phase 5 task is built; next is **Gate 5**: the full `./check.sh`, then one child from profile to Connect through every circle, and the review before Phase 6.
- 2026-10-26: the full `./check.sh` passes after 5.1–5.7 (112 checks, with the test Mongo and Valkey), so the "Not run: the full `./check.sh`" lines under 5.3–5.7 are covered. Gate 5's other half, one child from profile to Connect in dev, is still to do.
- 2026-10-26: **Gate 5, local walk:** on the compose `split` stack, through the gateway with the real LLM keys, one made-up child went from profile to Connect: register, a complete profile, the seven onboarding answers, the personality (started by discover's worker) and the reveal, one growth area (questions generated, then completed), the transform plan and the Day-90 event, release's observations and the first watch, then the Connect visit. children ended with all seven `progress` flags set. Two fixes came out of it:
  - **buddy-common 0.13.1:** `ensure_validated_collection` treats the server's NamespaceExists (48) as "already there". A service and its worker prepare at the same start, and `transform` failed its first startup when `transform-worker` created `personality_inputs` between pymongo's existence check and the create. It now always applies the validator with `collMod`; all ten services pin 0.13.1. Re-walked from an empty `transform` database: clean start, walk passed.
  - **shared:** path-style S3 against a local endpoint (as-built notes under 5.6).
  - Gate 5 still needs the same walk in dev, which waits for the dev apply (2.7) and the deploys, and the review before Phase 6.
- 2026-10-26: 6.1 built (as-built notes under 6.1). **buddy-common 0.14.0** (`delete_user_events`); all ten services pin it. `scripts/e2e/` holds the local end-to-end runs: `journey.py` (Gate 5's walk) and `account-deletion.py` (6.1's check); 6.2's convergence tests can build on them.
- 2026-10-26: 6.2 built (as-built notes under 6.2). **buddy-common 0.15.0** (`delete_child_events`); all ten services pin it. Gate 6 is `RUN_E2E=1 ./check.sh` with the local stack up.
- 2026-10-26: **Gate 6:** `RUN_E2E=1 ./check.sh` (with the test Mongo and Valkey, and the compose `split` stack on buddy-common 0.15.0) passed **114 of 114**, including both e2e runs: account deletion left nothing of the account, and all three convergence scenarios passed. Nothing needed fixing, so the "Not run: the full `./check.sh`" lines under 6.1 and 6.2 are covered. Next: the review before Phase 7/8; Phase 7 (the clients) is the next build work.
