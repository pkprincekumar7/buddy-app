# Production Readiness Review — Terraform & GitHub Actions

> **Status:** Findings only — nothing in this document has been fixed yet.
> **Scope:** `infra-live-backend/`, `infra-live-edge/`, `infra-live-frontend/`, `infra-live-scheduler/`, `.github/workflows/`. Backend/frontend/mobile code was read where infra behaviour depends on it.
> **Purpose:** A work list to hand to Claude Code later. Each finding has an ID, location, problem, fix, and acceptance criteria so it can be implemented one item (or one phase) at a time.

## Revision history

| Version | Date | Change |
|---------|------|--------|
| v1 | 2026-10-18 | First review (Terraform + workflows) |
| v2 | 2026-10-18 | Second, line-by-line pass over every `.tf`, workflow, the Lambda@Edge template and the backend code they depend on. Corrected inaccurate claims and fixes (see "v2 correction" notes), raised WAF-01 to High, lowered EDGE-04 to Medium, rewrote CI-08, and added 30+ new findings (APP-\*, MOB-\*, new SEC/OBS/CI/DR items). |
| v3 | 2026-10-18 | Full backend code review (`backend/app/**`, `worker.py`, tests) to check the plan against the application. Corrected APP-01/02/03/04/05/06/07/08, EDGE-01 (DB prerequisite), EDGE-04, EDGE-05, WAF-01 (real per-endpoint body sizes), SEC-05, TF-03, OBS-\*, DR-01, Appendix A (see "v3 correction" notes). Added the [Backend application](#backend-application-v3) section (DB-\*, JOB-\*, AUTH-\*, PRIV-\*, new APP-\*, SEC-10, OBS-04). |
| v4 | 2026-10-18 | Aligned with the **actual database plan**: **near term, Atlas M10/M20 replica set in ap-south-1 only; future, M30+ Global Cluster.** Rewrote DB-01 as a staged plan. Added DEC-01 (multi-region compute while the DB is single-region) and DEC-02 (private connectivity to the DB). Raised NET-01 (conditional on DEC-01) and moved DB-02's connection budget into Phase 0. EDGE-01 deferred to the Global Cluster stage. Updated TF-03 (capacity capped by the DB), DR-01/DR-02, PRIV-03, Phase 0 and the dependencies. |
| v5 | 2026-10-18 | Five-way verification pass (edge/security, pipelines, backend, infra/DB, internal consistency) against code and installed library versions. Fixed fixes that would have broken things: the PRIV-01 `errors()` kwargs, the EDGE-04 `aud` rollout order, uvicorn `--forwarded-allow-ips`, the CI-02 plan job without an environment, the SEC-05 same-stack secret, the CSP missing `blob:`, Fargate tmpfs, and the CI-04/SEC-07 grep commands. Corrected line numbers (TF-02, EDGE-05 schemas), counts (seven dropdowns, `check.yml` timeouts, approvals), the DB-02 connection math (per-node, surge) and the DB-01 index description. Added pitfalls (DEC-01 routing, JOB-02 attempts, AUTH-02 tombstones, JOB-06 write skew, TF-03 Spot replacement, Atlas CIDR immutability). Rebuilt the phase table so each item has one home, and added Phase 7 for the Global Cluster. Missing acceptance criteria added. |

---

## How to use this document with Claude Code

Pick one finding (or one phase from [Suggested implementation order](#suggested-implementation-order)) per session. Example prompts:

```
Read docs/production-readiness-review.md and implement finding EDGE-03.
Follow the "Fix" and make sure every "Acceptance criteria" item is met.
Run terraform fmt -recursive and terraform validate for the touched stack.
```

```
Read docs/production-readiness-review.md and implement Phase 1.
Plan first, show me the plan, then implement.
```

Rules for whoever implements these:

- Line numbers were correct on 2026-10-18 — **re-locate by searching for the quoted code**, don't trust line numbers blindly.
- Read the **"⚠️ Pitfalls"** notes before implementing. Several obvious-looking fixes break things (Lambda@Edge limits, CloudFront origin-group rules, PyJWT `aud` handling, EventBridge→Lambda retry semantics).
- Keep the existing code style: heavy explanatory comments, `#checkov:skip=` with a justification, `default_tags` for tagging.
- After any Terraform change: `terraform fmt -recursive`, `terraform validate`, `tflint` for that stack.
- After any Lambda@Edge change: run `infra-live-edge/functions/jwt-validator-lambda.test.js` and add tests for the new behaviour.
- After any backend change: `pytest` with the 99% coverage gate (`check.sh`).
- Update the matching doc in `docs/` (`ci-cd.md`, `infra-operations.md`, `jwt-keys.md`, `infra-architecture-multi-region.md`, `environments.md`) when behaviour changes. See DOC-01 for drift that already exists.
- Mark a finding `✅ Done` in the tracker table when complete.

---

## Overall verdict

**Solid foundation; not yet ready for large-scale, multi-region production.**

The code is careful, well commented, and every scanner suppression has a reason. What stands in the way:

- **Single points of failure:** one region serves every login, and the only database is single-region in ap-south-1 (DB-01).
- **Weak secret and identity handling:** the OIDC trust is documented as a wildcard on an admin role, the origin secret sits in the Lambda code, and the mobile builds are debug-signed and publicly downloadable.
- **Pipelines can reach prod from any branch with no plan review.** Deploy waits can report a rolled-back deploy as success, and rollouts hit every region at once.
- **Application-level gaps:** IP rate limits can be spoofed, and the WAF blocks audio uploads.
- **No reuse across stacks:** the stacks are copy-pasted rather than modular.
- **The database is the biggest blocker:** every region uses **one free-tier (M0) MongoDB Atlas cluster in ap-south-1**, with no SLA, no backups and a 500-connection cap (DB-01).
  - The **near-term plan (v4)** is an **M10/M20 replica set, still only in ap-south-1**. That fixes backups, the SLA and features.
  - The database stays **single-region**, so an ap-south-1 outage is a total outage, and eu-west-1/us-east-1 backends pay about 120–250 ms per DB round trip.
  - M10/M20 CPU and connection limits cap how far the app can scale (DB-02, TF-03).
  - True multi-region availability and residency arrive only with the future **M30+ Global Cluster** (DB-01 Stage 2; see DEC-01).
- **Backend gaps (v3):**
  - plaintext passwords and children's data in logs (PRIV-01);
  - account deletion that leaves data behind, which the worker can even recreate (PRIV-02);
  - jobs that can run twice and overwrite each other (JOB-01);
  - an LLM job path that bypasses cost controls (JOB-03);
  - blocking calls on a single-process event loop (AUTH-01, APP-05).

As it stands it suits a **small/medium production load in one primary region**, and only after the database tier is upgraded.

### Current architecture

```
              ┌──────────── CloudFront + WAF + Lambda@Edge (JWT, origin-request) ───────────┐
 Users ──────►│  /*  → S3 (SPA)   /uploads/* → S3 (by location)   /app-assets/* → S3          │
              │  /api/* → Lambda@Edge picks the regional ALB from the JWT/location            │
              └──────────────┬──────────────────────────────────┬─────────────────────────────┘
   login/google/health/hint-less refresh ─┘ (ALWAYS backend_regions[0])  └── per-location region
                     ▼                                                       ▼
   ALB → ECS API (FastAPI, 1 uvicorn proc) ─► Redis (rate limits, lock)   ALB → ECS API … (×N regions)
         ECS Worker (polls Mongo `jobs`) ─────────────┐
                     └──── MongoDB Atlas — ONE replica set in ap-south-1 for ALL regions ┘
                           today: M0 free tier (no backups) → near term: M10/M20 (backups, PITR)
                           → future: M30+ Global Cluster (one zone per region)
                           users, children, sessions, jobs; ~120–250 ms from eu-west-1/us-east-1
```

### What's done well (keep these)

- Private subnets for ECS, and VPC endpoints (an S3 gateway endpoint everywhere, interface endpoints in stg/prod). Prod has one NAT gateway per AZ, and the `min()` NAT indexing is correct for counts 1–3.
- The ALB accepts only the CloudFront prefix list **and** requires the `X-Origin-Verify` header; the default listener action is 403. The ElastiCache security group allows the API tasks only.
- Redis has at-rest and in-transit encryption (`transit_encryption_mode = "required"`) plus an AUTH token, and runs multi-AZ in prod.
- The container runs as a non-root user (`backend/Dockerfile:42-45`), and task secrets come from Secrets Manager rather than plain env vars.
- ECR has `IMMUTABLE` tags, scan-on-push and a lifecycle policy.
- ECS has a deployment circuit breaker with automatic rollback. The worker autoscales on queue depth (`PendingJobCount`), and scale-in is owned by a single policy so the two policies don't fight.
- JWTs already carry a `type` claim (`access`/`refresh`), `exp` and `kid` (`backend/app/auth_utils.py:58,73,94`), and the backend rejects refresh tokens used as access tokens (`backend/app/deps.py:43`). Upload keys end in `uuid4()`, so they can't be guessed.
- Lambda@Edge routing rewrites the Host header, and `shared/routing.json` is the single source of truth for edge, CloudFront and WAF. Routing fails closed with no silent default region.
- OAC is scoped to the distribution ARN. Viewer TLS is `TLSv1.2_2021`, and security headers and CSP are strong.
- State uses S3 native locking (`use_lockfile = true`). Variables have strict validation, including blocking scheduler schedules in prod (`infra-live-scheduler/terraform/variables.tf:67-69`), and prod never receives a stop schedule (`scheduler.tf:109-112`).
- The scheduler always dispatches against the default branch (`scheduler.tf:83`).
- Sensitive variables are already marked `sensitive = true` (`redis_auth_token`, `origin_verify_secret`, `github_pat`), and only the **text** plan is uploaded as an artifact, never the binary.
- GitHub to AWS uses OIDC, with no long-lived keys. Promotion moves the **same image** forward.
- CI scanning is broad: checkov, trivy, gitleaks (checksum-verified), semgrep, bandit, CodeQL, Nuclei, Spectral and SBOM. Every `continue-on-error` scanner is counted by its job's final "fail if any check failed" step, and there is a 99% coverage gate.

> v2 correction: v1 credited "per-environment + per-region concurrency groups". Terraform workflows lock per environment and region, but backend deploy/promote/restart lock per **environment + service**, which is flawed (see CI-12).

---

## Finding tracker

| ID | Severity | Area | Title | Status |
|----|----------|------|-------|--------|
| EDGE-01 | 🔴 Critical (⏸ deferred to Global Cluster stage) | Edge | Login/google/health depend on a single region | 🟡 Stage 1 done (per-run `bootstrap_region` input, default `auto`); Stage 2 open |
| EDGE-02 | 🔴 Critical | Edge | Origin-verify secret is plaintext in Lambda@Edge code | 🟡 Code done; rotation runbook not yet exercised (rotate once after deploy) |
| EDGE-03 | 🔴 Critical | Edge | 404s rewritten to 200 + `index.html` distribution-wide | 🟡 Code done; acceptance checks need a deployed env |
| EDGE-04 | 🟡 Medium | Edge | Edge JWT validation gaps (`exp`, `type`, `alg`, `kid`, perf) | ✅ Done, incl. `iss`/`aud` (JWKS not done) |
| EDGE-05 | 🟠 High | Edge | `/uploads/*` (child photos) is public and edge-cached | ✅ Done (S3 presigned GET URLs, not CloudFront signed URLs — see v6 note) |
| SEC-01 | 🟠 High | Security | Secrets stored in Terraform state | ⬜ Open |
| SEC-02 | 🟠 High | Security | WAF logs capture tokens and cookies | ⬜ Open |
| SEC-03 | 🟠 High | Security | Scheduler: broad classic PAT and raw-event dispatch | ⬜ Open |
| SEC-04 | 🔴 Critical | Security | OIDC trust documented as `repo:…:*` with AdministratorAccess | ⬜ Open |
| SEC-05 | 🟡 Medium | Security | Secrets init step can overwrite rotated secrets | ⬜ Open |
| SEC-06 | 🟡 Medium | Security | Secrets exposed job-wide (`env`/`GITHUB_ENV`) to every step | ⬜ Open |
| SEC-07 | 🟡 Medium | Security | `${{ }}` interpolated directly into `run:` (script injection pattern) | ⬜ Open |
| SEC-08 | 🟠 High | Security | GuardDuty Runtime Monitoring doesn't cover Fargate | ⬜ Open |
| SEC-09 | 🟡 Medium | Security | CloudTrail design: per-region trails, gaps, no `SourceArn` | ⬜ Open |
| APP-01 | 🟠 High | App | IP rate limits use the spoofable leftmost `X-Forwarded-For` | ⬜ Open |
| APP-02 | 🟠 High | App | JWT key rotation logs everyone out (backend ignores `kid`) | ✅ Done (per-env key check in pipeline not done) |
| APP-03 | 🟡 Medium | App | LLM calls >60 s return 504 (ALB/CloudFront 60 s vs 90 s timeout) | ⬜ Open |
| APP-04 | 🟡 Medium | App | LLM limiter's Redis init latch is permanent (silent fallback) | ⬜ Open |
| APP-05 | 🟡 Medium | App | Sync Redis calls block the asyncio event loop | ⬜ Open |
| APP-06 | 🟡 Medium | App | Worker has no graceful shutdown (SIGTERM) | ⬜ Open |
| APP-07 | 🟡 Medium | App | No upload size cap; orphaned objects never deleted | ⬜ Open |
| APP-08 | 🟡 Medium | App | Any HTTPS URL accepted as a child's photo / plan photo | 🟡 Photos limited to the child's own uploads (EDGE-05); CSP `img-src` not tightened |
| APP-09 | 🟠 High | App | No request-body size limit; uploads spooled before auth | ⬜ Open |
| APP-10 | 🟠 High | App | Child documents can grow without bound | ⬜ Open |
| APP-11 | 🟢 Low | App | Misc backend hygiene | ⬜ Open |
| DB-01 | 🔴 Critical | Database | M0 → M10/M20 (ap-south-1) now → M30+ Global Cluster later | ⬜ Open |
| DEC-01 | 🟠 Decision | Architecture | Multi-region compute while the DB is single-region | ⬜ Open |
| DEC-02 | 🟠 Decision | Network | Private connectivity from backends to the ap-south-1 DB | ⬜ Open |
| DB-02 | 🟠 High | Database | Mongo poll load, non-indexed claim, client defaults | ⬜ Open |
| DB-03 | 🟡 Medium | Database | Index creation at startup in every task | ⬜ Open |
| DB-04 | 🟡 Medium | Database | Unindexed per-user deletes | ⬜ Open |
| DB-05 | 🟡 Medium | Database | Atlas failover behaviour unspecified/untested | ⬜ Open |
| JOB-01 | 🟠 High | Jobs | Lease shorter than LLM budget; no fencing → double runs | ⬜ Open |
| JOB-02 | 🟠 High | Jobs | Retries multiply LLM cost; poison jobs; no DLQ | ⬜ Open |
| JOB-03 | 🟠 High | Jobs | Job path bypasses LLM cost controls (open LLM proxy) | ⬜ Open |
| JOB-04 | 🟡 Medium | Jobs | No LLM provider fallback | ⬜ Open |
| JOB-05 | 🟡 Medium | Jobs | Job polling collides with per-user rate limit | ⬜ Open |
| JOB-06 | 🟡 Medium | Jobs | Enqueue not idempotent; in-process lock only | ⬜ Open |
| JOB-07 | 🟢 Low | Jobs | `worker.py` untested and outside coverage gate | ⬜ Open |
| JOB-08 | 🟢 Low | Jobs | Region-scoped workers have no failover | ⬜ Open |
| AUTH-01 | 🟠 High | Auth | Google token verification blocks the event loop | ⬜ Open |
| AUTH-02 | 🟠 High | Auth | Refresh tokens: no atomic consume, no reuse detection | ⬜ Open |
| AUTH-03 | 🟡 Medium | Auth | Account unlock revives pre-lock sessions; no admin audit | ⬜ Open |
| AUTH-04 | 🟡 Medium | Auth | Brute force only per-IP; bcrypt cost & 72-byte truncation | ⬜ Open |
| AUTH-05 | 🟡 Medium | Auth | Refresh token returned to web JS; cookie scope; no Origin check | ⬜ Open |
| AUTH-06 | 🟡 Medium | Auth | Session-cleanup task can die silently; runs in every region | ⬜ Open |
| AUTH-07 | 🟡 Medium | Auth | No fail-fast config validation for stg/prod | ⬜ Open |
| PRIV-01 | 🟠 High | Privacy | Plaintext passwords and child PII written to logs | ⬜ Open |
| PRIV-02 | 🟠 High | Privacy | Deletion incomplete; worker recreates data; no 30-day purge | ⬜ Open |
| PRIV-03 | 🟡 Medium | Privacy | Children's voice/PII sent to LLM providers out of region | ⬜ Open |
| PRIV-04 | 🟢 Low | Privacy | Soft-deleted child's data still readable | ⬜ Open |
| SEC-10 | 🟠 High | Security | API task role can overwrite the public APK | ⬜ Open |
| OBS-04 | 🟡 Medium | Observability | No app logging config, request IDs or structured logs | ⬜ Open |
| MOB-01 | 🟠 High | Mobile | Prod mobile builds debug-signed and publicly downloadable | ⬜ Open |
| DR-01 | 🔴 Critical | Safety | Prod can be destroyed quickly and unrecoverably | ⬜ Open |
| DR-02 | 🟡 Medium | Safety | Account-wide services live in the stg stack; NAT EIPs churn | ⬜ Open |
| OBS-01 | 🟠 High | Observability | Alerting goes nowhere useful; edge/Redis not monitored | ⬜ Open |
| OBS-02 | 🟡 Medium | Observability | "Processing stuck" alarm will fire constantly | ⬜ Open |
| OBS-03 | 🟡 Medium | Observability | Dead workers raise no alarm | ⬜ Open |
| NET-01 | 🟠 High if DEC-01 = B / 🟡 Medium if A | Network | Prod VPC CIDRs identical in every region (blocks cross-region private DB access if DEC-01 = B) | ✅ Done (Atlas CIDR to set at cluster creation) |
| TF-01 | 🟠 High | Terraform | No reusable modules; adding a region is manual everywhere | ⬜ Open |
| TF-02 | 🟡 Medium | Terraform | Task definition `:latest` bootstrap and config drift | ⬜ Open |
| TF-03 | 🟠 High | Terraform | Prod sizing: single-process uvicorn makes CPU scaling inert | ⬜ Open |
| TF-04 | 🟡 Medium | Terraform | Redis oversized and mis-shaped for future caching | ⬜ Open |
| TF-05 | 🟡 Medium | Terraform | Bucket policies: no TLS-only deny; manual buckets | ⬜ Open |
| TF-06 | 🟡 Medium | Terraform | Cross-stack SSM coupling is order-sensitive | ⬜ Open |
| WAF-01 | 🟠 High | WAF | CRS 8 KB body limit blocks audio/LLM; rate-limit gaps | ⬜ Open |
| SCH-01 | 🟡 Medium | Scheduler | Duplicate dispatch via Lambda async retries; no timeout/alarm | ⬜ Open |
| CI-01 | 🔴 Critical | Pipelines | Prod deploy/apply possible from any branch | ⬜ Open |
| CI-02 | 🔴 Critical | Pipelines | Plan and apply in one job; scheduler applies with no plan | ⬜ Open |
| CI-03 | 🟠 High | Pipelines | Deployed image ≠ scanned image; prod deploy bypasses promotion | ⬜ Open |
| CI-04 | 🟠 High | Pipelines | Actions pinned by tag; binaries downloaded unverified | ⬜ Open |
| CI-05 | 🟠 High | Pipelines | All regions deployed at once; no canary/bake | ⬜ Open |
| CI-06 | 🟡 Medium | Pipelines | Polling and register-TD scripts duplicated | ⬜ Open |
| CI-07 | 🟠 High | Pipelines | Frontend deploy deletes live chunks; no rollback | ⬜ Open |
| CI-08 | 🟢 Low | Pipelines | CodeQL non-gating; no SARIF upload; required checks unverified | ⬜ Open |
| CI-09 | 🟡 Medium | Pipelines | Promotion moves images via `docker save` artifacts | ⬜ Open |
| CI-10 | 🟠 High | Pipelines | `promote-live-frontend` trusts the SSM SHA (injection, any ref) | ⬜ Open |
| CI-11 | 🟠 High | Pipelines | A rolled-back deploy can be reported as success | ⬜ Open |
| CI-12 | 🟡 Medium | Pipelines | Concurrency groups per service allow overlapping deploys | ⬜ Open |
| CI-13 | 🟡 Medium | Pipelines | `npm ci` runs with prod AWS credentials loaded | ⬜ Open |
| CI-14 | 🟡 Medium | Pipelines | Promote reads PRIMARY even while it's still rolling out | ⬜ Open |
| CI-15 | 🟡 Medium | Pipelines | Terraform CI checks thinner than documented | ⬜ Open |
| CI-16 | 🟢 Low | Pipelines | No job timeouts; queued runs silently cancelled | ⬜ Open |
| CI-17 | 🟢 Low | Pipelines | Misc CI hygiene (retire DB cache, skipped plans, DAST health, perms) | ⬜ Open |
| DOC-01 | 🟢 Low | Docs | Documentation drift | ⬜ Open |
| LOW-\* | 🟢 Low | Various | Small fixes (see [Low-severity items](#low-severity-items)) | ⬜ Open |

---

## Edge (CloudFront, Lambda@Edge)

### EDGE-01 — Login/google/health depend on a single region 🔴 (v4: ⏸ deferred to DB-01 Stage 2)

**Where:** `infra-live-edge/terraform/cloudfront.tf:26` (`bootstrap_region = var.backend_regions[0]`) and `:92` (`domain_name = local.regional_alb_fqdns[local.bootstrap_region]`). Failover is disabled via the checkov skip at `:46`. Authenticated traffic fails closed per region at `infra-live-edge/functions/jwt-validator-lambda.js.tpl:318-323`.

**Problem:** Every **login, Google sign-in, health** and hint-less refresh/logout request worldwide goes to the ALB in the first region of `backend_regions`. There is no failover: if that region is down, nobody can log in anywhere. Reordering `backend_regions` silently moves the bootstrap region.

> v2 correction: **register** is already partly spread: it uses the `X-Client-Location` hint (`tpl:295-298`). Only the paths above are pinned.

**Fix (C preferred, or B):**
- **C — viewer-country routing in Lambda@Edge.** Inject a country → location/region map (generated from `shared/routing.json` by `scripts/sync-routing.mjs`) and pick the bootstrap region from `CloudFront-Viewer-Country`, with an ordered fallback list. First confirm that the origin request policy on `/api/*` (AllViewerExceptHostHeader) forwards `CloudFront-Viewer-Country`.
- **B — Route 53 latency + health-checked record** (e.g. `api-bootstrap-<env>.<domain>`) across all regional ALBs, used as the bootstrap origin. Requires:
  - every regional ACM cert to cover that name;
  - the Lambda to set `Host` to it;
  - careful handling of non-idempotent `register` during failover.
- Either way, make the bootstrap list an **explicit variable** (`bootstrap_regions = [...]`) instead of taking `[0]` implicitly.
> ⏸ **v4: deferred to DB-01 Stage 2 (Global Cluster).** In the near term the DB is an M10/M20 replica set **in ap-south-1 only**, so an ap-south-1 outage is a total outage whatever the edge does. Failing login over to eu-west-1/us-east-1 adds little availability, and it adds cross-region DB latency to every login. Until Stage 2:
> - make the bootstrap region an apply-time choice (a named variable, not only `backend_regions[0]`);
> - see DEC-01.
>
> ✅ **Stage 1 implemented (2026-10-19):** `var.bootstrap_region` is the `bootstrap_region` input of `terraform-live-edge.yml` / `terraform-live-all.yml`. `auto` (default) keeps the first region in `backend_regions`; a named region must be in `backend_regions`, or plan fails. It is **not** pinned to ap-south-1: the Atlas cluster is reachable from every backend region via its Mongo URI, so any deployed region can serve login (at the cost of cross-region DB latency). The choice is **per run**: a run that doesn't pass it (e.g. the daily scheduler) uses `auto`.
>
> Implement the full fix when the Global Cluster exists.

- **Hard prerequisite: DB-01 Stage 2.**
  - Today every region uses one free-tier M0 Atlas cluster in ap-south-1, and the near-term M10/M20 is still single-region. Spreading login across regions adds no availability while ap-south-1 holds the only database.
  - Even on the planned Atlas Global Cluster, `email_index` is unsharded on the **primary shard** (one zone), so login and register depend on that zone and the config servers.
  - Decide the primary shard's zone, and whether zones get electable nodes in a second region (multi-region zones). Otherwise accept that losing a zone's region loses those users.
- Per-IP login limits live in each region's Redis, so once bootstrap traffic is spread across N regions the effective limit is N× (see APP-01 and AUTH-04).

⚠️ **Pitfalls:**
- **CloudFront origin groups won't work here** (this was v1's fix A). Origin failover only happens for GET/HEAD/OPTIONS requests, and `/api/*` allows all 7 methods (`cloudfront.tf:179`), so POST-based bootstrap paths can't fail over.
- Every bootstrap path except `/api/health` is a POST.
- Lambda@Edge already overrides `request.origin`, which bypasses group failover.

**Acceptance criteria:**
- **Stage 1 (now, interim):** `cloudfront.tf` takes the bootstrap region from `var.bootstrap_region` (default `auto` = `backend_regions[0]`); with a named region, changing the `backend_regions` selection doesn't move it, and a named region outside `backend_regions` fails the plan.
- **Stage 2:** with the bootstrap region's API scaled to 0 (in stg), login/google/register still succeed via another region.
- **Stage 2:** the bootstrap region selection is documented in `docs/infra-architecture-multi-region.md`.

---

### EDGE-02 — Origin-verify secret is plaintext in Lambda@Edge code 🔴

**Where:**
- `infra-live-edge/terraform/lambda_edge.tf:37` passes `origin_verify_secret` into `templatefile`.
- `jwt-validator-lambda.js.tpl:100` holds `const ORIGIN_VERIFY_SECRET = ${jsonencode(origin_verify_secret)}`.
- The secret is also in the local zip (`lambda_edge.tf:27`), the CloudFront origin custom header (`cloudfront.tf:99-102`), the backend ALB rule (`infra-live-backend/terraform/alb.tf:118`, `values = [var.origin_verify_secret]`), and state.

**Problem:**
- Anyone with `lambda:GetFunction` can read the secret, and it's replicated to every edge region.
- Rotating it means redeploying backend and edge together, and requests fail while edge replicas propagate.

**Fix (simplest first):**
1. **Stop embedding it.** In an origin-request event, `request.origin.custom.customHeaders` already contains the origin's configured `x-origin-verify` header. When the Lambda re-points the origin with `setOrigin()` (`tpl:271-273`), copy that header from the incoming origin instead of using a constant. No Secrets Manager call is needed.
2. Support **two valid values** during rotation: the ALB rule `http_header.values` is OR-matched, so list current + next.
3. Write a rotation runbook in `docs/infra-operations.md`: add next to ALB → switch the CloudFront origin header → remove old.

⚠️ **Pitfalls if you choose Secrets Manager instead:**
- The call goes cross-region from every regional edge cache to us-east-1, which adds cold-start latency and makes us-east-1 a single point of failure.
- The current `timeout = 5` (`lambda_edge.tf:88`) is too low; origin-request allows up to 30 s.
- Lambda@Edge has no env vars.
- The value still remains in the distribution config and in state, so pair this with SEC-01.

**Acceptance criteria:**
- The rendered Lambda zip contains no literal secret.
- Rotation follows the runbook with zero 403s.
- Unit tests cover the header-copy path.

---

### EDGE-03 — 404s rewritten to 200 + `index.html` distribution-wide 🔴

**Where:** `infra-live-edge/terraform/cloudfront.tf:209-214`

```hcl
custom_error_response {
  error_code            = 404
  response_code         = 200
  response_page_path    = "/index.html"
  error_caching_min_ttl = 0
}
```

**Problem:**
- `custom_error_response` applies to **every** behaviour. Any API 404 (e.g. `children.py` "Child not found") reaches the client as **200 with an HTML body**.
- Missing Vite chunks under `/assets/*` also come back as 200 HTML, because the SPA bucket grants `ListBucket` (`infra-live-frontend/terraform/s3_policy.tf:40-45`) and so returns 404. The browser then raises a MIME-type error instead of a detectable 404 (see CI-07).

> v2 correction: missing `/uploads/*` and `/app-assets/*` objects return **403**, not `index.html`. Those bucket policies grant only `s3:GetObject` (`s3_uploads_policy.tf:35`, `s3_backend_policy.tf:28`). The exception is `/uploads/<undeployed-location>/…`, which falls through to the SPA origin and does return 200 `index.html`.

**Fix:**
- Remove the distribution-wide `custom_error_response`.
- Add a **CloudFront Function** (viewer-request) on the default `/*` behaviour that rewrites extensionless paths to `/index.html`. No other function is attached there today.
- Attach it **only to the default behaviour**; the other paths have their own behaviours. `/assets/*` and `/uploads/<undeployed-location>/…` are served by the default behaviour, so inside the function rewrite **only** when the URI has no file extension **and** doesn't start with `/uploads/`, `/app-assets/`, `/api/` or `/assets/`.

**Acceptance criteria:**
- `GET /api/v1/<nonexistent>` → 404 JSON.
- `GET /some/spa/route` → 200 `index.html`.
- `GET /assets/missing.js` → 404.
- `GET /uploads/<missing>` → 403/404, never `index.html`.
- After the first deploy, the published function behaves the same in the real CloudFront runtime as in the Node unit tests (`spa-rewrite.test.js`). `/Login` → `/index.html`; `/assets/x.js` and `/api/v1/x` unchanged:
  ```bash
  ETAG=$(aws cloudfront describe-function --name "<app>-<env>-spa-rewrite" --stage LIVE --query ETag --output text)
  EVT=$(mktemp)
  for uri in /Login /assets/x.js /api/v1/x; do
    echo "{\"version\":\"1.0\",\"context\":{\"eventType\":\"viewer-request\"},\"viewer\":{\"ip\":\"198.51.100.1\"},\"request\":{\"method\":\"GET\",\"uri\":\"$uri\",\"querystring\":{},\"headers\":{},\"cookies\":{}}}" > "$EVT"
    aws cloudfront test-function --name "<app>-<env>-spa-rewrite" --if-match "$ETAG" --stage LIVE \
      --event-object "fileb://$EVT" --query 'TestResult.FunctionOutput' --output text
  done
  rm -f "$EVT"
  ```

---

### EDGE-04 — Edge JWT validation gaps 🟡 (v2: lowered from High)

**Where:** `jwt-validator-lambda.js.tpl:165-199` (`verifyJwt`), `:170` (`const kid = header.kid || DEFAULT_KID`), `:194` (`if (payload.exp && now > payload.exp)`), `:300-316` (authenticated-path check).

> v2 correction: the backend already issues `type`, `exp` and `kid` on every token (`backend/app/auth_utils.py:58,73,94`) and rejects non-access tokens (`deps.py:43`). `limiter.py:51` only uses `type` to choose the rate-limit bucket; a non-access token falls back to the IP bucket. A refresh token used as Bearer **passes the edge but is rejected by the backend**, so this is wasted capacity, not an auth bypass. Browsers send the refresh cookie only under `/api/v1/auth/` (`auth_utils.py:137`).

**Gaps:**
- `exp` is optional, at the edge and in PyJWT `decode()`.
- The edge doesn't check `payload.type === 'access'` on authenticated paths.
- A missing `kid` falls back to `DEFAULT_KID`.
- `alg` is never read. This is safe today (RS256 is always used), but should be explicit.
- There is no clock-skew leeway.
- The PEM is parsed on **every request**, wasting CPU on every `/api` call.
- There is no JWKS; key rotation needs a Lambda redeploy. See also APP-02.

**Fix:**
1. **Edge:**
   - Require `exp`.
   - Require `payload.type === 'access'` on authenticated paths. Reuse the existing claim; no new `token_use` claim is needed.
   - Require `header.alg === 'RS256'`.
   - Reject a missing `kid` now: every token already has one and the longest lifetime is 24 h, so no staged rollout is needed.
   - Allow 30–60 s leeway.
   - Pre-build `KeyObject`s once at module load.
2. **Backend:** at all three decode sites (`auth_utils.py:104,120`, `limiter.py:44`), add `leeway=30` and `options={"require": [...]}`:
   - **Merge** the new options with the existing `{"verify_exp": False}` at `limiter.py:48` and `auth_utils.py:124`. Don't replace them, or refresh/logout and limiter keying start rejecting expired access tokens.
   - `require` lists differ per token type: `["exp", "iat", "sub", "type", "location"]` for access tokens, plus `jti` for refresh tokens. Apply them in `decode_token_of_type`, not in the shared `decode_token`.
   - The revocation check in `deps.py:70-79` depends on `iat`.
   - PyJWT 2.15 also raises `ImmatureSignatureError` for a future `iat`. Tokens are minted in the bootstrap region and verified elsewhere, so the leeway also absorbs clock skew.
   - Cache the parsed key objects: today PyJWT re-parses the PEM on every encode and up to twice per request.
> ✅ **v6 (2026-10-19): `iss`/`aud` implemented in one step**, not the three below. Every environment starts with a fresh database, so there are no live sessions to keep. `iss` = `<app_name>-<environment>`, `aud` = `<app_name>-api`, stamped by the backend's `_encode()` and required by `decode_verified()` and the Lambda's `verifyJwt()`. Both values are built by Terraform from the same expressions in `infra-live-backend/terraform/ecs.tf` and `infra-live-edge/terraform/lambda_edge.tf`. Use the three-step order below for an environment that does have live users.

3. **Optional `iss`/`aud` (three-step rollout):**
   1. Deploy decoders that accept tokens **with or without** the claims: `options={"verify_aud": False}`, then check `aud`/`iss` manually when present.
   2. Start issuing tokens with `aud`/`iss`.
   3. After the longest token lifetime (24 h), switch to `audience=`/`issuer=`.

   v5 correction: v3/v4 said to pass `audience=` first. In PyJWT 2.15, `decode(audience=...)` on a token **without** `aud` raises `MissingRequiredClaimError`, so that order causes the global 401.
4. **Longer term:** a JWKS (see APP-02) so rotation needs no redeploy.
5. Once a missing `kid` is rejected, remove the dead `DEFAULT_KID` and `jwt_key_id` template variable (`tpl:60`). This also resolves L15's `${jwt_key_id}`.

⚠️ **Pitfall:** PyJWT raises `InvalidAudienceError` when a token carries `aud` and `decode()` is called without `audience=`. Issuing `aud` before the decoders are updated produces a **global 401**.

**Acceptance criteria:**
- Edge tests:
  - no `exp` → 401;
  - `type: refresh` on an authenticated path → 401;
  - `alg != RS256` → 401;
  - no `kid` → 401;
  - inside the leeway → allowed.
- Backend tests:
  - no `exp` → 401
  - no `type` → 401
  - unknown `kid` → 401 (requires APP-02's per-`kid` key lookup; implement together)
- Existing edge and backend tests that mint tokens without `exp`/`type` (e.g. `jwt-validator-lambda.test.js:196`, `signJwt({ location: 'eu' })`) are updated.

---

### EDGE-05 — `/uploads/*` (child photos) is public and edge-cached 🟠

**Where:** `infra-live-edge/terraform/cloudfront.tf:149-171` (the comment calls these "semi-public"). Permanent CDN URLs are built by `build_public_url` (`backend/app/services/s3_uploads.py:37-44`) and returned at `children.py:569` / `users.py:567`.

> v3 correction: the stored fields are `children.avatar_url` and **`ninety_day_plans.photos: dict[str, list[str]]`** (`schemas/ninety_day_plan.py:56,76`). `photo_url` is only a presign response field. Also, **delete flows never delete S3 objects** (see PRIV-02), so a "deleted" photo stays reachable by URL indefinitely, not just for the 24 h edge TTL.

**Problem:**
- Children's photos have no auth and are cached at the edge (CachingOptimized, up to 24 h).
- Anyone with a URL can fetch them, which is a privacy and compliance risk.
- Deleted photos stay at the edge for up to 24 h, which conflicts with the "delete all data" flow (`auth.py:672`).

> v2 correction: keys are **already unguessable**. `build_upload_key` ends in `uuid.uuid4()` (`backend/app/services/s3_uploads.py:61-62`).

> ✅ **v6 (2026-10-19): implemented with S3 presigned GET URLs instead of CloudFront signed URLs.** CloudFront signing needs its own RSA key pair, key group, a key-ID hand-off between stacks, a staged rollout and its own rotation. Presigned GETs are signed with the API task role's temporary credentials, so there's nothing to manage. Accepted trade-offs: photos aren't edge-cached, each read returns a new URL (no browser cache reuse), and a URL can end early (worst case about 15 min) if the role's credentials expire first. The `/uploads/*` CloudFront behaviours, origins, OAC and bucket policies were removed, so the bucket is readable only through presigned URLs. Keys-only storage, the per-child ownership check (APP-08) and same-named API fields were kept. See `docs/infra-operations.md` "Photo URLs (EDGE-05)".

**Fix (signed URLs recommended):**
1. **CloudFront signed URLs** with a trusted key group on `/uploads/*`:
   - Store only the **S3 key** in Mongo, not a permanent URL, and sign on every read with a short TTL (e.g. 15 min–1 h).
   - Use signed **URLs**, not cookies: the mobile app has no cookie jar.
   - **What the key-only migration touches (v3):**
     - **Data:** `children.avatar_url`, which is also in `_LIST_PROJECTION` at `children.py:48`; and `ninety_day_plans.photos.*[]`.
     - **Schemas:** `ChildResponse`, `ChildCreate`, `ChildPatch` (`schemas/children.py:71,107,175`), `NinetyDayPlanPatch`, `NinetyDayPlanResponse`, `AvatarPresignResponse`, `NinetyDayPlanPhotoPresignResponse`.
     - **Endpoints that must sign on read:**
       - `GET /children` (up to 200 per call, so sign in a batch with a cached signer)
       - `GET /children/{id}`
       - `PATCH /children/{id}` and `POST /children/{id}/progress` responses
       - `GET`/`PATCH /user/ninety-day-plan`
     - **Inputs:** both PATCH endpoints must accept **keys**, not URLs. Otherwise clients echo signed URLs back.
     - **Elsewhere:** `openapi.json`, `docs/api.md:23,33`, `docs/static-assets.md:184-188`, and the web and mobile clients.
     - **Blind spot:** URLs stored inside `extra="allow"` blobs can't be enumerated; sweep for them with a regex during the migration.
2. On photo delete, issue a CloudFront invalidation for that key, or use a short TTL.
3. Alternative: JWT auth on `/uploads/*`. It needs a **new viewer-request** Lambda@Edge (origin-request doesn't fire on cache hits), and that function is limited to 5 s, 128 MB and a 1 MB zip. Ownership can't be checked at the edge, because keys hold `child_id`, not the user `sub`. CloudFront Functions can't verify RSA.

⚠️ **Pitfalls:**
- Don't put the signature in the cache key. CloudFront validates signed URLs **before** the cache lookup, so adding the signature to the key only destroys the hit rate.
- Don't reuse the existing origin-request function: its `setOrigin` would re-point uploads at the ALB.

**Acceptance criteria:**
- An unsigned or expired `/uploads/...` request → 403.
- Web and mobile still display photos.
- A deleted photo is unreachable within the chosen TTL.

---

## Security & secrets

### SEC-01 — Secrets stored in Terraform state 🟠

**Where:**
- Redis token: `infra-live-backend/terraform/elasticache.tf:78`, passed via `terraform-live-backend.yml:287-291`.
- Origin secret: `alb.tf:118` and the edge stack; passed via `terraform-live-backend.yml:94` and `terraform-live-edge.yml:103`.
- GitHub PAT: `infra-live-scheduler/terraform/secrets.tf:34`, passed via `terraform-live-scheduler.yml:99`.

> v2 correction: `sensitive = true` is **already set** on all three variables (`infra-live-backend/terraform/variables.tf:76,82`, `infra-live-edge/terraform/variables.tf:90`, `infra-live-scheduler/terraform/variables.tf:57`), and only text plans are uploaded. Values are redacted in plans but **still in state**. `ignore_changes` does **not** keep a value out of state, so v1's suggestion of it was wrong.

**Fix:**
1. **State bucket hardening:** a customer-managed KMS key, versioning, public-access block, and `s3:GetObject` on state keys limited to the Terraform roles. The bucket is created manually, so codify it (or document it) in a bootstrap stack.
2. **Write-only attributes.** Terraform ≥ 1.11 and AWS provider 6.x support these, and this repo pins `required_version = "~> 1.16.0"` and AWS `~> 6.28` (`secret_string_wo` needs provider ≥ 5.87).
   - PAT: `aws_secretsmanager_secret_version` with `secret_string_wo` + `secret_string_wo_version`.
   - Redis: check whether `aws_elasticache_replication_group` supports a write-only auth token in the pinned provider. If not, manage the token outside Terraform: an RBAC user group (Valkey/Redis 7) with passwords set by a pipeline step, or `auth_token_update_strategy = "ROTATE"` via CLI.
   - Origin secret: EDGE-02 removes it from the code. For the ALB rule and the CloudFront header it remains in state, so rely on (1).
3. Pair with SEC-05 (two sources of truth for the Redis token).

**Acceptance criteria:**
- `terraform state pull` shows no plaintext PAT.
- The PAT (and any other migrated secret) is **rotated** after the switch to write-only, because older state object versions still hold the old value, especially once bucket versioning is on.
- Any remaining secrets in state are protected by KMS + IAM, and this is documented.

---

### SEC-02 — WAF logs capture tokens and cookies 🟠

**Where:** `infra-live-edge/terraform/waf_logging.tf:82-87` has no `redacted_fields` and no `logging_filter`. Logging is prod-only. (`X-Origin-Verify` isn't exposed, because it's added after WAF.)

**Fix:**
- Add `redacted_fields { single_header { name = "authorization" } }` and `{ name = "cookie" }`.
- Add a `logging_filter` keeping BLOCK/COUNT only.
- Add lifecycle expiry on the (manual) log bucket. Its lifecycle isn't visible in code, since only CloudTrail statements are at `:96-123`.

**Acceptance criteria:** WAF log records show `REDACTED` for the `Authorization` and `Cookie` headers.

---

### SEC-03 — Scheduler: broad classic PAT and raw-event dispatch 🟠

**Where:** `infra-live-scheduler/terraform/secrets.tf` (PAT), `infra-live-scheduler/lambda/dispatcher.py:26`, `infra-live-scheduler/terraform/scheduler.tf:23-30` (trust policy).

**Problems:**
- A classic `repo` + `workflow` PAT can push code to every repo the owner can reach.
- `dispatcher.py:26` forwards the **raw invoke event** as the dispatch payload. Anyone allowed to invoke the function can dispatch any `ref`, `action` or `environment`, including destroy.
- The role trust policy has no `aws:SourceAccount`/`aws:SourceArn` condition.

**Fix:**
1. Use a **fine-grained PAT**: this repo only, "Actions: read & write". A GitHub App also works but requires packaging PyJWT/cryptography into the Lambda.
2. Build the payload **inside** the Lambda from fixed values: workflow file, the default branch, and an allow-listed `action ∈ {apply, destroy}` and `environment ∈ {dev, sbx, stg}`. Reject anything else.
3. Add `aws:SourceAccount` + `aws:SourceArn` to the trust policy. For EventBridge Scheduler, `aws:SourceArn` is the **schedule-group** ARN (`aws_scheduler_schedule_group.main.arn`, form `arn:aws:scheduler:…:schedule-group/<name>`).
4. Audit IAM for `lambda:InvokeFunction` on `*`. A resource policy can't restrict same-account invokers, so Fix #2 (a server-built payload) is the actual control.

**Acceptance criteria:**
- Invoking the function with `{"environment": "prod", "action": "destroy"}` is rejected.
- The token can only dispatch workflows in this repo.

---

### SEC-04 — OIDC trust documented as `repo:…:*` with AdministratorAccess 🔴 (new in v2)

**Where:**
- `docs/ci-cd.md:168` (`repo:YOUR_GITHUB_ORG/buddy-app:*`) and `:169` (AdministratorAccess).
- `frontend-app/README.md:929` uses the wildcard `sub`; `docs/environments.md:146` also attaches AdministratorAccess. (`environments.md:140-144` already scopes `sub` to `environment:<env>`, and `ci-cd.md:168` offers `environment:dev` as an alternative.)
- This contradicts the environment-scoped advice in `environments.md:140`.

**Problem:** With a wildcard `sub`, **any branch** (and potentially any workflow, including a PR from a collaborator) can assume the prod admin role. The role ARN isn't really secret, since it appears in logs and ARNs. This makes every other pipeline control (environment reviewers, branch rules) bypassable.

**Fix:**
1. One role per environment, trusted **only** for `repo:<org>/buddy-app:environment:<env>`. Combine it with Environment deployment-branch rules (CI-01), so the claim also implies the ref.
2. Separate **plan (read-only)** and **apply** roles (see CI-02).
3. Replace AdministratorAccess with least-privilege policies per stack (start from the IAM Access Analyzer policy generated from CloudTrail).
4. Fix all three docs.

**Acceptance criteria:**
- The trust policies of all **apply/deploy** roles use `environment:` subjects only. The dev plan role may also trust `:pull_request` (CI-02 #4).
- An `aws sts assume-role-with-web-identity` attempt from a non-environment job fails.
- No role has AdministratorAccess.

---

### SEC-05 — Secrets init step can overwrite rotated secrets 🟡 (new in v2)

**Where:** `.github/workflows/terraform-live-backend.yml:373-376`, and `infra-live-backend/terraform/secrets.tf:51-67`.

**Problems:**
- `get-secret-value … 2>/dev/null || echo '{"JWT_PRIVATE_KEY":"REPLACE_ME"}'`: any error (a throttle, an IAM issue) is treated as "placeholder". That triggers `put-secret-value` with the **entire** JSON from GitHub secrets and overwrites manually rotated values. A single placeholder key also overwrites every key.
- `REDIS_AUTH_TOKEN` has **two sources of truth**: the Terraform variable sets ElastiCache's token, while the Secrets Manager JSON (read by tasks via `settings.py:168`, `limiter.py:72`, `llm_rate_limiter.py:103`) is filled on first apply only. Rotating the GitHub secret changes Redis but not what the tasks use.

> v3 correction: a mismatched token does **not** crash anything. Tasks stay healthy and **silently** fall back to per-task in-memory limits (with 15–200 tasks, limits become 15–200× looser). The only signal is a warning log line, which may not even be emitted (OBS-04). Tasks must also restart to pick up a rotated secret.

**Fix:**
1. Fail on any error other than `ResourceNotFoundException`.
2. Merge per key: only fill keys whose value is still `REPLACE_ME`.
3. Have **one** source for the Redis token:
   - **Preferred:** a separately managed secret created **before** the backend stack (bootstrap stack or CLI). Both Terraform and the tasks reference it.
   - **Or:** generate it in Terraform (`random_password`, ≥ 16 chars), write it into the app secret, and pass it to ElastiCache. This accepts state storage under SEC-01's controls.

   ⚠️ Pitfall: reading the **same-stack** app secret with `data "aws_secretsmanager_secret_version"` doesn't work. On first apply it holds `REPLACE_ME` (10 chars), but ElastiCache needs ≥ 16 chars, so the apply fails. The value would also land in state anyway.
4. Rotate with `auth_token_update_strategy = "ROTATE"` (old and new tokens both valid), restart tasks, then `SET`.
5. Add a startup Redis AUTH check that emits a `RedisDegraded` metric, plus an alarm on it.

**Acceptance criteria:**
- A simulated `AccessDenied` on get fails the step.
- Rotating one key never changes the others.
- Rotating the Redis token updates both ElastiCache and the task secret with no limiter fallback.
- A wrong token raises an alarm within 5 minutes.

---

### SEC-06 — Secrets exposed job-wide to every step 🟡 (new in v2)

**Where:** Terraform workflows set `TF_VAR_*` secrets in job-level `env:` (e.g. `terraform-live-backend.yml:85-99`) and through `GITHUB_ENV` (`:196-302`).

**Problem:** Every later step, including third-party actions such as `setup-terraform` and `upload-artifact`, can read the Redis token, origin secret and PAT. This compounds CI-04.

**Fix:**
- Pass secrets as step-level `env:` on the `terraform plan`, `plan -destroy` and `apply` steps only.
- Don't write secrets to `GITHUB_ENV`.
- Set `terraform_wrapper: false` on `hashicorp/setup-terraform`. Otherwise every later `terraform` call runs through the action's Node wrapper, which still sees the step env.

**Acceptance criteria:** No `secrets.*` in any job-level `env:`; no step writes a `secrets.*`-derived value to `$GITHUB_ENV`; `terraform_wrapper: false` is set.

---

### SEC-07 — `${{ }}` interpolated directly into `run:` 🟡 (new in v2)

**Where (representative; fix every occurrence):**
- `terraform-live-edge.yml:144,171,216,222` (`echo '${{ inputs.backend_regions }}'`)
- `terraform-live-backend.yml:149-157,195-199,263-266,312-313,323,407`
- `terraform-live-frontend.yml:118-119,136-137,147,176`
- `terraform-live-scheduler.yml:140-141,151-152,162,187,213`
- `deploy-live-backend.yml:99,127,158-162,230-233,244,267,353`. The git branch name at `:159` can contain `$(...)`.
- `promote-live-backend.yml:79-80,157,345,446,531`
- `restart-live-backend.yml:84,108`
- `deploy-live-frontend.yml:82-85,104-105,143,149,158,182-186`. `s3_bucket` comes from SSM.
- `build-android-apk.yml:77-80,122-123`, `build-ios-ipa.yml:84-87,122-123,315`
- Every Terraform workflow's `-var-file=tfvars/${{ inputs.environment }}.tfvars`, which allows path traversal via `workflow_call`.

**Problem:** The `workflow_dispatch` inputs are `choice` types, which is low risk. But `workflow_call` string inputs, step outputs, SSM values and branch names are injected into shell unescaped. See CI-10 for the exploitable case.

**Fix:**
- Map every expression to `env:` and reference it as `"$VAR"` (quoted).
- In reusable workflows, validate `environment` against `^(dev|sbx|stg|prod)$` and regions against the allow-list in a **separate first job without `environment:`**, as `promote-live-backend`'s `validate` job already does. A step can't do this: `environment:` and its secrets are resolved before any step runs.

**Acceptance criteria:** `zizmor .github/workflows` reports no `template-injection` findings, or `actionlint` reports no expression inside `run:` scripts.

v5 correction: the earlier grep could never pass. It matched the correct `env:` mappings and missed `matrix.*`, `github.*` and `env.*`.

---

### SEC-08 — GuardDuty Runtime Monitoring doesn't cover Fargate 🟠 (new in v2)

**Where:** `infra-live-backend/terraform/security.tf:26-31`, and the same pattern in the edge stack's us-east-1 detector.

**Problem:** `RUNTIME_MONITORING` is enabled without `additional_configuration { name = "ECS_FARGATE_AGENT_MANAGEMENT", status = "ENABLED" }`. No GuardDuty agent is injected into the Fargate tasks, so the runtime coverage that `docs/aws-cost-estimate.md` budgets for **doesn't exist**.

**Fix:**
- Add the `ECS_FARGATE_AGENT_MANAGEMENT` additional configuration on both detectors.
- Confirm the GuardDuty-managed VPC endpoint is created. GuardDuty creates it itself when automated agent configuration is on; *uncertain*, so verify in stg. Tasks must also be able to pull the sidecar image from ECR (via NAT or the ECR endpoints).

**Acceptance criteria:** After forcing a new ECS deployment (the agent sidecar is only injected into newly started tasks), GuardDuty console → Runtime coverage shows the ECS clusters as "Healthy".

---

### SEC-09 — CloudTrail design 🟡 (new in v2)

**Where:**
- `infra-live-backend/terraform/security.tf:53` (`is_multi_region_trail = false`) plus the edge stack's us-east-1 trail.
- `infra-live-backend/terraform/s3.tf:101-123` (CloudTrail bucket statements).

**Problems:**
- Trails exist only in backend regions + us-east-1, so activity in any other region is unaudited.
- With a us-east-1 backend there are two trails in the same region. The second trail's management events are billed.
- The bucket policy has no `aws:SourceArn` condition, which leaves a confused-deputy risk.

**Fix:**
- Replace them with **one multi-region trail**, ideally an AWS Organizations trail, owned by a long-lived account-level stack (see DR-02), with log file validation.
- Add `aws:SourceArn`/`aws:SourceAccount` conditions to the bucket policy.

**Acceptance criteria:** One trail with `IsMultiRegionTrail=true`; the bucket policy carries a source condition.

---

## Application issues that affect infra

### APP-01 — IP rate limits use the spoofable leftmost `X-Forwarded-For` 🟠 (new in v2)

**Where:** `backend/app/limiter.py:17-25` (`return forwarded.split(",")[0].strip()`).

**Problem:** CloudFront and the ALB **append** to `X-Forwarded-For`, so the leftmost entry is whatever the client sent. An attacker rotates fake values and bypasses every per-IP limit, including the unauthenticated **login/register** buckets (credential stuffing). The code comment ("standard proxies prepend") is wrong.

**Header chain:** CloudFront appends the viewer IP, then the ALB (default `append` mode) appends the CloudFront edge IP. The backend therefore sees `<client-supplied…>, <viewer>, <cf-edge>`, so **`XFF[-2]`** is the real viewer on AWS.

**Fix:**
1. Add a `TRUSTED_PROXY_HOPS` setting: 2 on AWS (CloudFront + ALB), 1 in docker-compose (nginx, `frontend/nginx.conf:35`, `$proxy_add_x_forwarded_for`). Take `XFF[-TRUSTED_PROXY_HOPS]`. If there are fewer entries than that, use the peer address, **never** `[0]`.
2. Pin `xff_header_processing_mode = "append"` on the ALB (`alb.tf`) so the hop count stays stable.
3. Alternative: forward `CloudFront-Viewer-Address`, after confirming the `AllViewerExceptHostHeader` policy at `cloudfront.tf:184` passes it. Strip the port with `rsplit(":", 1)`, because IPv6 contains colons.
4. Bucket IPv6 addresses by `/64`.
5. Rewrite `tests/test_limiter.py:50-53`, which asserts the leftmost behaviour, and add spoofed-XFF tests for 1 and 2 hops.

⚠️ **Pitfalls:**
- In uvicorn 0.34, proxy headers are **on by default** but trusted only from `127.0.0.1` (`forwarded_allow_ips` default), so the ALB peer's XFF is ignored and `request.client.host` is the ALB node IP. That's why `BEHIND_PROXY=false` would lump every user into a few shared buckets.
- **Don't use uvicorn's proxy trust to fix this.**
  - With `FORWARDED_ALLOW_IPS=*` it returns the leftmost (spoofed) entry.
  - With `--forwarded-allow-ips=<VPC CIDR>` it walks XFF right to left and returns the first untrusted hop. That's the **CloudFront edge IP**, which isn't in the VPC, so every user would be bucketed by edge IP.
  - Keep the IP logic in `_get_client_ip`.
- Per-IP limits are per region's Redis (EDGE-01).

**Acceptance criteria:**
- A request with a forged `X-Forwarded-For: 1.2.3.4` is still limited by its real IP, both on AWS (2 hops) and in compose (1 hop).
- A header with too few entries falls back to the peer address.

---

### APP-02 — JWT key rotation logs everyone out 🟠 (new in v2)

**Where:**
- `backend/app/auth_utils.py:104,120` decode with a single `settings.jwt_public_key`.
- `backend/app/settings.py:71-81` derives that key from the region's own private key and ignores `kid`.
- `docs/jwt-keys.md` describes "zero-downtime rotation".

**Problem:** At jwt-keys.md Step 3, every token signed with the old key fails at the backend (while the edge still accepts it), so all users in that region are logged out. The documented zero-downtime rotation is false.

**Fix:**
- Backend gets `JWT_PUBLIC_KEYS` (a `kid` → PEM map, e.g. a JSON secret) and selects the key by the token's `kid` header at **all three** decode sites: `auth_utils.py:104,120` **and** `limiter.py:44`. If the limiter isn't updated, users with old-`kid` tokens silently drop into IP buckets.
- Sign with the current key only.
- Keep the old public key until the maximum refresh lifetime (24 h) has passed.
- Align the edge's key map with it (the same JWKS source; EDGE-04 #4).
- Reject an **unknown `kid`** with 401; never fall back to a default key.
- Cache the parsed key objects (see EDGE-04 #2).
- Update `docs/jwt-keys.md`. Note that the backend currently has **no** `JWT_PUBLIC_KEYS` setting at all; `jwt-keys.md:13` lists it as edge-only.

⚠️ **Pitfalls:**
- Login tokens are minted in the **bootstrap region** (`local.bootstrap_region`: the `bootstrap_region` input, or the first of `backend_regions` when `auto`; EDGE-01 interim) and verified in the **home region**. The `kid` → key map must be identical in **every** region. Switch the signer to the new key only after every region (backend and edge) holds the new public key.
- Confirm that dev, stg and prod use **different** key pairs. With no `iss`/`aud`, the key is the only thing stopping a dev token from working in prod.

**Acceptance criteria:**
- A test signs with `kid=v1`, rotates to v2, and the v1 token still validates until v1 is removed.
- An unknown `kid` → 401.
- The keys differ per environment (checked in the deploy pipeline).

---

### APP-03 — LLM calls >60 s return 504 🟡 (new in v2)

**Where:**
- `infra-live-backend/terraform/tfvars/prod.tfvars:29` (`llm_timeout_seconds = 90`) and `backend/app/routers/llm.py:54` (synchronous `/llm/invoke`).
- `alb.tf` doesn't set `idle_timeout`, so the default of 60 s applies.
- `infra-live-edge/terraform/cloudfront.tf:113` (`origin_read_timeout = 60`).

**Problem:**
- Calls between 60 and 90 s return 504 to the user but still run, are paid for, and count against the user's limit.
- `deregistration_delay` defaults to 300 s, which slows deploys and scale-in.

> v3 correction: this is worse than stated. Neither SDK client sets `max_retries` (`backend/app/services/llm_service.py:45,54`), so OpenAI and Anthropic each **retry twice by default** on timeout or 5xx. One `/llm/invoke` (`routers/llm.py:57`) can run about 3 × 90 s plus backoff, roughly **280 s**. Gemini runs as a sync call in `to_thread` (`:189`) and **can't be cancelled**.

**Fix:**
1. Set `max_retries=0` (or 1) on the OpenAI and Anthropic clients, and handle retries explicitly where you want them.
2. Wrap `invoke()` in `asyncio.timeout(total_budget)` so the whole call has one hard budget.
3. Make the budget fit the infra: lower `llm_timeout_seconds` (and the total budget) below 55 s, **or** raise ALB `idle_timeout` (e.g. 120) **and** CloudFront `origin_read_timeout`. Values above 60 s need a quota increase (up to 180 s).
4. Better: move long LLM calls to the async job + poll/stream model the worker already uses.
5. Gemini: use the async `google-genai` SDK. `google.generativeai` is deprecated.
6. Set `deregistration_delay` to about `total_budget + 10`, and uvicorn `--timeout-keep-alive` above the ALB `idle_timeout` (see TF-03).

**Acceptance criteria:**
- No timeout layer is shorter than the layer behind it.
- The total wall time of one `invoke` is capped (a test with a hanging provider returns within the budget).
- A test asserts the client `max_retries` setting.

---

### APP-04 — LLM limiter's Redis init latch is permanent 🟡 (new in v2; corrected in v3)

> v3 correction: v2 blamed slowapi. slowapi actually **recovers on its own**: `extension.py:599-605` re-probes with 2ⁿ-second backoff and clears `_storage_dead`. The middleware probes on non-decorated requests for `limiter`, and the decorated `refresh`/`logout` routes recover `user_limiter`. The `_hit()` latch is only temporary.

**Where:** `backend/app/llm_rate_limiter.py:82-116` (`_get_redis()` with `_redis_init_attempted`).

**Problem:**
- If Redis is unreachable on first use, `_redis_init_attempted = True` and the client stays `None` for the **life of the process**.
- From then on, the **per-user LLM hourly limit** and the **session-cleanup lock** (`main.py:78`) silently run without Redis, per task. With 15–200 tasks, LLM spend limits become 15–200× looser.
- Mid-request Redis errors on the LLM path don't latch, but each one costs up to a 2 s socket timeout.

**Fix:**
- Retry init with backoff and a circuit-breaker (half-open re-probe every N seconds) instead of a one-shot flag.
- Lower the socket timeout to about 200–500 ms on the hot path.
- Emit a `RedisDegraded` metric (also from slowapi's fallback) and alarm on it.

**Acceptance criteria:** A test starts with Redis down, then brings it up, and the LLM limiter uses Redis within N seconds without a restart. The degraded state raises an alarm.

---

### APP-05 — Sync Redis calls block the asyncio event loop 🟡 (new in v2)

**Where:**
- `backend/app/limiter.py:145-157`: the async dependency calls the **sync** redis client (2 s socket timeout).
- slowapi's decorator wrappers on the async login/register/google/refresh/logout routes run sync storage calls on the event loop.
- `SlowAPIMiddleware` evaluates **no** limits on undecorated routes (there are no `default_limits`). It only touches Redis through `_storage.check()` while the storage is marked dead.

> v3 correction: the LLM `enforce` call is **already** offloaded (`routers/llm.py:55`), and so are the cleanup-lock calls (`main.py:85,120`). Only the slowapi paths block. A worse blocking call is Google token verification (AUTH-01).

**Problem:** With a single uvicorn process (TF-03), a slow Redis stalls **every** in-flight request on the task.

**Fix:**
- slowapi 0.1.9 **has no async storage support**. Use `limits.aio` strategies with `async+redis://…` (or `async+rediss://`) directly inside `rate_limit()`, and replace the slowapi decorators with those dependencies. Alternatively, wrap the sync calls in `await asyncio.to_thread(...)`.
- Then remove `SlowAPIMiddleware` and slowapi.
- Give `to_thread` work its own bounded executors. The default pool, min(32, cpu+4), is shared today by boto3, bcrypt (AUTH-04), Gemini (JOB-04) and the LLM limiter, so one slow dependency starves the others.

**Acceptance criteria:** A latency-injected Redis (500 ms) does not raise p99 latency of non-limited endpoints.

---

### APP-06 — Worker has no graceful shutdown 🟡 (new in v2)

**Where:** `backend/worker.py` has no SIGTERM handler. The worker task definition has no `stopTimeout` (default 30 s; the Fargate maximum is 120 s).

**Problem:** On every scale-in and deploy, up to `WORKER_CONCURRENCY` (5) in-flight jobs are abandoned. They're re-claimed after about 5 minutes, and the LLM calls are paid for twice.

**Fix:**
- Handle SIGTERM: stop claiming new jobs, finish or release the in-flight ones, then exit.
- Release **only** jobs this worker still holds (fenced by `claim_token`, see JOB-01), and don't count the release as an attempt.
- Close the Mongo client and call `aclose_clients()` on exit; neither happens today.
- Set `stopTimeout = 120` (the Fargate maximum) on the worker container.
- Make the scale-in step policy conservative (it already is).
- Add a worker container `healthCheck`: only the API has one (`ecs.tf:107`). Use a heartbeat file touched by each slot loop, so a wedged worker is replaced.

**Acceptance criteria:**
- Stopping a busy worker leaves no stale claims and causes no duplicate LLM calls.
- A worker whose slots are wedged is replaced by ECS.

---

### APP-07 — No upload size cap; orphaned objects never deleted 🟡 (new in v2)

**Where:** `backend/app/routers/children.py:557`, `users.py:551` (presigned **PUT**), `infra-live-backend/terraform/s3.tf` (lifecycle has no expiry of orphans).

**Problem:**
- A presigned PUT can't limit size, so a client can upload up to 5 GB per object.
- Every presign mints a new key, and replaced photos are never deleted, so storage grows forever (including children's data after "replace").

Today both presigns are **PUT**, with a 300 s expiry and a signed `ContentType` (`children.py:557-561`, `users.py:550-555`).

**Fix:**
1. Switch to a **presigned POST** with `content-length-range` (e.g. ≤ 10 MB) and conditions pinning the exact `key` and `Content-Type` (`eq`). Supporting changes:
   - S3 CORS allows only `PUT, GET` today (`infra-live-backend/terraform/s3.tf:12`), so add `POST`.
   - The web and mobile clients must switch to multipart-form POST.
2. Delete the previous object when a photo is replaced:
   - The task role has **no `s3:DeleteObject`** on uploads (`infra-live-backend/terraform/iam.tf:250`), so add it, scoped to `uploads/*`.
   - Deleting needs the old **key**, so do EDGE-05's key-only storage first.
   - The `photos` map is replaced **wholesale** on PATCH (`users.py:469-471`), so diff old against new to find removed entries.
3. Run a periodic orphan sweep: delete keys not referenced in Mongo and older than 24 h. Presign at 20/min mints keys that may never be used.
4. Delete the `uploads/{loc}/{child_id}/` prefix on child purge and account deletion (PRIV-02).

**Acceptance criteria:**
- An 11 MB upload is rejected by S3.
- Replacing a photo, or removing it from the plan map, deletes the old object.
- Orphans older than 24 h are swept.

---

### APP-08 — Any HTTPS URL accepted as a child's photo 🟡 (new in v2)

**Where:** `backend/app/schemas/children.py:126-130,194` (checks HTTPS only), combined with the CSP `img-src https:` (`infra-live-edge/terraform/response_headers.tf:88-89`).

**Problem:**
- A user can set a child's `avatar_url` to any external image, which allows tracking pixels or inappropriate content, rendered in the family's UI.
- v3: `NinetyDayPlanPatch.photos` (`schemas/ninety_day_plan.py:76`) has **no URL validation at all**: `http:`, `data:` and external hosts are all accepted.

**Fix:**
- Accept only `https://{UPLOADS_CDN_DOMAIN}/uploads/{location}/{child_id}/…` in both schemas, or store only the key (pairs with EDGE-05).
- Tighten CSP `img-src` to `'self' data: blob:` (see L4).

**Acceptance criteria:** `PATCH /children/{id}` and `PATCH /user/ninety-day-plan` with an external, `http:` or `data:` URL → 422.

---

### APP-09 — No request-body size limit; uploads spooled before auth 🟠 (new in v3)

**Where:** `backend/app/routers/audio.py:45,60`, `backend/app/main.py` (no body-size middleware).

**Problem:**
- FastAPI parses the multipart body (Starlette spools it to disk) **before** resolving dependencies. So `rate_limit`, `get_current_parent` and the 10 MB check only run **after the entire upload has arrived**.
- An unauthenticated multi-GB upload fills Fargate ephemeral storage and ties up the single event loop. Large JSON bodies are parsed into memory the same way.
- WAF can't help here, because it only inspects the first 16–64 KB (WAF-01).

**Fix:**
- A pure ASGI middleware, added first, that:
  - rejects `Content-Length` > 11 MB on `/api/v1/audio/transcribe` and > 256 KB elsewhere with **413**;
  - counts streamed bytes for chunked bodies and aborts past the limit.
- Optionally run auth before reading the body for audio: parse the JWT from the header in the middleware.

**Acceptance criteria:**
- A 50 MB upload gets 413 with nothing written to disk.
- A chunked oversize body gets 413.
- An unauthenticated oversize upload never reaches the route.

---

### APP-10 — Child documents can grow without bound 🟠 (new in v3)

**Where:** `backend/app/schemas/children.py:111-119,148-158,180-187,216-226`, `children.py:334` (`$addToSet` on `visited_tabs`).

**Problem:**
- The 64 KB check covers only `__pydantic_extra__`. The declared free-text fields (`personality`, `strengths`, `hobbies`, `thinking_pattern`, …) have **no size limit**.
- Each PATCH can add another 64 KB of **new** extra keys, so a document grows toward MongoDB's 16 MB limit. Past that, every write to the child fails.
- `visited_tabs` grows without bound.
- Extras can set server-relevant fields such as `active_jobs` and `pending_personality_vm`.

**Fix:**
- Size-check the whole `model_dump()` (e.g. ≤ 64 KB per request).
- Add `max_length` to every str/list field; cap `visited_tabs` at about 20 entries × 50 chars.
- Cap the **number** of extra keys, and reject reserved names (server-owned fields). `_CHILD_SYSTEM_FIELDS` (`children.py:70`) already strips some reserved names. Add `active_jobs` and `pending_personality_vm`, and turn the silent strip into a 422 to meet the acceptance criterion.
- Guard the stored size in the update (`$expr` with `$bsonSize` ≤ e.g. 256 KB).

**Acceptance criteria:**
- A 1 MB `personality` gets 422.
- 300 PATCHes with new keys can't push a document past the cap.
- Setting `active_jobs` via PATCH gets 422.

---

### APP-11 — Misc backend hygiene 🟢 (new in v3)

| # | Where | Issue | Fix |
|---|-------|-------|-----|
| a | `backend/app/main.py:282` | `/api/health` publicly exposes branch and commit | Return only `{"status":"ok"}` publicly; put build info behind auth or on an internal path |
| b | slowapi config | Fixed-window limits allow a 2× burst at window edges | Use `moving-window` (or a sliding window in Lua, as the LLM limiter already does) |
| c | `requirements.txt` | `limits` package not pinned while `_hit` depends on slowapi private attributes | `slowapi==0.1.9` is already pinned; pin `limits` (5.8.0 installed, transitive), plus a test that would fail if those internals move |
| d | Google auth path | Errors logged with `exc_info=True` (token fragments and stack in logs) | Log the error **class only**. google-auth messages can contain the token itself (e.g. "Wrong number of segments in token: …"), and `google_auth.py:41-43` already logs the message |
| e | `backend/app/routers/jobs.py:84,229` | In-process `asyncio.Lock` used to close a TOCTOU window, which does nothing across tasks | See JOB-06 |
| f | `backend/app/routers/downloads.py:62-69` | `/downloads/apk` lists every APK on every request; the list grows forever with no lifecycle rule | Read a "latest" pointer object or SSM parameter; add a lifecycle rule |
| g | Motor | Motor is deprecated in favour of PyMongo's async API | Plan the migration (DB-02) |

---

## Backend application (v3)

> Findings from the full backend code review. These are **application** changes, but several block the infra plan:
> - DB-01 Stage 2 blocks EDGE-01.
> - DB-01 Stage 1 (M10/M20) caps TF-03's capacity.
> - JOB-01 blocks TF-03's Spot and concurrency changes.
> - PRIV-02 interacts with EDGE-05 and APP-07.

**Backend strengths confirmed (keep these):**
- Every child/user query is scoped by `user_id` + `location`, with IDOR tests (`test_children.py:242`, `test_users.py:217`).
- Jobs are scoped `{location, job_id, user_id}` (`jobs.py:293`).
- `Cache-Control: no-store` is set on every API response except health (`main.py:223-224`). Gap: unhandled-500 responses, which come from `ServerErrorMiddleware` outside the http middleware.
- The global error handler returns a generic 500 with no stack trace (`main.py:206-209`), and CORS rejects `*`.
- The APK download is a parent-only presigned GET with a 5-minute expiry.
- Data is pinned per user `location` (`deps.py:61`), and upload keys lead with `location`, which is consistent with edge routing. If a location is ever remapped to another region, its existing S3 objects stay stranded in the old region's bucket; plan a copy job for that.

### DB-01 — M0 → M10/M20 (ap-south-1) now → M30+ Global Cluster later 🔴

**Where:** `GLOBAL_ROUTING_MONGO.md:13-16`, `GLOBAL_ROUTING_MONGO_ATLAS.md`, `docs/infra-architecture-multi-region.md` (Phase 0 "not started").

**Problem (today):**
- All prod regions use **one MongoDB Atlas M0 (free tier) cluster in ap-south-1**. M0 has:
  - no SLA, no cloud backups and no point-in-time recovery;
  - throttled operations;
  - a **500-connection** cap;
  - restricted features.
- Every request from eu-west-1 or us-east-1 crosses regions, about 120–250 ms per round trip.
- The Atlas runbook's Step 0 isn't done:
  - the unique indexes at `database.py:26` (`users (location, email)`) and `:56` (`growth_areas (location, _id)`) must become **non-unique** or be redesigned, because a sharded collection's unique index must be prefixed by its **full shard key**;
  - worker updates still lack `location` in their filters (`worker.py:168` etc.).

**Plan (v4 — matches the agreed DB roadmap):**

| Stage | Cluster | Region(s) | What it gives | What it does **not** give |
|-------|---------|-----------|---------------|---------------------------|
| **0 (today)** | M0 free tier | ap-south-1 | — | Backups, SLA, connections, production suitability |
| **1 (near term)** | **M10 or M20 dedicated replica set** (3 nodes across 3 AZs) | **ap-south-1 only** | SLA; dedicated (non-throttled) resources; **Cloud Backup + continuous PITR**; private networking (peering/PrivateLink); compute auto-scaling; higher connection limits | Survival of an ap-south-1 outage; low latency for eu-west-1/us-east-1 backends; data residency; sharding (needs M30+); high throughput (M10/M20 are low-vCPU tiers) |
| **2 (future)** | **M30+ Global Cluster** (GEOSHARDED, one zone per backend region) | ap-south-1 + eu-west-1 + us-east-1 | Region-local reads/writes per location; residency; regional failure isolation | — |

**Fix — Stage 1 (now):**
1. Create the **M10 or M20** cluster in ap-south-1. Choose M20 if a load test (or the projected user count) shows M10 CPU or RAM saturating; the working set should fit in RAM.
2. Enable **compute auto-scaling** with a floor of M10/M20 and a ceiling of **M30**, so **sustained** growth scales the tier. Auto-scaling reacts over tens of minutes with a rolling resize, so it doesn't absorb spikes. M30's connection limit equals M20's (about 3,000), so the M30 ceiling adds CPU and RAM but no connection headroom. Enable storage auto-scaling.
3. Enable **Cloud Backup with continuous PITR**, and set **snapshot distribution (copy) to a second region** (e.g. eu-west-1), so backups survive an ap-south-1 outage. Do a test restore and record the RTO.
4. **Private connectivity** (see DEC-02):
   - ap-south-1: **PrivateLink** (or VPC peering) from the backend VPC.
   - eu-west-1/us-east-1 (**only if DEC-01 = B**): cross-region VPC peering or a Transit Gateway path. This **requires NET-01** (unique CIDRs) first.
   - Set the Atlas project's **AWS CIDR for ap-south-1 before creating the Stage 1 cluster**; it can't be changed once a cluster exists (see DEC-02).
   - Until then, use the public endpoint with the IP allowlist and fix DR-02's NAT-IP churn.
5. Use **database users per service** (`api`, `worker`, `migrations`) with least-privilege roles, credentials in Secrets Manager (a `MONGODB_URI` per service), and TLS required.
6. Set the **connection budget** for the chosen tier (DB-02) and cap ECS max capacity to match (TF-03).
7. **Still do runbook Step 0 now** (unique-index redesign; `location` in every filter). It keeps the data shard-ready, so Stage 2 is a re-shard, not a rewrite.
   - ⚠️ Prerequisite: drop `location_1_email_1` and `growth_areas.location_1__id_1` **before** deploying the new `init_indexes()`. Otherwise it hits an index-options conflict and the API won't start (see DB-03).
8. Migrate the data from M0, preferably with Atlas's **in-place tier upgrade** (M0 → M10/M20; short downtime; check whether the connection string changes). Or use `mongodump`/`mongorestore` in a maintenance window. Whether live migration accepts an M0 source is *uncertain*. Update `MONGODB_URI` in Secrets Manager (and in all regions), then restart tasks.

**Fix — Stage 2 (later):**
1. Move to an **M30+ Global Cluster** with one zone per backend region.
2. Decide the primary shard's zone (it holds unsharded collections such as the `email_index`) and whether zones get electable nodes in a second region (multi-region zones).
3. Then implement EDGE-01, and revisit DEC-01, PRIV-03 residency and JOB-08.

**Acceptance criteria:**
- **Stage 1:**
  - The prod cluster is M10/M20 with auto-scaling up to M30.
  - Continuous PITR is on, snapshots are copied to a second region, and a test restore has been documented.
  - Private connectivity from ap-south-1 is in use.
  - p95 Mongo latency from ap-south-1 tasks is < 10 ms.
  - Peak connections at maximum ECS scale stay ≤ 70% of the tier limit.
  - Per-service DB users (`api`, `worker`, `migrations`) exist, and each service uses its own `MONGODB_URI`.
  - Runbook Step 0 is done: unique indexes are compatible with the shard key, and worker filters include `location`.
  - Atlas termination protection is on; the M0 cluster is decommissioned after the migration.
- **Stage 2:** each region's p95 Mongo latency is < 10 ms for its own locations.

---

### DEC-01 — Multi-region compute while the DB is single-region 🟠 (decision, new in v4)

**Context:** The edge routes users to eu-west-1/us-east-1 backends by location, but in Stage 1 every DB round trip from those regions goes to ap-south-1 (about 120–250 ms each). An API request typically makes several Mongo calls: auth/user lookup, the child lookup, then the read or write. So a European user served from eu-west-1 can be **slower** than if served directly from ap-south-1. Their data also physically lives in India either way.

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **A. Run backends in ap-south-1 only until Stage 2** (edge routes all locations to ap-south-1; other regions stay provisioned-but-off, or aren't deployed in prod) | Lowest DB latency per request; simpler JWT keys, rate limits, deploys and alarms; one connection budget; cheaper | Higher user↔API latency for distant users (one round trip, partly mitigated by CloudFront's backbone); no compute failover (but the DB is single-region anyway) |
| **B. Keep multi-region compute** | Ready for Stage 2; regional compute isolation | Several cross-region DB round trips per request; needs DEC-02 cross-region private networking + NET-01; triples the connection footprint against an M10/M20 cap; more operational surface |

**Recommendation:** **Option A** for prod until the Global Cluster, then switch the routing map back. Keep the multi-region Terraform and pipelines exercised in dev/stg so Stage 2 is just a config change. If you choose B, measure the p95 API latency from each region, and accept it explicitly. Under A, **don't deploy** the eu-west-1/us-east-1 prod backend stacks: "provisioned-but-off" still pays for NAT, ALB and Redis.

⚠️ **Pitfalls (Option A):**
- `shared/routing.json` is **one file for all environments**. Prod can't route everything to ap-south-1 while dev/stg stay multi-region unless routing becomes per-environment (e.g. `shared/routing.<env>.json`, or an env override applied by `scripts/sync-routing.mjs`).
- Remapping changes `REGION_TO_LOCATIONS`. A region left with no locations makes its workers raise `ValueError` at startup (`backend/app/routing.py:44-50`), so don't run backends there.
- `WORKER_SCOPE_TO_REGION` and AUTH-06's region-scoped cleanup follow the mapping, so ap-south-1 must cover every location. Otherwise eu/us jobs and sessions are never processed.

**Acceptance criteria:**
- The decision is recorded in `docs/infra-architecture-multi-region.md`, and the routing configuration matches it.
- If A: prod `backend_regions = ["ap-south-1"]`, prod routing maps every location to ap-south-1, and dev/stg routing is unchanged.

---

### DEC-02 — Private connectivity from backends to the ap-south-1 DB 🟠 (decision, new in v4)

**Context:** Atlas private endpoints (PrivateLink) are regional, created in the cluster's region. A single-region cluster in ap-south-1 can be reached privately from **ap-south-1** with PrivateLink or VPC peering. The other regions need one of:

| Option | Notes |
|--------|-------|
| **Atlas cross-region VPC peering** (Atlas supports inter-region peering on AWS) | Simple, but **requires a unique, non-overlapping CIDR** per backend VPC and for the Atlas CIDR. Today every prod region is `10.22.0.0/16`, so NET-01 is required |
| **Transit Gateway / inter-region VPC peering into the ap-south-1 VPC + PrivateLink** | Also requires unique CIDRs (NET-01); more moving parts |
| **Public endpoint + IP allowlist (TLS + SCRAM)** | Works today, but has to track NAT EIPs. These churn on re-create (DR-02), so they need to be made static first |

**Recommendation:**
- If DEC-01 = A: PrivateLink in ap-south-1 only.
- If DEC-01 = B: NET-01 first, then Atlas cross-region peering.
- Either way, remove broad `0.0.0.0/0` allowlist entries, if any.

**Acceptance criteria:** No backend reaches Atlas over the public internet, or there is a documented, time-boxed exception with static EIPs.

---

### DB-02 — Mongo poll load, non-indexed claim, client defaults 🟠

**Where:** `backend/worker.py:76,110-141,546`, `backend/app/main.py:131`, `backend/app/database.py:103`.

**Problems:**
- **Polling:** every idle slot polls every 2 s with no backoff or jitter (`worker.py:546`). At maximum scale that's 50 tasks × 5 slots ÷ 2 s ≈ **125 findAndModify/s per region** (about 375/s across three regions). It's also sustained, because scale-in removes only one task per 5 minutes.
- **Claim query:** `$or` with a `retry_after` range, plus `location $in`, plus a sort on `created_at` (`:110-141`) can't take its sort order from the index (`database.py:103`). Every claim does an in-memory **SORT** over all eligible jobs, and all slots fight over the same oldest document.
- **Client defaults:** `AsyncIOMotorClient` (`worker.py:76`, `main.py:131`) runs with the defaults:
  - `maxPoolSize=100`, so the API alone could open about 200 tasks × 100 × 3 regions ≈ 60k connections (M0 allows 500; even M50 caps far below that);
  - `serverSelectionTimeoutMS=30s`;
  - no socket timeout (reads can wait forever);
  - no `appname`;
  - write concern and retry settings come only from the URI. `.env.example:11` sets `retryWrites=true&w=majority`, but verify the real URI in Secrets Manager and set these explicitly in code.

**Fix:**
1. Idle backoff of 2 → 15 s with jitter, and **one poller per task** feeding the slots (or change streams on the paid tier).
2. Claim per location with **equality**. Store an `eligible_at` field (set to `created_at`, or to `retry_after` on retry), index `(location, status, eligible_at)`, and claim with `eligible_at <= now` sorted on `eligible_at`. Run one claim query per `$or` branch (`queued`, `result_ready`) instead of a single `$or`.
3. Explicit client options:
   - `maxPoolSize` derived from the Atlas connection limit ÷ (tasks × processes);
   - `minPoolSize` small;
   - `appname="api"`/`"worker"`;
   - `serverSelectionTimeoutMS≈5000`;
   - `timeoutMS` (CSOT) or `socketTimeoutMS`;
   - `w="majority"`, `retryWrites=True`, `retryReads=True`.
4. Migrate Motor → PyMongo async API (APP-11g).
5. On a dedicated tier, the worker can use change streams to **watch** `jobs` inserts (one stream per task) and fall back to slow polling. That removes almost all idle claim traffic.

**Connection and CPU budget for DB-01 Stage 1 (v4):** M10/M20 are low-vCPU tiers. Their connection limits are roughly **1,500 (M10) and 3,000 (M20)**; check the current Atlas limits page, because they change by tier and version. Atlas connection limits apply **per node**. With primary reads and writes (the default), almost all pooled connections land on the **primary**. Each client also opens about 2 monitoring connections per member (PyMongo 4.x: one monitor plus one RTT). Include the **deploy surge** (`deployment_maximum_percent`: 200% today, 150% under TF-03):

```
primary_conns ≈ Σ_regions Σ_services (max_tasks × surge × processes × (maxPoolSize + ~2))
target        ≤ 70% of the tier's per-node limit   (M10 ≈ 1,500; M20 ≈ 3,000; M30 ≈ 3,000)
```

Example on M10 (target about 1,050), assuming DEC-01 = A, so ap-south-1 only:
- 60 API + 20 worker tasks at maximum, 1 process each, surge 1.5
- `maxPoolSize=10`: 80 × 1.5 × (10 + 2) ≈ **1,440, over budget**
- `maxPoolSize=5`: 80 × 1.5 × (5 + 2) ≈ **840, within budget**
- or choose M20.

v5 correction: v4 summed connections across all three nodes against a per-node limit and omitted the deploy surge.

With DEC-01 = B (three regions), the same per-region numbers triple. Today's prod maximums (200 API + 50 worker per region × 3) are **far** beyond any M10–M30 limit.

**Acceptance criteria:**
- `explain()` of the claim shows IXSCAN with no SORT stage.
- A load test at maximum ECS scale stays ≤ 70% of the tier's connection limit, and the tier's CPU stays < 70%.
- An idle cluster generates < 5 claim queries/s per region.
- `maxPoolSize` and the ECS maximum capacities are derived from the budget above and documented in `docs/infra-operations.md`.

---

### DB-03 — Index creation at startup in every task 🟡

**Where:** `backend/app/main.py:133` (`init_indexes()` in lifespan, unguarded). The worker never ensures indexes.

**Problem:**
- About 22 `createIndex` calls × up to 200 tasks × 3 regions run on every deploy.
- A **new** index on a large collection blocks startup until the build finishes, so the health check fails and the circuit breaker rolls back.
- An index-option conflict makes every task crash-loop.

**Fix:**
- Move index management to a **one-off migration task** in the deploy pipeline (an ECS `run-task` before the service update), or a leader-locked background task.
- At startup, only **verify** the indexes (log and alarm on missing ones) and don't fail.

**Acceptance criteria:** A deploy that adds an index to a 10M-document collection completes with no task restarts.

---

### DB-04 — Unindexed per-user deletes 🟡

**Where:** `backend/app/database.py:38-52,81-95`, `backend/app/routers/auth.py:719-722`.

**Problem:**
- `children.delete_many({user_id, location})` can't use the partial indexes, because those require `is_deleted: false`.
- `observations` and `ninety_day_plans` have no `(location, user_id)` index.
- At scale each account deletion is a collection scan.

**Fix:** Add non-partial `(location, user_id)` indexes to every per-user collection (via the DB-03 migration path).

**Acceptance criteria:** `explain()` of every delete in `delete_account` shows IXSCAN on a `(location, user_id)` index with `totalKeysExamined ≈ nReturned`. The existing `(location, _id)` index already yields an IXSCAN over the whole location, so "IXSCAN" alone proves nothing.

---

### DB-05 — Atlas failover behaviour unspecified/untested 🟡

**Where:** `backend/app/main.py:102` (`delete_many`), `update_many` call sites, `backend/worker.py:568` (startup ping → `sys.exit`).

**Problem:**
- Retryable writes cover one retry, and **multi-document** `delete_many`/`update_many` aren't retryable.
- The worker exits on a failed startup ping, so tasks crash-loop during a long election.

**Fix:**
- Document the expected behaviour per operation.
- Make worker startup retry with backoff instead of exiting.
- Wrap multi-document maintenance operations in idempotent, re-runnable loops.
- Run Atlas "Test Failover" in stg as part of the release checklist.

**Acceptance criteria:** During an Atlas test failover in stg, the API stays up (brief errors are acceptable), no job transitions are lost, and workers recover without restart loops.

---

### JOB-01 — Lease shorter than the LLM budget; no fencing → double runs 🟠

**Where:** `backend/worker.py:104` (5-minute stale threshold), `:168,196,223,245,312,375,411` (follow-up updates filter on `{"job_id": ...}` only), `:487` (docstring claims "atomic, no race").

**Problem:**
- The 5-minute lease is **shorter** than the worst-case call: 3 SDK attempts × 90 s plus backoff (APP-03). The lease is also **never renewed**.
- A job that's still running is re-claimed by a second worker, so the LLM is called twice.
- With no fencing, the slower worker **overwrites** the other's status or result, including a deadline `failed` set by `cleanup_expired_jobs`.

**Fix:**
1. At claim time, set `claim_token` (uuid4) and `claimed_by` (task ID). Every follow-up update filters on `{job_id, location, claim_token}`, and a `matched_count == 0` means "lost the lease": stop and discard the result.
2. Heartbeat `claimed_at` every ~30 s from the running slot, **or** make the lease longer than the total LLM budget (APP-03) plus margin.
3. `cleanup_expired_jobs`'s update is already atomic. When it fails a job, it must also `$unset`/rotate `claim_token`, and every worker follow-up update must filter on `{job_id, location, claim_token, status: "processing"}`. A late worker then can't overwrite the deadline `failed`.

**Acceptance criteria:**
- A test with two workers and a 6-minute fake LLM call produces exactly one provider call and one final status.
- A late result after a deadline `failed` is discarded.

---

### JOB-02 — Retries multiply LLM cost; poison jobs; no DLQ 🟠

**Where:** `backend/worker.py:132-136`, `backend/app/database.py:142` (TTL on finished jobs).

**Problems:**
- Up to 3 worker attempts × 3 SDK attempts = **9 provider calls per job**.
- A re-claimed stale job **doesn't increment `llm_attempt`**, so a poison job that crashes the worker is re-run every 5 minutes until the 30-minute deadline.
- There's no DLQ: failed jobs are deleted by the TTL after 24 h, so there's no forensic trail.

**Fix:**
- Increment the attempt counter **at claim time**.
  - ⚠️ Pitfalls:
    - `handle_llm_failure` increments it again (`worker.py:155`), so remove that second increment and update the comment at `:401-406`.
    - The shared claim also returns `result_ready` jobs, which must **not** count as LLM attempts. Use a pipeline update with `$cond`, or separate claims per status (fits DB-02 #2).
- `max_retries=0` on the SDK clients (APP-03), so retries happen only at the worker level.
- An idempotency key per job (provider request IDs or `Idempotency-Key` headers where supported).
- Keep failed jobs for 7 days, or copy them to `jobs_dead`.
- Alarm on the failure rate and on the dead count.

**Acceptance criteria:**
- A job that kills its worker fails after `max_llm_attempts` total claims.
- The total provider calls per job is ≤ `max_llm_attempts`.

---

### JOB-03 — Job path bypasses LLM cost controls 🟠

**Where:** `backend/app/routers/jobs.py:120-140` (`enqueue_job`: route limit `30/minute`; an in-flight cap of 2 per **(user, child, type)** at `:223-244`; but **no** call to `llm_rate_limiter.enforce`), `backend/app/schemas/jobs.py:168-180` (32k-char client prompt; `provider: str | None` at `:170`), `backend/app/services/llm_service.py:142,180` (no output-token cap for OpenAI/Gemini).

**Problems:**
- The hourly per-user LLM quota (`LLM_HOURLY_LIMIT`) applies only to `/llm/invoke`. Jobs, the main LLM path, bypass it.
- Prompts are **fully client-supplied**, so the backend is effectively an open LLM proxy on the company's API keys.
- `provider` is a free `str`: an unknown value raises `KeyError` in the worker and burns retries instead of returning 422, and any client can choose the most expensive provider.
- There's no `max_tokens`/`max_output_tokens` on OpenAI and Gemini.

**Fix:**
1. Call `llm_rate_limiter.enforce` at enqueue. It's sync, so use `await asyncio.to_thread(...)`, as `llm.py:55` does.
2. `provider: ProviderName | None` (enum), validated at the API.
3. Set `max_tokens`/`max_output_tokens` on every provider.
4. Build prompts **server-side** from job-type templates plus validated parameters; clients send only parameters.
5. Add per-user and global daily **spend** metrics with alarms and a budget kill-switch.

**Acceptance criteria:**
- The 201st job in an hour (prod limit 200) gets 429.
- `provider="foo"` gets 422.
- Responses are capped at the configured token limit.

---

### JOB-04 — No LLM provider fallback 🟡

**Where:** `backend/app/services/llm_service.py:105` (`resolve_provider` picks the first configured provider), `:189` (Gemini sync call via `to_thread` on the shared default pool).

**Problem:**
- A 429 or outage at OpenAI fails the job even if Anthropic is configured.
- Long Gemini calls run on the same default thread pool as the Redis limiter and boto3 calls, and starve them (see APP-05).

**Fix:**
- On retryable errors, fall back to the next provider in `PRIORITY`, with a per-provider circuit breaker.
- Use the async `google-genai` SDK (`google.generativeai` is deprecated) or a dedicated executor.

**Acceptance criteria:** A mocked OpenAI 503 leads to a successful Anthropic call. A Gemini latency spike doesn't raise the limiter's p99.

---

### JOB-05 — Job polling collides with the per-user rate limit 🟡

**Where:** `frontend/src/hooks/useJob.ts:5` (polls every 3 s, so 20 requests/min per job), `backend/app/routers/jobs.py:283` (`60/minute` per user).

**Problem:** Three or more concurrent jobs or tabs hit 429. Each poll also costs 2 Mongo reads.

**Fix:**
- A batch endpoint (`GET /jobs?ids=…`) or SSE/long-poll.
- Client backoff (1 s → 5 s).
- Exempt status polls from the general user bucket, or give them their own higher bucket.

**Acceptance criteria:** 5 concurrent jobs complete with no 429.

---

### JOB-06 — Enqueue not idempotent; in-process lock only 🟡

**Where:** `backend/app/routers/jobs.py:84,229` (an in-process `asyncio.Lock` enforces the in-flight cap).

**Problem:**
- The lock doesn't hold across 200 tasks, so the "2 in flight per type" cap is soft.
- A client retry (network blip) creates a duplicate job and a duplicate LLM spend.

**Fix:**
- Accept an `Idempotency-Key` header, with a unique index on `(location, user_id, idem_key)` and `partialFilterExpression: {idem_key: {$exists: true}}`, so jobs without a key don't collide on null. Expire old keys with a **separate single-field** TTL index (e.g. on `idem_created_at`), because TTL indexes can't be compound.
- Enforce the in-flight cap atomically with a **conditional upsert on a per-(user, child, type) counter document**. A count-then-insert transaction doesn't work: concurrent transactions have no write conflict and both commit (write skew).

**Acceptance criteria:** Two identical requests with the same key create one job. 20 parallel enqueues never exceed the cap.

---

### JOB-07 — `worker.py` untested and outside the coverage gate 🟢

**Where:** `check.sh:169` and `check.yml:116` measure `--cov=app` only; there's no `tests/test_worker.py`. The only worker test is the index-use check (`tests/test_mongo_integration.py:280`).

**Fix:**
- Write unit tests for every current transition (claim, retry, stale recovery, cleanup, failure, write-to-domain) **first**.
- Then add `--cov=worker` in both `check.sh:169` and `check.yml:116`; adding it before the tests exist fails the 99% gate immediately.
- Add the JOB-01 race tests and PRIV-02 upsert tests when those findings land.

**Acceptance criteria:** `coverage report --include=worker.py --fail-under=99` passes; a combined total over 99% isn't enough on its own.

---

### JOB-08 — Region-scoped workers have no failover 🟢

**Where:** `infra-live-backend/terraform/ecs.tf:233` (`WORKER_SCOPE_TO_REGION=true`).

**Problem:** If one region's workers are down, that region's jobs wait until the 30-minute deadline fails them, even when the database is reachable.

**Fix:** Either document this as accepted (residency-first), or add an opt-in cross-region drain mode for when the region's `RunningTaskCount` is 0 (only valid while data residency allows it). This only matters with multi-region compute (DEC-01 = B, or after DB-01 Stage 2).

**Acceptance criteria:** The behaviour is documented in `docs/infra-operations.md`.

---

### AUTH-01 — Google token verification blocks the event loop 🟠

**Where:** `backend/app/routers/auth.py:497` calls the **sync** `verify_google_token` (`backend/app/services/google_auth.py:33-38`) inside an async route.

**Problem:**
- google-auth's `Request()` creates a new session and downloads Google's certs **on every call**, with no caching and a default timeout of about 120 s.
- One slow Google response stalls **every request** on the single-process task.

**Fix:**
- Run the call with `await asyncio.to_thread(...)` (a dedicated small executor).
- Use a module-level `requests.Session`, and subclass `google.auth.transport.requests.Request` to pass `timeout=5`, since a `Session` has no default timeout.
- Cache the certs per their `Cache-Control` max-age with `cachecontrol.CacheControl(session)` (a new dependency) or your own cache. google-auth has no `CachedSession` class.
- Reset the cache between tests: `tests/test_google_auth.py:61-69` patches `_fetch_certs`.
- Keep the `aud` and `iss` checks and `email_verified`.

**Acceptance criteria:**
- Certs are fetched at most once per max-age.
- Injecting 2 s of Google latency doesn't raise p99 on other endpoints.

---

### AUTH-02 — Refresh tokens: no atomic consume, no reuse detection 🟠

**Where:** `backend/app/routers/auth.py:403-451` (`find_one` session → insert the new one → `delete_one` the old one).

**Problem:**
- Two concurrent refreshes with the same token **both succeed** and fork the session.
- A replayed, already-used refresh token just gets 401, and nothing else happens: theft of a refresh token is never detected.

**Fix:**
- Consume atomically with `find_one_and_update({"_id": jti, "user_id": uid, "location": loc, "consumed_at": None}, {"$set": {"consumed_at": now}})`. Only the winner mints new tokens. Keep the consumed session as a **tombstone** until `expires_at`. With `find_one_and_delete` the record is gone and reuse can't be detected.
- This replaces the deliberate insert-before-delete crash-retry design (`auth.py:446-451`); the grace window below covers that case.
- Add a `family_id` to sessions. On reuse of a validly signed, unexpired but already-consumed `jti`, **revoke the entire family** and log a security event.
- Allow a short grace window (e.g. 10 s) to tolerate mobile retries.

**Acceptance criteria:**
- Of two parallel refreshes, exactly one succeeds.
- Replaying an old refresh token revokes the family and emits a security log/metric.

---

### AUTH-03 — Account unlock revives pre-lock sessions; no admin audit 🟡

**Where:** `backend/app/routers/admin.py:287-290` (lock sets `tokens_revoked_at` but doesn't delete sessions), `:315-318` (unlock sets `tokens_revoked_at = None`), and the comment at `:312-314`.

**Problem:**
- A refresh token stolen **before** the lock works again after unlock.
- The comment's reasoning is wrong: tokens issued after a fresh login already have an `iat` later than the revocation time, so clearing `tokens_revoked_at` isn't needed.
- Admin actions don't log the acting admin's ID, so there is no audit trail.

**Fix:**
- On lock: `delete_many` the user's sessions.
- On unlock: leave `tokens_revoked_at` unchanged, and update `tests/test_admin.py:405-406`, which asserts `tokens_revoked_at is None` after unlock.
- Log `{admin_id, action, target_user_id, timestamp}` for every admin action (an `admin_audit` collection or structured log line).

**Acceptance criteria:**
- A refresh token issued before a lock is rejected after unlock.
- Every admin action produces an audit record.

---

### AUTH-04 — Brute force only per-IP; bcrypt cost and 72-byte truncation 🟡

**Where:** slowapi route limits (login 10/min, register and google 5/min, per IP), `backend/app/auth_utils.py` (bcrypt, default 12 rounds), `requirements.txt` (bcrypt 4.2.1).

**Problems:**
- The only protection is per-IP, which is bypassable today (APP-01) and per region (EDGE-01). There's no per-account throttle.
- bcrypt at 12 rounds costs about 250 ms of CPU per hash, on the shared default thread pool, so a login storm starves boto3 and limiter calls.
- bcrypt 4.x **silently truncates** at 72 bytes while the field allows 128 characters. bcrypt 5.x **raises** instead, so upgrading would break register and login for long passwords.

**Fix:**
- Add a per-email exponential backoff in Redis (not a hard lockout, to avoid denial-of-service against victims).
- Run bcrypt on a dedicated, bounded executor.
- Limit passwords to 72 **bytes** (validate UTF-8 length), or pre-hash with HMAC-SHA256 before bcrypt (and migrate on next login).

**Acceptance criteria:**
- 20 failed logins for one email from 20 IPs trigger backoff.
- A 100-byte password is handled consistently across bcrypt versions.

---

### AUTH-05 — Refresh token returned to web JS; cookie scope; no Origin check 🟡

**Where:** `backend/app/routers/auth.py:296,354,452,654` (`AuthTokenResponse` returns both tokens in the body for **all** clients), `backend/app/auth_utils.py:137,150` (cookies with `Domain=cookie_domain`).

**Problems:**
- Returning the refresh token in the body to web clients defeats `HttpOnly` if there is ever an XSS.
- `Domain=` cookies are sent to sibling subdomains. With `SameSite=lax`, body-less POSTs (`refresh`, `logout`) can be triggered from same-site subdomains.

**Fix:**
- Return tokens in the body **only for mobile** (e.g. an `X-Client-Type: mobile` header plus app attestation where possible). Web uses cookies only.
- Drop `Domain=` so sibling hosts don't **receive** the cookies.
  - The access cookie (`Path=/`) can use the `__Host-` prefix.
  - The refresh cookie uses `Path=/api/v1/auth/`, and `__Host-` requires `Path=/`, so it can only use `__Secure-`.
  - Dropping `Domain` doesn't stop same-site subdomain POSTs, since `SameSite=lax` is per site. The Origin check below does.
- Check the `Origin` header against `CORS_ORIGINS` on cookie-authenticated state-changing endpoints.

**Acceptance criteria:**
- A web login response body contains no refresh token.
- A cross-origin POST to `/auth/refresh` is rejected.

---

### AUTH-06 — Session-cleanup task can die silently; runs in every region 🟡

**Where:** `backend/app/main.py:68-125` (the lock `r.set` at `:85-88` is **outside** the `try`).

**Problems:**
- A single Redis error kills the background cleanup task permanently, and the exception is **never logged**: `gather(..., return_exceptions=True)` at `main.py:141` swallows it.
- `sessions` has no TTL index, so expired sessions only go away through this task.
- Each region's lock lives in its own Redis, so **every region** deletes sessions across **all** locations (`_ALL_LOCATIONS`): N× redundant work and cross-zone deletes once on a Global Cluster.

**Fix:**
- Wrap the whole cycle in `try/except`, with logging and a metric.
- Add a TTL index on `sessions.expires_at` (and keep the task only for extra hygiene, or remove it).
- Scope deletes to `locations_for_region(settings.aws_region)`, which is derived from `shared/routing.json`; under DEC-01 = A, ap-south-1 covers every location. It returns `None` locally and raises for unmapped regions, so fall back to `_ALL_LOCATIONS`.
- Adding the TTL index contradicts the comment at `database.py:29-31`, so update it. Single-field TTL indexes are fine on sharded collections.

**Acceptance criteria:**
- A Redis error during one cycle doesn't stop later cycles.
- Expired sessions disappear via TTL even with the task disabled.

---

### AUTH-07 — No fail-fast config validation for stg/prod 🟡

**Where:** `backend/app/settings.py:240-248` (only warnings).

**Problem:** With `APP_ENV=prod`, the app starts happily with:
- a localhost CORS default;
- a missing `REDIS_URL` (silent in-memory limits);
- `BEHIND_PROXY=false`;
- `COOKIE_SECURE=false`.

**Fix:** A pydantic `model_validator`, **scoped to the API process**, that **raises** for `stg`/`prod`. The worker shares `Settings` with `APP_ENV=prod` but has no CORS/COOKIE/BEHIND_PROXY env (`ecs.tf:227-234`), so an unscoped validator would crash every worker. The validator should raise when required settings are missing or unsafe: CORS origins, `REDIS_URL`, `BEHIND_PROXY`, `COOKIE_SECURE`, distinct JWT keys, and `TRUSTED_PROXY_HOPS` (APP-01).

**Acceptance criteria:** Starting with `APP_ENV=prod` and `COOKIE_SECURE=false` fails at boot with a clear error.

---

### PRIV-01 — Plaintext passwords and child PII written to logs 🟠

**Where:** `backend/app/main.py:194` (`log.warning("422 validation_error … errors=%s", exc.errors())`) and `:198` (the response echoes `exc.errors()`).

**Problem:**
- Pydantic error dicts include the `input` value. A register request whose password fails `min_length` or the complexity check (`auth.py:79,96-105`) writes the **plaintext password** to CloudWatch.
- Any 422 on child/personality data logs that data the same way.
- The response echoes it back.

**Fix:**
- Log only `loc` and `type` per error.
- Build `safe = [{k: v for k, v in e.items() if k != "input"} for e in exc.errors()]`, log only `loc` and `type`, and return `jsonable_encoder(safe)` (keep the `ctx` handling).
- ⚠️ Pitfall: FastAPI's `RequestValidationError.errors()` takes **no arguments**. The `include_input=` kwarg belongs to pydantic's `ValidationError.errors()`; passing it here raises `TypeError` and turns every 422 into a 500. (v5 correction.)
- Purge existing CloudWatch log data that may contain passwords (lower retention, or delete the affected streams), and consider forcing a password reset for affected users.

**Acceptance criteria:** A test shows a weak-password register 422 contains no password in captured logs or in the response body.

---

### PRIV-02 — Deletion incomplete; worker recreates data; no 30-day purge 🟠

**Where:** `backend/app/routers/auth.py:678-742` (`delete_account`), `children.py:466-494` (soft-delete; the docstring at `:473` promises "purged by a scheduled hard-delete job"), `backend/worker.py:274-302` (`write_to_domain` with `upsert=True` at `:302`), `backend/app/database.py:89-95` (a purge index exists, but **no purge job exists anywhere**), `docs/api.md:31`.

**Problems:**
- `delete_account` leaves `jobs` in place. Jobs contain `payload.prompt` with the child's data (`jobs.py:196`), and their TTL applies only to completed/failed jobs (`database.py:142-146`).
- **S3 objects** (photos) are never deleted, and the task role lacks `s3:DeleteObject` (APP-07).
- The worker's `write_to_domain` uses `upsert=True`, so an in-flight job **recreates** growth_areas, observations, ninety_day_plans or a `children` document after the account or child was deleted.
- The promised 30-day hard-delete of soft-deleted children **doesn't exist**.
- This conflicts with GDPR Art. 17 and COPPA deletion obligations.

**Fix:**
1. `delete_account`:
   - `is_being_deleted` is already set first (`auth.py:707-711`); next, cancel/delete the user's jobs (all statuses);
   - then delete every per-user collection and the S3 prefixes `uploads/{loc}/{child_id}/` for each child.
   - Make it idempotent and re-runnable.
2. Worker: `upsert=False` for `children`. For the other collections, **check the owner** (exists, not `is_being_deleted`) **before** writing, and drop the result otherwise. A filter on `growth_areas` can't reference `users`, so also have the deletion sweeper (#4) re-run after in-flight leases expire.
3. Implement the **30-day purge** as a scheduled task (ECS scheduled task or EventBridge + Lambda) covering the child's documents, jobs and S3 objects. Use the existing purge index.
4. Add a sweeper that re-runs deletion for users stuck in `is_being_deleted`.
5. Document retention per data type, including CloudWatch logs (PRIV-01) and LLM provider retention (PRIV-03).

**Acceptance criteria:**
- Deleting an account while a job is processing leaves **zero** documents or S3 objects for that user afterwards.
- A soft-deleted child is fully gone 30 days later.
- Tests cover both.

---

### PRIV-03 — Children's voice/PII sent to LLM providers out of region 🟡

**Where:** `backend/app/routers/audio.py:83-87` (audio → OpenAI Whisper), `backend/app/routers/llm.py`, the job prompts (all providers are global endpoints).

**Problem:**
- Children's voice recordings and personality data leave the user's data region, whatever their `location`. That conflicts with the per-location residency design (GDPR Chapter V transfers, COPPA).
- `/llm/invoke` and jobs accept client-built prompts, so any PII can be sent.

**Fix:**
- Sign DPAs with **zero-data-retention** agreements with each provider.
- Prefer in-region endpoints where available (e.g. Azure OpenAI or Amazon Bedrock in the user's region), with a provider choice per location.
- **v4: database residency.** Until DB-01 Stage 2, **all users' data (including EU/US children) is stored in ap-south-1 (India)**. Document the transfer basis (e.g. EU SCCs plus a transfer impact assessment) and update the privacy policy. Correct `GLOBAL_ROUTING_MONGO*.md` and `docs/infra-architecture-multi-region.md` wherever they imply per-location residency is in effect.
- Build prompts server-side (JOB-03) with minimised PII.
- Document a **residency matrix** (data type × location × processor).

**Acceptance criteria:**
- A residency matrix is documented and approved.
- EU users' requests are processed by an in-region or contractually covered provider.
- The ap-south-1 database transfer basis (SCCs + TIA) is documented and the privacy policy updated.
- `GLOBAL_ROUTING_MONGO*.md` and `docs/infra-architecture-multi-region.md` no longer claim per-location residency.

---

### PRIV-04 — Soft-deleted child's data still readable 🟢

**Where:** `backend/app/routers/users.py:180-187,298,434`. These GETs skip `_require_child`.

**Fix:** Gate on `is_deleted: false` (call `_require_child`), or cascade the soft-delete to the child's related documents.

**Acceptance criteria:** GETs of observations, growth areas and the ninety-day plan for a soft-deleted child return 404.

---

### SEC-10 — API task role can overwrite the public APK 🟠

**Where:** `infra-live-backend/terraform/iam.tf:78` (`ecs_task_s3`: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on the whole **assets** bucket).

**Problem:**
- The API only needs to list and read APKs (`downloads.py`).
- A compromised API task can replace `app-assets/applications/*.apk`, which CloudFront serves publicly (MOB-01). Combined with the debug signing key, that's a malware-distribution path.
- The API-side auth on `/downloads/apk` is also moot, because the same file is public via `/app-assets/*`.

**Fix:**
- Reduce the policy to `s3:ListBucket` (with an `s3:prefix` condition `app-assets/applications/android/`) and `s3:GetObject` on `app-assets/applications/android/*`.
- Move uploads of the mobile builds to the CI role only.

**Acceptance criteria:** `PutObject` to the assets bucket from the task role is denied.

---

### OBS-04 — No app logging config, request IDs or structured logs 🟡

**Where:** `backend/app/main.py` (no `logging.basicConfig`/dictConfig for the API), `backend/CLAUDE.md`. The worker already configures plain-text INFO logging (`worker.py:36-39`).

**Problem:**
- `log.info` lines (`auth.login.ok`, `session_cleanup`, `llm_rate_limiter: Redis connected`, …) are probably **dropped**, because the root logger defaults to WARNING.
- `X-Request-Id` is never logged.
- Logs are plain text, so CloudWatch Logs Insights queries and correlation with ALB, CloudFront and X-Ray are hard.

**Fix:**
- JSON logging (e.g. `python-json-logger` or `structlog`) configured at startup, for API and worker.
- `request_id_middleware` (`main.py:215-220`) already reads/creates `X-Request-Id` and returns it. **Extend** it (e.g. with a `contextvars` log filter) so the ID appears in every log line and is propagated to worker jobs.
- Log levels set per environment.
- Never log tokens or PII (PRIV-01).

**Acceptance criteria:** An API log line is JSON with `request_id`, `user_id` (hashed), `path`, `status` and `latency_ms`; info-level events appear in CloudWatch.

---

## Mobile

### MOB-01 — Prod mobile builds debug-signed and publicly downloadable 🟠 (new in v2)

**Where:**
- `frontend-app/android/app/build.gradle:115-130`: `release` uses `signingConfigs.debug`, the committed `debug.keystore` with password `android`.
- `build.gradle:91`: `versionCode 1` is hard-coded.
- `.github/workflows/build-android-apk.yml:185` and `build-ios-ipa.yml:349` copy the builds to `s3://<assets>/app-assets/applications/...`, which CloudFront serves **publicly** via `/app-assets/*` (`infra-live-edge/terraform/cloudfront.tf:137`).
- iOS uses the `ad-hoc` export method (`build-ios-ipa.yml:281`), which is capped at 100 registered devices.

**Problems:**
- Anyone can download the prod builds.
- Anyone can sign a tampered APK with the same key, so users can't tell it from the real one.
- Updates can't be published properly (`versionCode 1`).
- iOS ad-hoc distribution doesn't scale.

**Fix:**
1. **Android:** generate a real upload keystore and store it as base64 in GitHub secrets with its passwords. Write it to `$RUNNER_TEMP` and delete it after the build. Wire `signingConfigs.release` from env vars. Derive `versionCode` from `github.run_number` or a tag. Distribute via **Play Console** (internal testing → production), using Play App Signing. Build with `bundleRelease` (an **.aab**), since Play requires App Bundles for new apps.
2. **iOS:** distribute via **TestFlight/App Store** (`app-store` export method + App Store Connect API key).
3. Remove prod builds from the public `/app-assets/` path. If side-loading is needed for dev, use a private bucket with presigned URLs. Update `backend/app/routers/downloads.py:30` (`_ANDROID_APK_PREFIX`) and SEC-10's prefix condition together.
4. Delete the decoded p12/profile files in the iOS cleanup step (`build-ios-ipa.yml:309-315` only deletes the keychain). This is low risk on hosted runners, but tidy.

**Acceptance criteria:**
- The release APK is signed with a non-debug key (`apksigner verify --print-certs`).
- No `.apk`/`.ipa` is reachable via CloudFront.
- `versionCode` increments per build.

---

## Disaster recovery & destroy safety

### DR-01 — Prod can be destroyed quickly and unrecoverably 🔴

**Where:**
- `infra-live-backend/terraform/secrets.tf:44`: `recovery_window_in_days = 0` (all environments including prod).
- `infra-live-scheduler/terraform/secrets.tf:25`: `recovery_window_in_days = 0`.
- `infra-live-backend/terraform/ecr.tf:17`: `force_delete = true`. Prod images are lost on destroy.
- `infra-live-backend/terraform/alb.tf:14`: deletion protection is off (checkov `CKV_AWS_150` skipped).
- There is no `prevent_destroy` anywhere, and CloudFront, WAF and Route 53 are unprotected.
- `destroy`/`plan-destroy` are offered for prod in every Terraform workflow and in `terraform-live-all.yml:197-238`, with no confirmation input.

**Existing protection (credit):** the scheduler never targets prod (`scheduler.tf:109-112`, `variables.tf:67-69`).

**Fix:**
1. Make protection settings environment-aware:
   - `recovery_window_in_days = var.environment == "prod" ? 30 : 0`
   - `force_delete = var.environment != "prod"`
   - `enable_deletion_protection = var.environment == "prod"` on the ALB
2. `prevent_destroy` can't be conditional. For prod-critical resources (ECR, the secret, the CloudFront distribution, Route 53 records, ElastiCache), either use a prod-only wrapper module or rely on (1) + (3).
3. Block prod destroy at the **environment** level, not only in YAML. Create a separate `prod-destroy` GitHub Environment (with required reviewers and branch rule `main`), used only by the destroy path, and require an input `confirm = <environment name>`.
   - Put the guard in a **separate first job without `environment:`**, so it runs before any job receives prod secrets.
   - Put it in each **called** workflow, not only in `terraform-live-all`.
   - The `prod-destroy` environment needs its own copy of every prod secret, and an OIDC trust entry for `environment:prod-destroy`.
   - Select it with an expression, e.g. `environment: ${{ inputs.action == 'destroy' && format('{0}-destroy', inputs.environment) || inputs.environment }}`.
   - `terraform-live-all` must pass `confirm` through to the called workflows.
4. Document DR: ECR re-population (promotion from stg, or ECR replication), the Secrets Manager source of truth, and RTO/RPO targets.
5. **Database backups are an action item, not a documentation task (v3).** The current M0 tier has **no cloud backup and no point-in-time recovery**, so today there is **no backup of any user or children's data**. With DB-01 Stage 1 (M10/M20, v4):
   - enable **continuous Cloud Backup (PITR)**;
   - copy snapshots to a **second region**;
   - test a restore;
   - document the **"ap-south-1 is down"** scenario. While the DB is single-region, that is a **full outage**: recovery means restoring the latest snapshot/PITR into a new cluster in another region, re-pointing `MONGODB_URI`, and re-routing the edge. Record the resulting RTO/RPO, and decide whether that's acceptable until DB-01 Stage 2.
   - Enable Atlas **termination protection** on the M10/M20 cluster.

⚠️ **Pitfall:** `workflow_dispatch` runs the workflow file **from the selected branch**, so a guard step alone can be deleted on a feature branch. Environment rules (CI-01) and the OIDC trust (SEC-04) are the real controls.

**Acceptance criteria:**
- Running destroy on prod without the `prod-destroy` approval and `confirm` input is refused by the guard job before any AWS call.
- If forced, a prod `apply -destroy` fails on ALB deletion protection, and on the ECR repo while images exist (`force_delete = false`). Neither affects `plan`; only `prevent_destroy` fails at plan time.
- The prod secret has a 30-day recovery window.
- Atlas: continuous PITR is enabled, termination protection is on, and a test restore into another region is documented with measured RTO/RPO.

---

### DR-02 — Account-wide services live in the stg stack; NAT EIPs churn 🟡 (new in v2)

**Where:**
- `docs/environments.md:187` (the shared account's GuardDuty is owned by stg), and `stg.tfvars:62-63` + `security.tf:34` (stg's trail is the shared account's only CloudTrail; `enable_cloudtrail = false` in dev/sbx).
- `infra-live-backend/terraform/vpc.tf` (`aws_eip.nat`).
- `docs/environments.md:256` (MongoDB Atlas IP allowlist).

**Problems:**
- If stg's nightly destroy schedule is enabled, account-level detection and audit go down every night.
- NAT Elastic IPs are recreated on each scheduled re-create, which breaks the Atlas IP allowlist until someone updates it.

**Fix:**
- Move GuardDuty, CloudTrail, and (optionally) the NAT EIPs into a long-lived `infra-account-baseline` stack that's never scheduled for destroy. Reference the EIPs by allocation ID from the backend stack.
- Better for Atlas: private connectivity per DEC-02, which also removes NAT data costs for DB traffic.
  - With the Stage 1 cluster in ap-south-1, **PrivateLink is only native in ap-south-1**.
  - Other regions need cross-region peering (which needs NET-01) or the static-EIP allowlist above.

**Acceptance criteria:** A nightly destroy/re-create of stg leaves GuardDuty, CloudTrail and the Atlas connectivity unchanged.

---

## Observability

### OBS-01 — Alerting goes nowhere useful; edge/Redis not monitored 🟠

**Where:**
- `infra-live-backend/terraform/cloudwatch.tf:38`: an email subscription that has to be confirmed by hand.
- `enable_ops_email` is `false` in dev, sbx **and stg** (`stg.tfvars:57`) and true only in prod. Stg has basic alarms that notify nobody.
- `cloudwatch.tf:117`: the healthy-hosts alarm fires at `< 1`.
- `cloudwatch.tf:143`: the 5xx alarm is an absolute count of 10, Target only (no `HTTPCode_ELB_5XX_Count`).
- `infra-live-edge/terraform/cloudfront.tf:45`: no CloudFront logging. The edge stack has no `aws_cloudwatch_log_group` at all.

**Existing alarms:**
- Basic (stg/prod): healthy hosts, 5xx.
- Prod only: API/worker CPU and memory 85%, worker processing-stuck, pending-jobs > 100, Redis `CurrConnections < 1`.
- All environments: the two scaling alarms.

**Not covered:** Redis CPU, memory and evictions; worker running-task count; latency; ELB 5xx; CloudFront and Lambda@Edge errors; WAF blocks.

**Fix:**
1. Route SNS to **PagerDuty/Opsgenie** (HTTPS) and/or **Slack** (AWS Chatbot) in stg and prod.
2. Enable CloudFront standard logging (v2) in prod.
3. **Edge alarms** (us-east-1, namespace `AWS/CloudFront`, dimension `Region=Global`): `5xxErrorRate > 1%`, plus `LambdaExecutionError`, `LambdaValidationError` and `LambdaLimitExceededError`. Use dimensions `DistributionId` + `Region=Global`. These are **default** (free) metrics; the `Lambda*Error` ones are believed default too (*uncertain*). Additional (paid) metrics are only needed for per-status-code error rates, `OriginLatency` and `CacheHitRate`.
4. Healthy-hosts threshold relative to the minimum, e.g. `< ceil(api_min_capacity * 0.5)`.
5. 5xx as a **rate** with metric math, `(FILL(Target_5XX,0) + FILL(ELB_5XX,0)) / RequestCount * 100 > 1`, for 3 of 5 periods. Without `FILL`, missing 5xx data makes the expression empty. Add a p95 `TargetResponseTime` alarm.
6. **Redis alarms:** `EngineCPUUtilization > 70`, `DatabaseMemoryUsagePercentage > 75`, `Evictions > 0`, `ReplicationLag`.
7. **Lambda@Edge log retention:** logs are created in **every regional-edge-cache region** (about 13), not just the three provider aliases. Use a scheduled script/Lambda that sets retention on every `/aws/lambda/us-east-1.<fn>` group across regions.
8. **Per-region synthetic health:** `/api/health` through CloudFront only ever hits the bootstrap region (`tpl:65`). Add **CloudWatch Synthetics** canaries that hit each regional ALB directly with the origin-verify header. Route 53 health checks **can't** send custom headers, so they'd get the ALB's 403.
9. Keep `/health` (`main.py:271`) **shallow** for the ALB, as it is today: it doesn't check Mongo or Redis, which correctly avoids cascading failure. Add a separate dependency signal (a metric for Mongo/Redis reachability per task) instead of deepening the health check.

⚠️ **Pitfall:** v1 said `AWS/Lambda` with `Region=Global`, which is wrong. `Region=Global` applies to `AWS/CloudFront`. Lambda@Edge's `AWS/Lambda` metrics are per region, under the function name `us-east-1.<fn>`.

**Acceptance criteria:**
- A test alarm in stg reaches the on-call channel.
- Edge, Redis and latency alarms exist.
- No log group has unlimited retention.

---

### OBS-02 — "Processing stuck" alarm will fire constantly 🟡 (new in v2)

**Where:** `infra-live-backend/terraform/cloudwatch.tf:52-63`. It fires when Maximum `ProcessingJobCount > 0` for 10 minutes, which is always true under steady load.

**Fix:**
- Emit and alarm on the **age of the oldest processing job** (`OldestProcessingJobAgeSeconds`). Base the threshold on the **real lease / total LLM budget** (JOB-01), not on `llm_timeout`.
- Also emit `OldestPendingJobAgeSeconds`. It works as a queue-latency SLO and is a better scale-out signal than the count.
- Scope both metrics with the same region scoping the worker uses (`_LOCATION_SCOPE`).
- `PendingJobCount` also counts jobs whose `retry_after` is still in the future (`worker.py:445`), which inflates scale-out during provider outages. Exclude them, or emit them separately.

⚠️ **Pitfall (v3):** every task in a region emits the **same** region-wide count, which is harmless because the alarms use Average/Maximum and the step policy uses `metric_aggregation_type = "Average"`. **Never change these to Sum**: that multiplies the value by the task count. Metrics go to each region's own CloudWatch, so regions don't collide. Add a `Region` dimension before building cross-region dashboards or metric streams.

**Acceptance criteria:** The alarm stays OK under steady load and fires when a job is stuck.

---

### OBS-03 — Dead workers raise no alarm 🟡 (new in v2)

**Where:** `backend/worker.py:430`: only the workers emit `PendingJobCount`. All the related alarms use `treat_missing_data = "notBreaching"` (`autoscaling.tf`).

**Problem:** If workers crash-loop, no metric arrives, so nothing alarms and nothing scales out. The queue silently grows.

**Fix:**
- Alarm on ECS `RunningTaskCount < worker_min_capacity` (Container Insights).
- Emit `PendingJobCount` from **one leader per region** (a Redis lock, like session cleanup), not from all 15–200 API tasks. Use the same region scoping as the worker (`locations_for_region(settings.aws_region)`). A small scheduled Lambda also works.
- Use `treat_missing_data = "breaching"` on a dedicated "metric missing" alarm.
- Note that the first datapoint only arrives after the worker's first 60 s sleep (`worker.py:438`), so allow for that in startup alarms.
- Add a worker container health check (APP-06), because a worker with wedged slots keeps emitting metrics.

**Acceptance criteria:** Stopping all workers raises an alarm within 5 minutes.

---

## Networking

### NET-01 — Prod VPC CIDRs identical in every region 🟠/🟡 (v4: High if DEC-01 = B; Medium until Stage 2 if A)

> v4: with the DB in ap-south-1 only (DB-01 Stage 1), **any private path from eu-west-1/us-east-1 to Atlas** (cross-region VPC peering, or Transit Gateway into the ap-south-1 VPC) needs unique, non-overlapping CIDRs for every backend VPC **and** for the Atlas project CIDR (pick an Atlas CIDR outside `10.0.0.0/8` ranges used here, e.g. `192.168.248.0/21`). The Atlas project's AWS CIDR for a region (/21–/24) must be set **before the first dedicated cluster is created in that region**, and can't be changed afterwards. This is required if DEC-01 = B. If DEC-01 = A (ap-south-1 only), it remains important for Stage 2 but isn't urgent.

**Where:** `infra-live-backend/terraform/tfvars/prod.tfvars:9-16`. CIDRs are set per **environment**, so every prod region uses `10.22.0.0/16`. The environments themselves don't overlap (10.2/10.12/10.22/10.32).

> v2 correction: capacity isn't tight **today**. About 753 usable private IPs vs a peak of roughly 520: 250 tasks, ×2 during a deploy, plus 15 endpoint ENIs and 3 Redis nodes. It becomes critical if TF-03's smaller tasks are adopted, since the task count multiplies.

**Problem:** Identical CIDRs rule out VPC peering, Transit Gateway, and per-region Atlas peering later.

**Fix:**
1. A per-region CIDR map, e.g. `vpc_cidrs = { "ap-south-1" = "10.22.0.0/16", "eu-west-1" = "10.23.0.0/16", "us-east-1" = "10.24.0.0/16" }`, or `cidrsubnet()` from a per-environment /12.
2. `/20` private subnets **before** adopting smaller tasks, derived with `cidrsubnet()`.

⚠️ **Pitfalls:**
- Changing the VPC CIDR **or any subnet CIDR** forces replacement of the subnets and everything inside them: ECS services, Redis and endpoints. For already-deployed regions, either keep the existing CIDR (change only new regions) or plan a blue/green VPC migration.
- New `/20`s must not overlap the existing `10.22.1–6.0/24`.

**Acceptance criteria:** Every (environment, region) pair has a unique CIDR; private capacity is ≥ 3× the maximum task count.

> ✅ **v6 (2026-10-19): implemented** before any environment was deployed, so nothing had to be replaced. `vpc_cidrs` in each `tfvars/<env>.tfvars` gives one `/16` per region: dev `10.2–4`, stg `10.12–14`, prod `10.22–24`, sbx `10.32–34`, ap-south-1 first. All three regions are listed even when not deployed, so their blocks are reserved. `vpc.tf` derives public `/24` ×3 (`10.x.1–3.0`) and private `/20` ×3 (`10.x.16/32/48.0`): about 12,270 private IPs per region against a prod peak of about 520. Terraform validates the shape (`10.x.0.0/16`) and uniqueness within an environment; uniqueness across environments follows the numbering plan. **Still to do at DB-01 Stage 1:** set the Atlas project's AWS CIDR for ap-south-1 (outside `10.0.0.0/8`, e.g. `192.168.248.0/21`) **before** creating the first dedicated cluster. It can't be changed afterwards.

---

## Terraform structure & configuration

### TF-01 — No reusable modules; adding a region is manual everywhere 🟠

**Where:**
- All `infra-live-*/terraform` stacks: e.g. hand-written `public_1/2/3` and `private_1/2/3` in `infra-live-backend/terraform/vpc.tf`, and per-region blocks in `infra-live-edge/terraform/data.tf:21-37`, `s3_uploads_policy.tf` and `provider.tf`.
- Workflow region-conditional code: per-region secret checks at `terraform-live-backend.yml:149-157`, and `case` blocks at `:195-200`, `:226-243` and `terraform-live-edge.yml:172-177`.
- The 2ⁿ−1 region dropdown appears in **seven** workflows: `terraform-live-backend.yml:37-43`, `terraform-live-edge.yml:45-51`, `terraform-live-all.yml:65-71`, `terraform-live-scheduler.yml:66-72`, plus `deploy-`/`promote-`/`restart-live-backend.yml`.
- No `.terraform.lock.hcl` is committed, and `terraform init` doesn't use `-lockfile=readonly`.

**Fix:**
1. A `modules/` directory with `network`, `ecs-service` (shared by API and worker), `redis`, `alb` and `edge-origin`.
2. Regions driven by one list/map (e.g. `shared/regions.json` or tfvars).
3. Replace the per-region **secrets** `case` blocks with GitHub **variables** (`vars.*`), since ACM ARNs and bucket names aren't secret. Dynamic lookup works today, so the `case` blocks can go now:
   - for example, `vars[format('ACM_CERTIFICATE_ARN_{0}', …)]`;
   - the comment at `terraform-live-backend.yml:184` ("does not support dynamic secret references") is wrong.
4. Replace the dropdown with a comma-separated input validated against the allow-list.
5. Commit `.terraform.lock.hcl` (`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`) and use `init -lockfile=readonly` in CI.

⚠️ **Pitfall:** use `moved {}` blocks. The refactor plan must show **0 to destroy**.

**Acceptance criteria:** A fourth region is a config-only change; the refactor plan shows only moves.

---

### TF-02 — Task definition `:latest` bootstrap and config drift 🟡

**Where:**
- `infra-live-backend/terraform/ecs.tf:52,216`: the image is `:latest`, which is never pushed (the repos are IMMUTABLE).
- `ecs.tf:185,313`: `ignore_changes = [task_definition, desired_count]`.
- Deploy and promote clone the **latest revision** of the family (`deploy-live-backend.yml:269,365`, `promote-live-backend.yml:448,540`).
- Restart uses `--force-new-deployment` with the pinned revision (`restart-live-backend.yml:145-148`).

**Problems:**
- **Fresh apply, including every nightly re-create:** services start on the nonexistent `:latest` and fail until a deploy runs.
- Terraform-only changes (env vars, CPU/memory, the ADOT sidecar) create a new revision that nothing rolls out until the next deploy. Restart **does not** pick them up; it only refreshes Secrets Manager values.

> v2 correction: v1's "force new deployment" concern is harmless, because restart reuses the pinned revision.

**Fix (A recommended):**
- **A:** Terraform owns the task definition. The image tag comes from an SSM parameter written by deploy/promote (`/app/env/backend/region/image_tag`). Drop `task_definition` from `ignore_changes` and keep `desired_count` ignored. The fresh-apply problem is solved because the parameter holds the last good tag.
- **B:** Add a **"redeploy current image"** mode to `deploy-live-backend` (none exists today: it always rebuilds from the checked-out ref) and trigger it after `terraform apply` when the task definition changed.

**Acceptance criteria:**
- A fresh environment apply comes up healthy without a separate deploy (if an image exists).
- An env var change reaches running tasks automatically.

---

### TF-03 — Prod sizing: single-process uvicorn makes CPU scaling inert 🟠 (v2: raised)

**Where:** `infra-live-backend/terraform/tfvars/prod.tfvars`, `backend/Dockerfile:52` (uvicorn, no `--workers`), `ecs.tf:31,151,287`.

**Problems:**
- **Single-process uvicorn on a 4 vCPU task** uses at most about 1 vCPU, roughly 25% task CPU. The 60% CPU target-tracking policy and the 85% CPU alarms **can never fire**, so scaling happens only on request count and memory. The worker is also one asyncio process on 4 vCPU.
- `desired_count = 2` vs `api_min_capacity = 15`, and `worker_desired_count = 2` vs `worker_min_capacity = 5`: the desired counts are meaningless.
- `deployment_minimum_healthy_percent`/`maximum_percent` aren't set, so the defaults of 100/200 apply. Deploys temporarily **double** the tasks, and so the Fargate vCPU quota needed: about 1,000 vCPU at maximum scale, 2,000 during a deploy.
- `ALBRequestCountPerTarget = 1000/min` hasn't been validated against long LLM calls.

**Fix:**
1. **Right-size:** about 1 vCPU / 2 GB tasks with one uvicorn process (or 2 vCPU with `--workers 2`). Recalculate min/max counts from a load test, and set `desired_count = min`.
2. Set `deployment_maximum_percent = 150` (or similar) to bound the deploy surge, and request Fargate quota for peak × surge in each region.
3. Prefer scaling on `ALBRequestCountPerTarget` and/or `TargetResponseTime`. Keep CPU as a guard.
4. Workers: an I/O-bound worker needs about **0.5 vCPU / 1 GB** with concurrency 20–50, not 4 vCPU / 8 GB with concurrency 5 (`prod.tfvars:36-40`). Raising concurrency multiplies Mongo polling, so do **DB-02's poll redesign first**.
5. Put part of the worker capacity on **Fargate Spot**. Add `FARGATE_SPOT` to `aws_ecs_cluster_capacity_providers` (`ecs.tf:31`) and replace `launch_type` (`:151`, `:287`) with `capacity_provider_strategy`. Spot interruptions need APP-06 and JOB-01.
   - ⚠️ Changing `launch_type` → `capacity_provider_strategy` is believed to force **service replacement**, i.e. destroy then create, with downtime. Confirm with `terraform plan`, and use a new service name + `create_before_destroy`, or a maintenance window.
6. **uvicorn flags (v3)** in `backend/Dockerfile:52`:
   - `--timeout-keep-alive` = ALB `idle_timeout` + 5. Derive it from the ALB value (60 today, maybe 120 after APP-03) rather than hard-coding it. Uvicorn's default of 5 s against the ALB's 60 s causes intermittent **ALB 502s**.
   - `--timeout-graceful-shutdown` must be **below** ECS `stopTimeout` (default 30): e.g. 25, or raise `stopTimeout`.
   - **Don't** enable uvicorn proxy trust (`--forwarded-allow-ips`); see APP-01's pitfall. Client-IP logic stays in `_get_client_ip`.
7. **If using `--workers N`:** each process runs lifespan separately: its own `init_indexes` (DB-03), its own cleanup task (AUTH-06), its own in-memory limiter fallback, and its own Mongo pool (Motor default `maxPoolSize=100`).
8. **Budget Atlas connections** as tasks × workers × pool per region × regions, and keep it under the Atlas tier limit (DB-02).
   - **v4:** with an M10/M20 database, the **DB, not Fargate, is the scaling ceiling**. Today's prod maximums (`api_max_capacity = 200`, `worker_max_capacity = 50` per region) can't be served by M10/M20, or even M30.
   - Set `api_max_capacity` and `worker_max_capacity` from DB-02's budget, e.g. tens of tasks in total, not hundreds.
   - Raise them only together with the Atlas tier (auto-scaling ceiling) after a load test.
   - The DB's CPU (2 vCPU on M10/M20) is likely to saturate before ECS does. Watch Atlas `System CPU` and `Normalized Process CPU`, and add Atlas alerts to the on-call route (OBS-01).
9. Include **bcrypt CPU** (about 250 ms per hash at 12 rounds; AUTH-04) in login-storm sizing.

⚠️ **Pitfall:** smaller tasks multiply the task count, so do NET-01's `/20` subnets first. They also multiply Mongo connections (DB-02).

**Acceptance criteria:**
- A load test shows CPU-based scaling engaging.
- Quotas are documented per region.
- Desired equals min.
- `api_max_capacity`/`worker_max_capacity` equal the DB-02 budget values documented in `docs/infra-operations.md`.

---

### TF-04 — Redis oversized and mis-shaped for future caching 🟡

**Where:** `infra-live-backend/terraform/elasticache.tf`, `prod.tfvars:19-21` (`cache.r6g.4xlarge`, `elasticache_replica_count = 2`, multi-AZ). The parameter group is empty (`elasticache.tf:47-54`), so the default `volatile-lru` applies. `engine_version = "7.1"` is hard-coded (`:68`).

> v2 correction: Redis holds **more than LLM counters**. It also holds the slowapi per-route IP/user limits (`app/limiter.py:68-89`, `rl_ip`/`rl_user`) and the session-cleanup lock (`app/main.py:68-125`). Sessions are in **Mongo**, and the worker queue is the Mongo `jobs` collection (`worker.py:110`); the worker doesn't use Redis.

**Fix:** see [Appendix A](#appendix-a--caching-recommendation).

**Acceptance criteria:**
- The node type is justified by a working-set estimate.
- `maxmemory-policy` is set explicitly per workload.
- The engine version is a variable.
- The node-type comment at `elasticache.tf:4-12` matches the tfvars.

---

### TF-05 — Bucket policies: no TLS-only deny; manual buckets 🟡

**Where:** `infra-live-edge/terraform/s3_uploads_policy.tf`, `s3_backend_policy.tf`, `infra-live-frontend/terraform/s3_policy.tf`, `infra-live-backend/terraform/s3.tf:85` (`regional_logging`).

> v2 correction: each bucket currently has **one** owning stack (enforced by `docs/environments.md` §5): assets → edge, uploads → edge (the backend sets only CORS, `s3.tf:7`), SPA → frontend, global logging → edge. v1's "two stacks overwrite each other" isn't happening. The real risk is that `aws_s3_bucket_policy` wipes any **manually** added statements on these manually created buckets.

**Fix:**
- Add a `Deny` statement on `aws:SecureTransport = false` to every policy.
- Bring the buckets under Terraform (`import {}` blocks) with versioning, encryption, public-access block and lifecycle in code.
- Keep the single-owner rule documented.

**Acceptance criteria:** Every bucket policy denies non-TLS; the buckets themselves are in Terraform state.

---

### TF-06 — Cross-stack SSM coupling is order-sensitive 🟡

**Where:** `infra-live-edge/terraform/ssm_read.tf:14`, `infra-live-frontend/terraform/ssm_read.tf:6`. The chain is backend → SSM → edge → SSM → frontend.

**Fix:**
- Add a **workflow pre-check** step that runs `aws ssm get-parameters` for every required path and fails with a clear "run X first" message.
- Or use `data "aws_ssm_parameters_by_path"` with a `postcondition` on its returned names.
- Keep `terraform-live-all.yml` as the recommended entry point, and document the order in `docs/infra-operations.md`.

**Acceptance criteria:** Applying the frontend stack before the edge stack fails fast with a clear "run terraform-live-edge first" message.

⚠️ **Pitfall:** v1 suggested `precondition`/`check` on `data "aws_ssm_parameter"`. That doesn't work, because a missing parameter makes the data source read itself fail before any condition is evaluated.

---

## WAF

### WAF-01 — CRS 8 KB body limit blocks audio/LLM; rate-limit gaps 🟠 (v2: raised from Medium)

**Where:** `infra-live-edge/terraform/waf.tf`:
- Geo block (priority 5, custom rule, `:38-62`)
- Core Rule Set (p10)
- KnownBadInputs (p20)
- IpReputation (p30)
- `RateLimitPerIP` (p40, `:139-143`: `limit = 1000`, `evaluation_window_sec = 300`, aggregates on IP, no scope-down, covers the whole distribution)

No `version` is pinned and there are no `rule_action_override`s. WAF is enabled only in stg/prod (`enable_waf = false` in dev/sbx).

**Real request-body sizes per endpoint (v3, from the backend schemas):**

| Endpoint | Max body accepted by the app |
|---|---|
| `POST /api/v1/audio/transcribe` (multipart) | 10 MB + multipart overhead (`audio.py:57`) |
| `POST /api/v1/llm/invoke` | prompt 32,000 chars + schema 4,000 chars (`llm.py:28,39`): about 36 KB ASCII, up to about 200 KB with JSON `\u` escapes |
| `POST /api/v1/jobs` (the main LLM path) | same 32k/4k limits (`schemas/jobs.py:168,180`) |
| `POST /api/v1/children`, `PATCH /api/v1/children/{id}` | effectively **unbounded** (APP-10) |
| `POST /api/v1/user/completed-growth-areas` | about 64 KB (`growth_areas.py:80`) |
| `PATCH /api/v1/user/observations` | 64 KB (`observations.py:17`) |
| `PATCH /api/v1/user/ninety-day-plan` | 64 KB (`ninety_day_plan.py:22`) |
| All others (auth, preferences, presigns, `DELETE /user/me`) | < 8 KB |

**Problems:**
- **Live outage in stg/prod:** CRS `SizeRestrictions_BODY` (8 KB) blocks audio uploads (allowed up to 10 MB), every LLM/job prompt over 8 KB, and the children, observations, growth-areas and ninety-day-plan writes above 8 KB. This never shows up in dev/sbx because they have no WAF.
- Every rule group blocks immediately, with no count-mode trial.
- The single global rate limit counts static assets and throttles carrier-NAT users. There's no stricter limit on `/api/v1/auth/login|register|google|refresh`.
- Managed rule group versions aren't pinned.

**Fix:**
1. `rule_action_override { name = "SizeRestrictions_BODY" action_to_use { count {} } }` on CRS. Then add custom size rules:
   - **Skip** body-size inspection for `/api/v1/audio/*`. A CloudFront web ACL inspects only the first **16 KB** of a body (configurable up to 64 KB), so WAF **can't** enforce 10 MB. Enforce that in the app (APP-09); WAF can at most check the `Content-Length` header.
   - For the JSON-heavy paths (`/api/v1/llm/*`, `/api/v1/jobs`, `/api/v1/children*`, `/api/v1/user/{observations,ninety-day-plan,completed-growth-areas}`), size rules run in **count mode only**. Valid LLM/job bodies can reach about 200 KB when escaped, and children's bodies are unbounded today. Enforce the real limits in the app (APP-09, APP-10).
   - To evaluate bodies above 16 KB, set `association_config { request_body { cloudfront { default_size_inspection_limit = "KB_64" } } }` on the web ACL. There's an extra per-request charge above 16 KB.
   - 8 KB for everything else, including auth.
   - Also cap prompts by **bytes** (not characters) in the app.


   > v3 correction: v2's "8 KB elsewhere" would have broken six JSON endpoints.
2. A variable to deploy new rule groups in `count` mode.
3. Scope the global rate rule to `/api/*` and raise it. Add a strict rule on `/api/v1/auth/(login|register|google|refresh)`, e.g. 20–50 per 5 minutes, using **custom keys** (IP + JA3 fingerprint; check whether JA4 is available as a rate-based key).
4. Add `AWSManagedRulesAnonymousIpList`, and consider Bot Control / ATP (paid). The SQLi rule set adds little against MongoDB. Pin `version` on every managed group.

⚠️ **Pitfalls:**
- Don't aggregate on `X-Forwarded-For`. On a CloudFront web ACL, WAF already sees the real client IP, and XFF is client-spoofable.
- Paths are `/api/v1/...`.
- Capacity: CRS 700 + KBI 200 + IPRep 25 + AnonIP 50 + rate/custom rules is about 1,000 WCU, under the 1,500 included.

**Acceptance criteria:**
- A 5 MB audio upload succeeds through stg CloudFront.
- Auth endpoints have their own limit.
- New rules can ship in count mode.

---

## Scheduler

### SCH-01 — Duplicate dispatch via Lambda async retries; no timeout/alarm 🟡

**Where:**
- `infra-live-scheduler/lambda/dispatcher.py:37` (`urlopen(req)` with no timeout).
- `infra-live-scheduler/terraform/scheduler.tf:97-100,138-141` (schedule retry policy).
- `infra-live-scheduler/terraform/lambda.tf:67` (CKV_AWS_116 skip), `:79` (timeout 30 s).
- The Lambda log group is unmanaged (no retention).

**Problem:** If GitHub accepts the dispatch but the call then errors or times out, the function fails. **Lambda's own async retries** (2 by default, because EventBridge Scheduler invokes Lambda asynchronously) run it again, which can start a second apply or destroy.

> v2 correction: v1 blamed the scheduler retry policy. That policy and the schedule's `dead_letter_config` cover only **delivery to Lambda**, so setting the scheduler's `maximum_retry_attempts = 0` would not fix the duplicate. The CKV_AWS_116 skip justification at `lambda.tf:67` is inaccurate for the same reason.

**Fix:**
1. `urlopen(req, timeout=10)`.
2. `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0`, `maximum_event_age_in_seconds = 300` (otherwise throttled or system-error events keep being retried for up to 6 h), and an `on_failure` destination (SQS/SNS), plus an alarm on Lambda `Errors` and on the destination.
3. Optional idempotency: before dispatching, list workflow runs created in the last N minutes for the same inputs and skip if one exists.
4. Manage the Lambda log group with retention.
5. See SEC-03 for the payload and trust hardening.

**Acceptance criteria:** A simulated timeout after a successful dispatch produces exactly one workflow run and one alert.

---

## GitHub Actions / pipelines

### CI-01 — Prod deploy/apply possible from any branch 🔴

**Where:** Every `workflow_dispatch` deploy, Terraform, promote, restart and mobile workflow. No workflow checks the ref (the only `github.ref*` use is the concurrency key at `check.yml:11`).

**Problem:** Anyone with write access can dispatch from a feature branch and apply that branch's Terraform, or deploy that branch's code, to **prod**. GitHub Environment "deployment branch" rules may exist in repo settings, but nothing in the repo shows or documents them.

**Fix:**
1. **Primary control:** repo settings → Environments → `prod` (and `stg`):
   - Deployment branches = `main` (and/or `v*` tags).
   - Required reviewers.
   - Prevent self-review.
2. **OIDC trust** scoped to `environment:prod` (SEC-04). Combined with (1), this ties AWS access to the ref.
3. Branch protection on `main`: required reviews, required `Check` status, no force-push. Add a CODEOWNERS entry (none exists) for `.github/workflows/` and `infra-live-*/`.
4. Optional in-YAML guard: a **separate first job without `environment:`** that checks `GITHUB_REF`, so it runs before any prod secrets are issued. This is defence-in-depth only, because it can be deleted on a branch.
5. `promote-live-frontend` checks out a SHA from SSM, not `GITHUB_REF`, so a ref guard does nothing there. See CI-10.
6. Document the settings in `docs/ci-cd.md`.
7. Check the GitHub plan. In **private** repos, deployment-branch rules and required reviewers need GitHub Pro/Team/Enterprise, and some protection options may need Enterprise; *uncertain*, so verify for this org.

⚠️ **Pitfall:** `workflow_dispatch` executes the YAML from the chosen branch, so in-workflow guards alone are not a control.

**Acceptance criteria:** Dispatching a prod job from a non-main branch is refused by GitHub (environment rule) before the job starts.

---

### CI-02 — Plan and apply in one job; scheduler applies with no plan 🔴

**Where:**
- Backend: plan `terraform-live-backend.yml:321-323`, apply `:346-348`.
- Edge: `terraform-live-edge.yml:242`/`:270`.
- Frontend: `terraform-live-frontend.yml:145`/`:170`.
- **Scheduler (worse):** `terraform-live-scheduler.yml:185-187` runs `terraform apply -auto-approve` with **no saved plan and no summary**, and destroy is `apply -destroy -auto-approve` (`:211-213`). A plan is only produced when the action is `plan` (`:160`).
- `check.yml` never runs `terraform plan`.

**Problems:**
- Environment approval happens before the plan exists, so the reviewer approves blind.
- Plan and apply share the same `ROLE_ARN` (write/admin).
- In `terraform-live-all`, each called job has its own `environment:`, so one full-stack prod run needs several separate approvals (about 3 infra-only, about 6 with deploy), each given before its plan exists.

**Fix:**
1. Two jobs per stack:
   - `plan`: runs in a separate **`prod-plan`** environment (branch-restricted to `main`, no reviewers), with a plan role trusted for `environment:prod-plan`. Uploads the **encrypted** binary plan (it contains secrets; e.g. `age` with a key in secrets) plus the text summary.
     - Plan needs the environment's secrets (`ROLE_ARN`, `TF_VAR_*`), which only an environment-bound job can read, so "no environment" doesn't work.
     - With `use_lockfile = true`, the "read-only" plan role still needs `s3:PutObject`/`s3:DeleteObject` on `<state-key>.tflock`.
   - `apply`: `environment: prod` with reviewers, `needs: plan`. Shows the summary, downloads the plan, and applies that exact plan. Alternatively, re-plan in the apply job and fail if `terraform show -json` differs from the reviewed one.
2. Give the scheduler workflow the same plan → approve → apply flow.
3. Add a `terraform-plan-pr.yml` workflow: on `pull_request` touching `infra-live-*/**`, plan dev (optionally stg/prod with a read-only role) and post a PR comment.
4. Use separate OIDC roles: a plan role (read-only + state read + lockfile write) and an apply role trusted only for `environment:<env>` (SEC-04). A `pull_request` job's OIDC `sub` is `repo:<org>/buddy-app:pull_request`, so the **dev plan role** for PR plans may trust that subject. Fork PRs get no OIDC token and no secrets.
5. Restructure `terraform-live-all` so prod approval happens once, after all plans are shown (a plan-all job → a single approval job → apply jobs).

**Acceptance criteria:**
- Prod apply is approved **after** the plan is visible.
- Every infra PR gets a plan comment.
- The scheduler never applies without a reviewed plan.

---

### CI-03 — Deployed image ≠ scanned image; prod deploy bypasses promotion 🟠

**Where:**
- `check.yml:562` builds and scans its own image.
- `deploy-live-backend.yml:154-164` runs a plain `docker build`: no buildx, no cache, no provenance/SBOM, no scan, no signing.
- `deploy-live-backend.yml:25` offers `prod`.
- `terraform-live-all.yml:171-179` (backend) and `:185-192` (frontend) call deploy with `environment: inputs.environment`, which can be prod.
- The builds aren't reproducible: `backend/Dockerfile:15-16` runs `apt-get upgrade` with a cache-bust per SHA, and `python:3.13-slim` isn't pinned by digest. Two builds of the same commit differ.

**Fix:**
1. Build **once** on merge to `main` with `docker/build-push-action` (buildx, cache, `provenance: true`, `sbom: true`). Then scan (Trivy, which must fail on HIGH/CRITICAL), **sign** (cosign keyless via OIDC), and push to the dev ECR or a central ECR. Deploy and promote reference the **digest**.
2. Verify the signature (`cosign verify`) before registering a task definition.
3. Remove `prod` (and probably `stg`) from `deploy-live-backend`/`deploy-live-frontend`. Add a guard job in the called workflows so `workflow_call` with prod also fails. Stop `terraform-live-all` from deploying to prod (the infra-only path for prod).
4. Pin the base image by digest, and remove `apt-get upgrade` (rely on rebuilding from the updated base, which Dependabot can bump).
   - ⚠️ The Dockerfile comment names CVEs that only the upgrade fixes. Expect the Trivy gate to fail until the base image catches up, and use a time-boxed `.trivyignore` entry if needed.
5. ⚠️ `provenance`/`sbom` push an OCI index plus attestation manifests:
   - `docker save`-based promotion (CI-09) drops them, so **land CI-09 first**;
   - copy signatures with `cosign copy` or a referrers-aware copy (`crane copy` of the image alone doesn't move `.sig` tags);
   - check interaction with IMMUTABLE tags and the "keep last 30" lifecycle rule (*uncertain*; newer cosign uses OCI 1.1 referrers).
6. Update `promote-live-backend.yml` to support digest references (it currently rejects `@sha256`).

**Acceptance criteria:**
- The prod image digest equals the CI-scanned digest.
- No path deploys a fresh build directly to prod.

---

### CI-04 — Actions pinned by tag; binaries downloaded unverified 🟠

**Where:**
- Tag-pinned actions everywhere: `aquasecurity/trivy-action@v0.36.0` ×10, `aws-actions/configure-aws-credentials@v6.1.1` ×14, `hashicorp/setup-terraform@v4.0.1` ×6, `actions/cache@v5` ×7, `actions/upload-artifact@v7/@v7.0.1`, `actions/dependency-review-action@v5`, `github/codeql-action/*@v3`, `actions/setup-java@v5`, `hadolint/hadolint-action@v3.3.0`, `terraform-linters/setup-tflint@v6.2.2`. Some are **major-only** tags (`@v5`, `@v3`).
- Nuclei (`check.yml:778-783`) and Dockle (`:579-583`) are downloaded with `curl` and **no checksum** (gitleaks at `:285-292` does verify).
- The service containers `mongo:7` and `redis:7-alpine` are tag-only.
- There's no `.github/dependabot.yml`.

**Problem:** Tags can be moved; `trivy-action` has had its tags hijacked before. A compromised action runs with the workflow's OIDC role and, because of SEC-06, with every secret in the job.

**Fix:**
- Pin every third-party action to a full commit SHA with a version comment.
- Verify the checksums of downloaded binaries.
- Pin service images by digest.
- Add Dependabot for `github-actions`, `docker`, `pip` and `npm`.
- Optionally enable the repo setting "Require actions to be pinned to a full-length commit SHA".

> v2 correction: `check.yml:14-15` already sets top-level `permissions: contents: read`, and the Terraform workflows have one job each, so v1's "`permissions: {}` top-level" adds little. Keep permissions minimal per job when splitting jobs (CI-02).

**Acceptance criteria:**
- `grep -nE 'uses: [^.][^@ ]*@' .github/workflows/*.yml | grep -vE '@[0-9a-f]{40}([[:space:]]|$)'` returns nothing. This catches non-`v` tags and branches too.
- Every downloaded binary is checksum-verified.

---

### CI-05 — All regions deployed at once; no canary/bake 🟠

**Where:** `deploy-live-backend.yml:203-206`, `promote-live-backend.yml:113-116,308-311` and `restart-live-backend.yml:65-70` all use a `matrix.aws_region` with `fail-fast: false`. Restart in `all` mode also restarts backend **and** worker in parallel (`:70`), whereas deploy goes API first and then worker.

**Problem:** A bad release that passes health checks reaches every region simultaneously.

**Fix:**
1. Prod waves: first region → bake 10–15 minutes → check that region's alarms (5xx rate, latency, healthy hosts) → next region. Use `max-parallel: 1` **and `fail-fast: true`** plus an alarm-check step, or explicit wave jobs chained with `needs:`. With today's `fail-fast: false`, a failed region-1 leg doesn't stop region 2.
   - Under DEC-01 = A (prod in ap-south-1 only), apply waves to multi-region **stg**, and rely on ECS deployment alarms (#2) in prod.
2. Wire ECS **deployment alarms** (`aws_ecs_service.alarms { alarm_names, enable, rollback }`) so ECS itself rolls back on CloudWatch alarms.
3. Consider ECS blue/green (CodeDeploy, or ECS native blue/green) for the API, with 10% → 100% traffic shifting.

**Acceptance criteria:** A prod rollout stops after region 1 when its alarms fire.

---

### CI-06 — Polling and register-TD scripts duplicated 🟡

**Where:** the ~25-line 15-minute wait loop (`for i in $(seq 1 60) … sleep 15`):

| File | Line | Step |
|------|------|------|
| `.github/workflows/deploy-live-backend.yml` | 313 | Deploy new task definition to ECS (API) |
| `.github/workflows/deploy-live-backend.yml` | 400 | Deploy Worker task definition to ECS |
| `.github/workflows/promote-live-backend.yml` | 492 | Deploy to target ECS service (API) |
| `.github/workflows/promote-live-backend.yml` | 575 | Deploy worker to target ECS service |
| `.github/workflows/restart-live-backend.yml` | 154 | Restart wait (matrix over service) |

The duplicated "register task definition" jq block: `deploy-live-backend.yml:275,369`, `promote-live-backend.yml:454,544`.

**Fix:** composite actions `.github/actions/ecs-register-td` (inputs: family, container, image) and `.github/actions/ecs-wait-stable` (inputs: cluster, service, expected task-definition ARN or deployment ID, timeout). Port the CI-11 fix (already applied in Phase 1) into it.

> v2 correction: autoscaling changing `desiredCount` mid-deploy only delays success (the loop re-reads it each poll), so it isn't a bug. The real bug is CI-11.

**Acceptance criteria:** One implementation is used in all five places, and the CI-11 tests pass.

---

### CI-07 — Frontend deploy deletes live chunks; no rollback 🟠 (v2: raised)

**Where:** `deploy-live-frontend.yml:142` (`aws s3 sync frontend/dist/assets/ … --delete`), `:148` (`index.html` and the rest, `--exclude "assets/*"`), `:159` (invalidation `/*`). The same at `promote-live-frontend.yml:261,267`.

**Problems:**
- The `assets/` sync with `--delete` runs **before** the new `index.html` is uploaded. During that gap the **live** `index.html` references deleted chunks, so this breaks **new page loads**, not only open sessions.
- Users with an older page open get `ChunkLoadError`s.
- Missing chunks come back as **200 HTML** (EDGE-03), so the browser shows a MIME error rather than a recoverable 404.
- The `/*` invalidation also purges immutable assets.
- There's no rollback workflow, and `promote-live-frontend` rebuilds from source (`:28-31,235-256`), so prod isn't byte-identical to stg.

**Fix:**
1. Drop `--delete` on `assets/`. Hashed files are immutable, so keep them.
2. Upload each build to `releases/<sha>/` as well, and expire only **non-current** releases (a cleanup job keeping the last N). Don't use plain age-based expiry: S3 expiry counts from the upload date, so a 30-day rule would delete the live build after 30 days without deploys.
3. Invalidate only `/index.html` (and other non-hashed files).
4. Add a `rollback-live-frontend.yml` workflow that takes a SHA (SSM parameter history keeps up to 100 versions of `deployed_git_sha`) and restores `releases/<sha>/index.html`.
5. Longer term: runtime config (`/config.json`) so one build can be promoted unchanged.
6. Fix EDGE-03 so missing assets return a real 404.

**Acceptance criteria:**
- A deploy causes zero failed chunk loads for open sessions and new loads.
- Rollback takes under 5 minutes without a rebuild.

---

### CI-08 — CodeQL non-gating; no SARIF upload; required checks unverified 🟢 (v2: rewritten)

> v2 correction: v1 claimed many security checks were non-blocking. That's **wrong**: every `continue-on-error` step is listed in its aggregator. `check.yml:641-672` covers all 23 security-scan steps (gitleaks, hadolint ×2, bandit, semgrep, pip-audit, checkov, npm audit, yarn audit, retire ×2, trivy vuln ×3, license ×3, config ×4, image, dockle), and `:795-806` covers openapi_drift, spectral and nuclei. The `outcome == failure` logic is correct.

**Remaining gaps:**
- CodeQL `analyze` uploads results but never fails the build.
- No SARIF upload for trivy, checkov or semgrep, so there's no triage history in GitHub code scanning.
- Whether `Check` is a **required status check** on `main` can't be verified from the repo.

**Fix:**
- Upload SARIF from trivy, checkov and semgrep (`github/codeql-action/upload-sarif`).
- Add a code-scanning merge-protection rule (CodeQL severity ≥ high blocks merges).
- Make `Check` a required status check and document it in `docs/ci-cd.md`.

---

### CI-09 — Promotion moves images via `docker save` artifacts 🟡

**Where:** `promote-live-backend.yml:251-294` (`docker save | gzip` at `:278`, artifact retention 1 day at `:292`), and `:392` (`source promote/images.env`).

**Problems:**
- Slow for large images.
- The tarball is downloadable by anyone with repo read access while it exists.
- The digest isn't verified.
- `source promote/images.env` **executes** a file produced by the source-environment job inside the target (prod) job's shell. ECS image-name validation blocks abuse today, but this is fragile.

**Fix:**
- Registry-to-registry `crane copy` / `skopeo copy` (preserves the digest), or ECR cross-account/cross-region replication. Also copy signatures and attestations (`cosign copy`) once CI-03 signs images.
- Verify the digest and cosign signature after the copy.
- Pass values via job `outputs`, not a sourced file.

**Acceptance criteria:** No image tarball artifacts; the target digest equals the source digest.

---

### CI-10 — `promote-live-frontend` trusts the SSM SHA 🟠 (new in v2)

**Where:** `promote-live-frontend.yml:126-136` (reads `/<app>/<source_env>/edge/deployed_git_sha`), `:238` (`checkout ref: ${{ needs.source_ref.outputs.git_sha }}`, unvalidated), `:300` and `:303` (interpolated into `run:`).

**Problem:** Anyone who can write the **dev/stg** SSM parameter can point it at **any commit** (anyone with repo write access can push one). `npm ci`/`npm run build` then runs that commit's code with **prod credentials** and deploys it to prod. Shell injection via `:300`/`:303` is also possible if the value is a valid ref name that survives `actions/checkout` at `:238`.

**Fix:**
- Pass the value via `env:`.
- Validate it against `^[0-9a-f]{40}$`.
- Verify `git merge-base --is-ancestor "$SHA" origin/main` after fetching.
- Restrict `ssm:PutParameter` on `*/edge/deployed_git_sha` to the deploy roles.

**Acceptance criteria:** Setting the SSM value to `$(id)` or a non-main SHA makes the promote fail at validation.

---

### CI-11 — A rolled-back deploy can be reported as success 🟠 (new in v2)

**Where:** all 5 wait loops (CI-06 table), e.g. `deploy-live-backend.yml:321` (`ROLLOUT=… .deployments[0].rolloutState`) and `:328` (success when `DEPLOYMENTS -eq 1 && RUNNING == DESIRED`).

**Problem:** When the circuit breaker rolls back, ECS creates a new PRIMARY deployment of the **old** revision, and the failed one moves behind it in the list. `deployments[0]` is then the rollback, so the `FAILED` check rarely fires. Once only one deployment remains, the loop prints "Deployment complete" and **exits 0 while the old version is running**. This compounds CI-05 and could also let promote pick up a bad image.

**Fix:**
- Track the deployment created by `update-service` (its `id`, or `select(.taskDefinition == $NEW_TD_ARN)`). Fail if that deployment's `rolloutState == "FAILED"`.
- Succeed only when that deployment is PRIMARY with `rolloutState == "COMPLETED"` **and** `services[0].taskDefinition == $NEW_TD_ARN`.
- For restart, track the deployment ID returned by `update-service --force-new-deployment`.

**Acceptance criteria:** Deploying an image whose health check fails makes the workflow **fail** (verify in dev with a deliberately broken image).

---

### CI-12 — Concurrency groups per service allow overlapping deploys 🟡 (new in v2)

**Where:** `deploy-live-backend.yml:67`, `promote-live-backend.yml:62` and `restart-live-backend.yml:52` all use `group: deploy-live-backend-superpower-<env>-<service>`.

**Problem:** `all`, `backend` and `worker` land in **different** groups, so a deploy of `all` and a restart of `backend` can hit the same ECS service at the same time. This contradicts the comment at `deploy-live-backend.yml:63-65`. Separately, if the API succeeds and the worker fails in `all` mode, API and worker are left on different images and nothing reconciles them.

**Fix:**
- Key the group on environment only (`deploy-live-backend-<env>`).
- Or split into per-service jobs with per-service groups, where `all` acquires both.
- On a worker failure in `all` mode, either roll the API back or clearly flag the mismatch.

**Acceptance criteria:** A concurrent `all` deploy and `backend` restart are serialised.

---

### CI-13 — `npm ci` runs with prod AWS credentials loaded 🟡 (new in v2)

**Where:** `deploy-live-frontend.yml:64-70` (configure credentials) runs before `:130` (`npm ci`). Similarly, `promote-live-frontend.yml:169` runs before `:249`.

**Problem:** Any dependency's install script (supply-chain attack) can use the prod deploy role.

**Fix:**
- Build first, in a job or step without AWS credentials (`npm ci --ignore-scripts` where possible), then configure credentials only for the S3 sync and invalidation steps. Note: the build needs the environment secret `VITE_GOOGLE_CLIENT_ID`. A separate build job therefore also needs `environment:`, which adds an approval; ordering steps within one job avoids that.
- Or use two jobs: build (no `id-token`), then deploy (downloads `dist/` as an artifact).

**Acceptance criteria:** No step that runs third-party package code has AWS credentials available.

---

### CI-14 — Promote reads PRIMARY even while it's still rolling out 🟡 (new in v2)

**Where:** `promote-live-backend.yml:200-203` (``deployments[?status==`PRIMARY`]``). The comment at `:179-182` claims this is the stable image.

**Problem:**
- PRIMARY means "newest", not "stable", so promote can pick an image that is mid-rollout or about to be rolled back.
- Regions are exported independently, so different prod regions can receive **different** images.

**Fix:**
- Require `rolloutState == "COMPLETED"` and a single deployment in the source.
- Resolve one tag/digest **across all selected regions** and fail if they differ.
- Better: promote by digest recorded at deploy time (CI-03).

**Acceptance criteria:** Promoting while the source is mid-rollout fails; promoting with mismatched regions fails.

---

### CI-15 — Terraform CI checks thinner than documented 🟡 (new in v2)

**Where:** `check.yml` (terraform-lint job): no `terraform validate`; `tflint` runs with no `.tflint.hcl` and no AWS ruleset. `docs/ci-cd.md` overstates the coverage.

**Fix:**
- Per stack, run `terraform init -backend=false && terraform validate`.
- Add `.tflint.hcl` with `plugin "aws"` (pinned version) and `deep_check` where credentials allow.
- Add the PR plan (CI-02 #3).

**Acceptance criteria:** A typo'd resource attribute fails `Check` on the PR.

---

### CI-16 — No job timeouts; queued runs silently cancelled 🟢 (new in v2)

**Where:** no job in the 12 workflows other than `check.yml` sets `timeout-minutes` (the default is 6 hours). All 10 `check.yml` jobs already set it. All backend/Terraform groups use `cancel-in-progress: false`.

**Problems:**
- A hung apply holds the concurrency lock for 6 hours.
- GitHub keeps only **one pending** run per concurrency group, so a third dispatch silently cancels the queued one. That includes scheduled runs.
- Cancelling a run leaves the ECS rollout going, with no cleanup.

**Fix:**
- Set `timeout-minutes` per job (e.g. Terraform 60, deploy 30, build 30).
- Document the pending-run behaviour.
- Consider failing fast if a run is already queued for the same group.

**Acceptance criteria:** Every job in every workflow sets `timeout-minutes`.

---

### CI-17 — Misc CI hygiene 🟢 (new in v2)

| # | Where | Issue | Fix |
|---|-------|-------|-----|
| a | `check.yml:438-439` | retire.js DB cache key depends only on lockfiles, so the DB can be months old (`check.sh:71-77` refreshes weekly) | Add a week/date component to the cache key |
| b | `check.yml` (CodeQL job) | No `schedule:` trigger; `codeql-action@v3` (v4 is current); `autobuild` is unnecessary for Python/JS | Add a weekly schedule, upgrade, drop autobuild |
| c | `terraform-live-edge.yml:222-224`, `terraform-live-frontend.yml:125-127` | On a fresh environment the plan is **skipped** with a notice, so a full-stack `plan` "passes" without planning those stacks | Fail, or clearly mark the run as partial |
| d | `check.yml:679-687` | DAST service containers have no health checks (unlike `backend-test`), so the job is flaky | Add `options: --health-cmd …` |
| e | `check.yml:847` | dependency-review has `pull-requests: write` but `comment-summary-in-pr` isn't set | Drop the permission, or enable the comment |
| f | `deploy-live-backend.yml:388` | Worker service name from SSM isn't checked as non-empty before `update-service` | Validate it, as the API name is |
| g | matrix jobs with `environment:` | Two prod approvals per deploy run: the build job, then all regional matrix legs together (legs waiting on the same environment are approved in one review) | Single approval gate job, then deploy jobs without re-approval (or a deployment-protection rule) |

---

## Documentation

### DOC-01 — Documentation drift 🟢 (new in v2)

| Doc | Statement | Reality |
|-----|-----------|---------|
| `docs/ci-cd.md:168-169`, `frontend-app/README.md:929`; `docs/environments.md:146` | Wildcard OIDC `sub` (`ci-cd.md`, README); AdministratorAccess (`ci-cd.md:169`, `environments.md:146`) | Insecure; see SEC-04 |
| `docs/ci-cd.md:21` | Restart "picks up … env changes" | Only Secrets Manager values; Terraform env changes need a deploy (TF-02) |
| `docs/ci-cd.md:18-20` | Frontend promotion paths; APK environments | `:18` omits the frontend paths actually allowed (dev↔sbx, dev→stg, sbx→stg, stg→prod); `:19-20` omit sbx for APK builds. (`:17` already lists the backend paths correctly) |
| `docs/ci-cd.md:105`, `docs/code-quality.md:117` | pip-audit ignores PYSEC-2026-175/177/178/179 | CI and `check.sh:197` ignore only PYSEC-2025-183 |
| `docs/code-quality.md:114` | Coverage "not yet gated" | Gated at 99% (`check.sh:169`, `check.yml:116`) |
| `docs/ci-cd.md:136` | dependency-review v4 "posts a comment" | v5, posts nothing |
| `docs/ci-cd.md` | tflint coverage | No config/ruleset (CI-15) |
| `docs/jwt-keys.md` | "zero-downtime rotation" | Logs users out (APP-02) |
| `docs/jwt-keys.md:3` | Refresh/logout/register hints are "unverified" | Signature-verified; only expiry is ignored (`tpl:223`) |
| `docs/infra-operations.md:128` | Worker isn't autoscaled | It is (`autoscaling.tf:159`) |
| `GLOBAL_ROUTING_MONGO*.md`, `docs/infra-architecture-multi-region.md` | Per-location data residency | All data is in ap-south-1 until DB-01 Stage 2 (PRIV-03) |
| `docs/static-assets.md:264` | Production CSP from `frontend/nginx.conf` | Prod is S3 + CloudFront; CSP comes from `response_headers.tf`. `frontend/Dockerfile` is only used by `docker-compose.yml` and CI lint |
| `infra-live-backend/terraform/elasticache.tf:4-12` | Prod t4g.medium, 2 nodes | Tfvars: r6g.4xlarge, 3 nodes |
| `docs/aws-cost-estimate.md` | t4g Redis nodes; stg CloudTrail off; GuardDuty runtime coverage | Tfvars use `cache.t3.*` in dev/sbx/stg (t4g is cheaper); `stg.tfvars:63` enables CloudTrail; Fargate runtime coverage isn't active (SEC-08) |
| `infra-live-scheduler/terraform/lambda.tf:67` | CKV_AWS_116 skip reason | Inaccurate (SCH-01) |
| `backend/app/routers/children.py:473`, `docs/api.md:31` | Soft-deleted children "purged by a scheduled hard-delete job" | No such job exists (PRIV-02) |
| `backend/worker.py:487` | `cleanup_expired_jobs` is "atomic, no race" | Races with late workers; no fencing (JOB-01) |
| `backend/app/routers/admin.py:312-314` | Unlock must clear `tokens_revoked_at` | Wrong; it revives pre-lock sessions (AUTH-03) |
| `backend/app/limiter.py:17-24` (comment) | "Standard proxies prepend the client IP" | CloudFront and ALB **append** (APP-01) |
| `docs/jwt-keys.md:13` | `JWT_PUBLIC_KEYS` is edge-only | The backend has no multi-key support at all (APP-02) |
| `infra-live-backend/terraform/ecs.tf` (worker CKV_AWS_336 skip) | Needs a writable root for bytecode/pip | `PYTHONDONTWRITEBYTECODE=1` is set and pip is removed; re-evaluate the read-only root (L12) |

---

## Low-severity items

| # | Where | Item | Fix |
|---|-------|------|-----|
| L1 | all `provider.tf` | `~> 6.28`, no committed lock file | Commit `.terraform.lock.hcl`; `init -lockfile=readonly` (TF-01) |
| L2 | `default_tags` | Only Project/Environment/ManagedBy | Add `Owner`, `CostCenter`, `Repo`, `DataClassification` |
| L3 | `infra-live-edge/terraform/response_headers.tf:175` | CORS allow-methods omits PUT. The backend has no PUT routes, and CloudFront `allowed_methods` can't drop PUT (it accepts only {GET,HEAD}, {GET,HEAD,OPTIONS} or all 7) | Leave as-is with a comment, or add PUT to CORS for symmetry |
| L4 | `response_headers.tf:88-89` | CSP `img-src https:` and `style-src 'unsafe-inline'` | `img-src 'self' data: blob:`, with APP-08. `blob:` is needed for upload previews (`frontend/src/hooks/useNinetyDayPlan.ts:334`, `URL.createObjectURL`); add the uploads CDN host only if it differs from the SPA host. Keep `style-src 'unsafe-inline'`: the CSP is a static CloudFront policy over S3, so nonces aren't possible, and framer-motion needs inline styles |
| L5 | `response_headers.tf:79,214,252` | HSTS `preload` on a subdomain does nothing | Remove it, or preload the apex deliberately |
| L6 | `infra-live-backend/terraform/variables.tf:194` | `jwt_key_id` description says "CloudFront Function" | Say "Lambda@Edge" |
| L7 | `jwt-validator-lambda.js.tpl:151,155,322` | 503 body leaks the location/region name | Generic message; log details |
| L8 | `elasticache.tf:68` | `engine_version = "7.1"` hard-coded | Variable (Appendix A) |
| L9 | `ecs.tf:123,259` | ADOT image `v0.40.0` hard-coded twice | Variable/local; keep current |
| L10 | `vpc.tf:10` | VPC flow logs disabled (CKV2_AWS_11) | Enable in prod (S3, Parquet) |
| L11 | `autoscaling.tf` | SNS topic unencrypted (CKV_AWS_26) | **Customer-managed** KMS key whose policy allows `cloudwatch.amazonaws.com`. The AWS-managed `alias/aws/sns` key **can't** be used with CloudWatch alarms (v1's suggestion was wrong) |
| L12 | `ecs.tf` (API + worker) | No `readonlyRootFilesystem`, no `stopTimeout`. The container is already non-root (`Dockerfile:42-45`) | Read-only root plus a task-level ephemeral `volume` (no host path) mounted at `/tmp`; Fargate doesn't support `linuxParameters.tmpfs`. `stopTimeout` ≤ 120 (the Fargate maximum); worker see APP-06 |
| L13 | — | v1 said `.DS_Store` files were committed: **wrong**, they're gitignored and untracked | No action |
| L14 | `terraform-live-backend.yml:139-141,279-283`; `docs/ci-cd.md:214-218` | Non-secret config stored as **secrets**: model names, `APP_NAME`, `DOMAIN_NAME`, `SUBDOMAIN`, `HOSTED_ZONE_ID`, ACM ARNs, bucket names, `STATE_BUCKET`, `JWT_PUBLIC_KEYS`. They show as `***` in logs (hard to review) but appear unmasked in the `tfplan.txt` artifact (the ACM ARNs reveal the account ID) | Move to environment **variables** (`vars.*`) |
| L15 | `jwt-validator-lambda.js.tpl:56,60,96` | `${kid}`, `${jwt_key_id}`, `${region}` interpolated into single-quoted JS without `jsonencode` | Use `jsonencode` (as `:87` already does) |
| L16 | `backend/app/services/s3_uploads.py:27-34`; `downloads.py:58` | `get_s3_client` caches one client and ignores later `region` arguments. This is latent today, because every caller passes `settings.aws_region`. `downloads.py:58` creates a new `boto3.client` on **every** request | Cache per region. Update `tests/test_s3_uploads.py:61` (`test_the_first_region_wins_for_the_process_lifetime` pins the current behaviour). Reuse a cached client in downloads |
| L17 | `vpc_endpoints.tf` | No `monitoring` interface endpoint, so `PutMetricData` goes via NAT | Add it in stg/prod |
| L18 | `ecs.tf:240` | Worker receives `JWT_PRIVATE_KEY` it doesn't need (shared `Settings` requires it) | Make it optional for the worker, and don't inject it. `derive_jwt_public_key` and `validate_jwt_private_key` (`settings.py:42-82`) parse it unconditionally, so they must skip an empty key |
| L19 | `ecr.tf` | Basic scan-on-push only; no continuous rescanning | `aws_ecr_registry_scanning_configuration { scan_type = "ENHANCED" }` with a repository filter, in the prod account. It's registry-level (per account and region, not in `ecr.tf`) and replaces basic scan-on-push |
| L20 | `vpc.tf:1` | `aws_availability_zones` doesn't filter `opt-in-status`; opting into a Local Zone would reorder the AZs and shift all subnets | Filter `opt-in-not-required`, or pin AZ IDs |
| L21 | `tfvars/{dev,sbx,stg}.tfvars` | `cache.t3.*` Redis nodes | Switch to `cache.t4g.*` (cheaper, Graviton) |

---

## Suggested implementation order

| Phase | Findings | Why |
|-------|----------|-----|
| **0 — Database (blocker)** | DB-01 **Stage 1** (M10/M20 in ap-south-1; auto-scaling to M30; continuous PITR; cross-region snapshot copy; termination protection; per-service DB users; Atlas CIDR set before cluster creation; runbook Step 0); DEC-01 + DEC-02 **decided and implemented** (if A: prod `backend_regions = ["ap-south-1"]`, per-environment routing mapping every prod location to ap-south-1); PrivateLink in ap-south-1; DB-02 **connection budget + client options (#3)**; TF-03 **#8** (cap ECS max capacity); DR-01 **#5**. If DEC-01 = B: NET-01. If the Atlas public endpoint is used even briefly: DR-02 (static NAT EIPs) | There's no backup of any user or children's data today; the M10/M20 limits define how far everything else can scale |
| **1 — Stop the bleeding** (small, high value) | SEC-04, CI-01 (#1, #2, #7: environment rules + OIDC + plan check), PRIV-01, EDGE-03, EDGE-01 **interim** (explicit `bootstrap_region`), WAF-01 **#1** (body-size override), APP-01, APP-09, CI-11, CI-10, MOB-01 **#3** (remove public builds), SEC-10, DR-01 **(#1–4)**, CI-04, SEC-02, SCH-01 **(#1–2)**, JOB-03 **(#1–3)** | Closes the paths to prod admin, password leaks, live user-facing breakage, spoofable limits and uncapped LLM spend |
| **2 — Pipeline gates** | CI-02, CI-09 (before CI-03's attestations), CI-03, SEC-06, SEC-07, CI-13, CI-12, CI-14, CI-06, CI-15, SEC-05, JOB-07 (current transitions), AUTH-07 | Every later change goes through a reviewed, scanned, digest-pinned path, with fail-fast config |
| **3 — Auth, secrets & data** | EDGE-05, APP-07, PRIV-02, AUTH-02, AUTH-01, AUTH-03, APP-02, EDGE-04, EDGE-02, SEC-01, SEC-03, APP-08, APP-10, AUTH-04, AUTH-05, SEC-08, SEC-09, PRIV-03, PRIV-04, CI-01 **(#3–6)**, WAF-01 **(#2–4)**, MOB-01 **(#1, #2, #4)**, JOB-03 **(#4–5)**, SCH-01 **(#3–5)** | Security posture and legal obligations for real users and children's data |
| **4 — Resilience & correctness** | JOB-01, JOB-02, APP-03, APP-06, DB-02 **(#1, #2, #4, #5)**, DB-03, DB-05, CI-05, CI-07, OBS-01, OBS-02, OBS-03, OBS-04, APP-04, APP-05, AUTH-06, JOB-04, JOB-05, JOB-06, DR-02 (if not done in Phase 0) | Survive a bad release, a Redis/Atlas failover, and duplicate work |
| **5 — Scale & structure** | TF-03 **(#1–7, #9)** (needs DB-02 + JOB-01 + APP-06 first), NET-01 (if not done in Phase 0; before smaller tasks), TF-01 (modules, `moved {}`), TF-02, TF-04, TF-05, TF-06, DB-04 | Large refactors; do them once the gates are in place |
| **6 — Polish** | CI-08, CI-16, CI-17, DOC-01, APP-11, LOW items | Anytime |
| **7 — Global Cluster (future)** | DB-01 **Stage 2** (M30+ Global Cluster), EDGE-01 (full fix), JOB-08, PRIV-03 residency, NET-01 (if DEC-01 = A), re-enable multi-region prod compute (revisit DEC-01), CI-05 prod waves | Only once the M30+ Global Cluster exists |

**Key dependencies:**
- DB-01 Stage 1 → DB-02 budget → TF-03 maximum capacities.
- DEC-01 → DEC-02 → NET-01 urgency (only needed now if DEC-01 = B).
- DB-01 **Stage 2** (M30+ Global Cluster) → EDGE-01, JOB-08, PRIV-03 residency, and returning to multi-region compute if DEC-01 = A.
- Runbook Step 0 (location in indexes and filters) → DB-01 Stage 2 (do it during Stage 1).
- DB-02 + JOB-01 + APP-06 → TF-03 (worker concurrency, Spot).
- EDGE-05 (key-only storage) → APP-07 (delete old objects) → PRIV-02 (S3 cleanup).
- EDGE-04 backend `aud` support → issuing `aud`.
- APP-02 → any JWT key rotation.
- APP-01 → AUTH-04 (per-IP limits must be trustworthy first).

---

## Appendix A — Caching recommendation

### Current state (verified v2)

- `aws_elasticache_replication_group.main`: Redis OSS `7.1`, cluster mode disabled. Prod runs `cache.r6g.4xlarge` × 3 nodes (1 primary + 2 replicas) with multi-AZ (`prod.tfvars:19-21`). Dev/sbx/stg use `cache.t3.*` nodes.
- **What's in Redis today:**
  - LLM sliding-window counters (`app/llm_rate_limiter.py`)
  - slowapi per-route IP/user limits (`app/limiter.py:68-89`)
  - the session-cleanup lock (`app/main.py:68-125`)

  All small, TTL-bound keys. Sessions live in **MongoDB**, the worker queue is the Mongo `jobs` collection, and the worker doesn't connect to Redis.
- `cache.r6g.4xlarge` is about 105 GiB RAM and 16 vCPU per node. Redis executes commands mostly on one thread, so the CPU sits idle and the RAM is almost entirely unused. Three of these nodes cost several thousand USD/month on-demand (check current regional pricing).
- The parameter group is empty, so the default `maxmemory-policy = volatile-lru` applies. That's wrong for a mixed workload.
- Related app issues: APP-04 (permanent fallback after a blip) and APP-05 (sync client in async code).

### Recommendation

**Right now (current keys only):** a small **non-cluster** Valkey primary + 1 replica on `cache.m7g.large` or `cache.r7g.large`, with multi-AZ. Cluster mode is unnecessary for this key volume.

**When application caching grows:** ElastiCache for **Valkey**, cluster mode **enabled**, Graviton `r7g`/`m7g`, scaling **out** with shards.

| Choice | Recommendation | Why |
|--------|----------------|-----|
| **Engine** | **Valkey 8.x** (ElastiCache for Valkey) | Redis-compatible (same `redis-py` client). AWS prices Valkey node-based about 20% lower and Serverless about 33% lower than Redis OSS. Valkey 8 improves multi-threaded I/O. In-place engine upgrade from Redis OSS 7.x is supported. |
| **Topology** | **Cluster mode enabled** (`num_node_groups` + `replicas_per_node_group`) once the data set or throughput outgrows one node | Scale horizontally with online resharding instead of buying ever-bigger nodes |
| **Node family** | **`cache.r7g`** (memory-heavy caching) or **`cache.m7g`** (small working set, throughput-bound) | Graviton3; better price/performance than r6g |
| **Prod start (with app caching)** | **2 shards × (1 primary + 1 replica) of `cache.r7g.large`** (~13 GiB each, ~26 GiB total, ~19.5 GiB usable after 25% reserved memory), multi-AZ | Far cheaper than 3 × r6g.4xlarge; add shards as the data set grows |
| **stg** | 1 shard × (1 + 1) `cache.m7g.large` or `cache.t4g.medium` | Same code path as prod |
| **dev/sbx** | 1 node `cache.t4g.micro`/`small`, no replica | Cost |
| **Alternative** | **ElastiCache Serverless for Valkey** | Good while traffic is unknown or spiky: no capacity planning, multi-AZ built in. Billed per GB-hour + ECPU, so usually pricier at sustained high throughput. No Global Datastore with Serverless. |

### Separate workloads by eviction behaviour

Future caching mixes data with **different durability needs**. Never let cache entries evict rate limits or locks.

| Workload | Example keys | Eviction policy | Where |
|----------|--------------|-----------------|-------|
| Rate limits, quotas, locks, idempotency keys (today's real keys: `llm_rate:{user}` ZSETs, slowapi `rl_ip`/`rl_user` fixed-window keys, `session_cleanup:lock`) | `llm_rate:{user}`, `rl_ip…`, `session_cleanup:lock`, `idem:{req}` | `noeviction` (all have TTLs, so today's `volatile-lru` **can evict rate-limit keys** under memory pressure) | Cluster **A** ("state") |
| Refresh-token denylist (if added) | `revoked:{jti}` | `noeviction` | Cluster **A** |
| Application data cache | user profile, location config, routing, feature flags, computed dashboards/aggregates, Mongo query results | `allkeys-lfu` | Cluster **B** ("cache") |
| LLM response cache | `llm:{model}:{sha256(prompt+params)}` (exact match) | `allkeys-lfu`, TTL hours–days | Cluster **B** |
| Semantic LLM cache (future) | vector similarity on prompt embeddings | `allkeys-lfu` | Cluster **B**: Valkey 8.2+ vector search, or MemoryDB vector search |
| Leaderboards / counters / feeds | sorted sets, HyperLogLog | `noeviction` if source of truth, else LFU | A or B |
| Pub/sub, real-time fan-out | sharded pub/sub | n/a | B |

- **Small scale:** one cluster with `noeviction`. Size it so memory stays under 75%, and give cache keys short TTLs so they **expire** rather than get evicted. Split into two clusters once LRU/LFU caching is needed.

  v5 correction: `volatile-*` would evict today's TTL-bearing state keys.
- **Large scale:** two clusters. A is small with `noeviction`; B is larger with `allkeys-lfu`.
- If any cached data becomes the **primary store** (data you must not lose), use **Amazon MemoryDB (Valkey)**, which has a durable multi-AZ transaction log.

### Sizing method

```
required_memory   ≈ (avg_key + avg_value + ~60–100 B overhead) × key_count
node_memory_need  ≈ required_memory × 1.25 (reserved-memory 25%) × 1.3 (headroom)
shards            = ceil(node_memory_need / usable_memory_per_node)
```

- Keep `DatabaseMemoryUsagePercentage` < 75% and `EngineCPUUtilization` < 70%; add a shard when either trends higher.
- Alarm on:
  - `Evictions` (> 0 on the state cluster is an incident)
  - `CurrConnections`
  - `ReplicationLag`
  - `CacheHitRate` (cache cluster)

### Multi-region

- Data lives in MongoDB Atlas, so a **region-local cache** per backend region is right for most data. Accept per-region misses.
- Rate limits are per region today. For **global** per-user limits, route users to their home region (the edge already does this by location for authenticated traffic). The unauthenticated login limits remain per region (EDGE-01).
- Global Datastore is node-based only, has one writer region and about 1 s replication lag. It's fine for **read-mostly cache data**, but **not for rate limiting**: secondary regions are read-only, so `INCR`/`EVAL` from those regions would fail and every limiter would fall back to in-memory. (v3 correction: v2 suggested it for rate limits.)
- The session-cleanup lock is per region (each region's Redis), not global (AUTH-06).

### App changes this implies

1. If cluster mode is enabled:
   - use a cluster-aware client (`redis.asyncio.cluster.RedisCluster`) for `llm_rate_limiter.py:101` (`redis.Redis.from_url`) and the session-cleanup lock. slowapi needs **sync** storage via `redis+cluster://` (or replace it, per APP-05). Today's URL is `rediss://` (`ecs.tf:72`): check how the pinned `limits` version enables TLS for cluster URIs (*uncertain*);
   - the LLM Lua script touches a single key, so it is already cluster-safe;
   - pin the `limits` package, which isn't pinned today, while `_hit` depends on slowapi private attributes;
   - point the limiter's `storage_uri` at `redis+cluster://…` (slowapi/limits);
   - connect to the **configuration endpoint** (`configuration_endpoint_address`) instead of `primary_endpoint_address` (`infra-live-backend/terraform/ecs.tf`, `REDIS_URL`).
2. **Hash tags** for multi-key ops, e.g. `rl:{user123}:hour` and `rl:{user123}:day`.
3. A cache-aside helper with TTL + jitter and **stampede protection** (single-flight lock or probabilistic early refresh).
4. Versioned keys (`v1:profile:{id}`) for invalidation on deploy.
5. An async client and reconnect logic (APP-04, APP-05).
6. Keep TTLs short for children's PII; encryption at rest is already enabled.

### Terraform sketch

```hcl
resource "aws_elasticache_replication_group" "cache" {
  replication_group_id       = "${var.app_name}-cache-${var.environment}"
  description                = "Application cache (${var.environment})"
  engine                     = "valkey"
  engine_version             = var.cache_engine_version # e.g. "8.1"
  node_type                  = var.cache_node_type      # prod: cache.r7g.large
  cluster_mode               = "enabled"
  num_node_groups            = var.cache_shards         # prod: 2
  replicas_per_node_group    = var.cache_replicas       # prod: 1
  automatic_failover_enabled = true                     # required for cluster mode
  multi_az_enabled           = var.cache_replicas > 0
  parameter_group_name       = aws_elasticache_parameter_group.cache.name
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.elasticache_sg.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  # Auth: prefer RBAC user groups (user_group_ids) managed outside state — see SEC-01.
  snapshot_retention_limit   = var.environment == "prod" ? 1 : 0
  apply_immediately          = false
}

resource "aws_elasticache_parameter_group" "cache" {
  name   = "${var.app_name}-cache-valkey8-${var.environment}"
  family = "valkey8"

  parameter {
    name  = "cluster-enabled"
    value = "yes"
  }
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lfu"
  }

  lifecycle {
    create_before_destroy = true
  }
}
```

⚠️ **Migration pitfalls:**
- **Cluster mode:** ElastiCache supports **online** migration from cluster-mode disabled → `compatible` → `enabled` on Redis OSS 7.x / Valkey (the provider exposes this as `cluster_mode`). Verify it in stg; clients must be cluster-aware **before** switching to `enabled`. v1 said it couldn't be done in place, which is outdated. A side-by-side cutover (new cluster → switch `REDIS_URL` → delete old) is still the simplest option for ephemeral rate-limit keys.
- **Parameter-group family change** (`redis7` → `valkey8`) replaces the parameter group. Use a new name plus `create_before_destroy` so the apply doesn't fail while the old group is still attached.
- **Engine change Redis → Valkey:** upgrade in place (`engine = "valkey"`) in stg first. Watch for client compatibility with `AUTH`/RBAC.
