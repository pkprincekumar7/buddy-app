# Multi-Region Edge Routing — Design & Implementation Plan

This document is the single source of truth for the multi-region deployment architecture.
It covers the full rationale, updated architecture diagram, and every infra and code change
required. When implementing, refer only to this file.

---

## Background & Decision Trail

### Why not API Gateway with a Lambda Authorizer?

#### Architecture difference

The current plan: `CloudFront → [L@E: JWT + geo-route] → regional ALB → ECS`

API GW alternative: `CloudFront → [L@E: geo-route only] → regional API GW → [Lambda Authorizer: JWT] → ECS`

API GW does not eliminate Lambda@Edge. Something at the CloudFront layer still needs to
select the right regional API GW endpoint. The result is two auth-adjacent functions
instead of one.

#### Pricing

| Item | Lambda@Edge | API Gateway + Lambda Authorizer |
|---|---|---|
| Request cost | $0.60/M | HTTP API: $1.00/M (first 300M), $0.90/M thereafter **per region**; REST API: $3.50/M (first tier), $2.80/M, $2.38/M at higher volumes **per region** |
| Authorizer invocations | n/a | +$0.20/M (standard Lambda invocation price — billed through Lambda, not API GW) |
| Duration cost | $0.00000625125/128MB-sec | Same Lambda pricing, but 3 separate functions across 3 regions |
| Geo-routing | Included (same function) | Still needs a separate L@E — additional cost |
| Regions | 1 function, AWS replicates to all edges | 3 separate deployments (ap-south-1, eu-west-1, us-east-1) |

API GW adds at minimum $1.00/M (HTTP API) or $3.50/M (REST API) per region on top of
CloudFront which is already paid for. Even at the highest-volume REST API tier ($2.38/M),
adding 3 regional deployments plus Lambda Authorizer invocations still exceeds L@E at
$0.60/M. API GW is additive — CloudFront is not replaced, API GW is stacked on top of it.

#### Performance

| Dimension | Lambda@Edge | API Gateway + Lambda Authorizer |
|---|---|---|
| Where validation runs | Nearest CloudFront PoP to the user (100+ globally) | Regional endpoint (3 fixed locations) |
| Added latency | ~2–10 ms at edge | ~5–15 ms at regional API GW + authorizer invocation |
| Cold start | ~1–5 ms (Node.js, small) | ~50–100 ms (500 ms+ if authorizer uses VPC) |
| Result caching | None — every request is validated | Configurable TTL — reduces Lambda invocations but delays token revocation |

Edge validation is always closer to the user than a regional API GW. The caching
argument cuts both ways: it reduces Lambda invocations but means a revoked token stays
valid until TTL expires.

#### Complexity

| Dimension | Lambda@Edge | API Gateway + Lambda Authorizer |
|---|---|---|
| Infrastructure added | 1 Lambda + CloudFront association | 3 API GWs + 3 Lambda Authorizers + IAM per region + separate L@E for geo-routing |
| Terraform | ~50 lines | ~200+ lines across 3 regions + new modules |
| Log aggregation | CloudWatch in whichever region processed the request (can be any of ~20 regions) | Predictable: 3 fixed regions |
| Code changes | One file to update | 3 authorizer functions to keep in sync |

#### Security

| Dimension | Lambda@Edge | API Gateway + Lambda Authorizer |
|---|---|---|
| Where bad requests are blocked | At the nearest edge PoP — never reaches the VPC | At regional API GW — after CloudFront but still reaches the AWS network boundary |
| Token revocation | Immediate (no cache) | Delayed if authorizer caching TTL > 0 |
| Attack traffic | Absorbed at CloudFront + WAF — ALB and ECS never see invalid-JWT traffic | Absorbed at API GW — still consumes API GW and Lambda capacity |

#### When API Gateway Lambda Authorizer would be the right choice

- Already using API GW for other features (request transformation, usage plans, developer
  portal, SDK generation) — authorizer becomes an add-on to an existing investment.
- Need to update authorizer config at runtime without a Terraform apply and CloudFront
  propagation wait.
- Tokens are short-lived (< 5 min) and result caching is acceptable — very high-traffic
  apps where the same token repeats across many requests.

None of these apply to this project. API GW + Lambda Authorizer would cost more, add
latency, double the infrastructure, and still require Lambda@Edge for geo-routing. The
implemented solution — one combined L@E function (at `viewer-request`, not `origin-request`
— see "Why not two separate Lambda@Edge functions?" below) — is the minimal correct solution.

---

### Why not CloudFront Functions for JWT auth?

CloudFront Functions run in a sandboxed ES5.1 runtime. RS256 JWT verification requires
`crypto.verify()`, `Buffer`, and RSA-PKCS#1 PEM key parsing — none of which exist in
that runtime. Switching to HS256 (HMAC) would require embedding the shared secret inside
the function code, which is exposed in Terraform state. CloudFront Functions were
evaluated and ruled out for this reason.

### Why not two separate Lambda@Edge functions?

The original V2 plan placed JWT auth at `viewer-request` and geo-routing at
`origin-request`. This adds two sequential Lambda invocations per request.

**Implemented resolution — combined at `viewer-request`, not moved to `origin-request`:**
the actual `jwt-validator-lambda.js.tpl` combines both concerns into one function, same
as this section originally argued for, but the function stayed at `viewer-request`
(confirmed in `infra-live-edge/terraform/cloudfront.tf`'s `lambda_function_association`)
rather than moving to `origin-request` as first proposed. The reasoning below for why
`origin-request` would have been *safe* (cache disabled on `/api/*`) still holds, but the
codebase never made that particular move — combining the two concerns into a single
invocation delivered the goal (one Lambda invocation per request, not two) without it.

**Architectural constraint (still holds regardless of event stage):** Enabling a cache
policy on any authenticated endpoint in the future would bypass this Lambda entirely for
cached responses. This is a hard rule: all `/api/*` behaviours must keep
`cache_policy_id = local.cache_policy_disabled`.

### Why JWT `location` claim for routing instead of IP geo?

Pure IP geo routing (CloudFront-Viewer-Country) routes based on where the user
currently is, not where their data lives. A user registered in India (data in Atlas APAC
zone, `location=in`) travelling to the UK would be routed to eu-west-1, causing every
MongoDB read to cross regions (~150–200 ms penalty). The JWT access token already
carries a `location` claim (set at login from the user's stored `location` field in the
users collection). The combined L@E function decodes the token for auth anyway, so
reading `payload.location` for routing is free. There is no IP-geo fallback in the actual
implementation (see Change 1 and the corrected "Fallback behaviour" note above) — `login`/
`google`/`health` always land on the static bootstrap origin unchanged, while `register`/
`refresh`/`logout` use a session-cookie or client-header location *hint* instead of IP geo.

---

## Updated Architecture

```
                              Users (global)
                                    │
                          ┌─────────▼──────────┐
                          │     Route 53        │
                          │      (DNS)          │
                          └─────────┬──────────┘
                                    │ HTTPS
                          ┌─────────▼──────────┐
                          │     CloudFront      │
                          │  + WAF WebACL       │
                          │  (us-east-1/global) │
                          └──────┬─────────┬───┘
                       /api/*    │         │   /*
                  ┌──────────────┘         └──────────────────────┐
                  │                                                 │
                  ▼                                                 ▼
        ┌───────────────────────────────┐    ┌─────────────────────────┐
        │       Lambda@Edge             │    │  S3 — frontend assets   │
        │  viewer-request (single fn)   │    │  (us-east-1)            │
        │                               │    │  OAC — no public access │
        │  Bypass paths (login/google/  │    └─────────────────────────┘
        │  health): pass through        │
        │  unchanged — no auth, no      │
        │  routing                      │
        │                               │
        │  Refresh/logout/register:     │
        │    • best-effort location     │
        │      HINT from an existing    │
        │      cookie/Bearer token, or  │
        │      (register only)          │
        │      X-Client-Location header │
        │    • never blocks; no hint    │
        │      → falls through to the   │
        │      static bootstrap origin  │
        │                               │
        │  All other /api/*:            │
        │    • extract access_token     │
        │      cookie / Bearer header   │
        │    • verify RS256 sig + exp   │
        │    • 401 on failure           │
        │    • resolve payload.location │
        │      → regional ALB           │
        │    • 503 if location unmapped │
        │      or region undeployed     │
        │      (no default fallback)    │
        │    • attach X-Origin-Verify   │
        │      header to the ALB origin │
        └───────────────┬───────────────┘
                        │ HTTPS/443 to region-specific ALB
                        ▼

── Backend VPC layout (ECS in private subnets, NAT Gateway for egress) ──

╔═══════════════════════════╦═══════════════════════════╦═══════════════════════════╗
║   ap-south-1              ║   eu-west-1               ║   us-east-1               ║
║   (Mumbai)                ║   (Ireland)               ║   (N. Virginia)           ║
║   3 AZs · 5 VPC endpoints ║   3 AZs · 5 VPC endpoints ║   3 AZs · 5 VPC endpoints ║
║   + 1 Atlas PrivateLink   ║   + 1 Atlas PrivateLink   ║   + 1 Atlas PrivateLink   ║
╠═══════════════════════════╬═══════════════════════════╬═══════════════════════════╣
║ VPC                       ║ VPC                       ║ VPC                       ║
║  [public subnet]          ║  [public subnet]          ║  [public subnet]          ║
║  ALB (HTTPS/443)          ║  ALB (HTTPS/443)          ║  ALB (HTTPS/443)          ║
║  NAT Gateway × 3          ║  NAT Gateway × 3          ║  NAT Gateway × 3          ║
║  [private subnet]         ║  [private subnet]         ║  [private subnet]         ║
║  ECS Fargate (API+worker) ║  ECS Fargate (API+worker) ║  ECS Fargate (API+worker) ║
║  Redis (in-VPC)           ║  Redis (in-VPC)           ║  Redis (in-VPC)           ║
║  VPC Interface Endpoints  ║  VPC Interface Endpoints  ║  VPC Interface Endpoints  ║
║  (ECR, SM, CW, X-Ray)     ║  (ECR, SM, CW, X-Ray)     ║  (ECR, SM, CW, X-Ray)     ║
║  Atlas PrivateLink EP     ║  Atlas PrivateLink EP     ║  Atlas PrivateLink EP     ║
╚═══════════════════════════╩═══════════════════════════╩═══════════════════════════╝

  AWS service traffic (ECR image pull, Secrets Manager, CloudWatch, X-Ray):
    ECS ──VPC Interface Endpoint──▶ AWS backbone (never leaves VPC)

  External internet traffic (LLM API calls — OpenAI, Anthropic, Gemini):
    ECS ──NAT Gateway──▶ internet

  MongoDB traffic:
    ECS ──Atlas PrivateLink──▶ Atlas backbone (never traverses public internet or NAT)

         │PrivateLink       │PrivateLink       │PrivateLink
         ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────┐
│             MongoDB Atlas — Global Cluster             │
│   sharded by `location` field · zone-aware routing     │
├──────────────────┬──────────────────┬──────────────────┤
│   Zone: APAC     │    Zone: EU      │  Zone: Americas  │
│  (ap-south-1)    │  (eu-west-1)     │  (us-east-1)     │
│  location: in    │  location: eu    │  location: us    │
│  location: apac  │  location: me    │  location: br    │
├──────────────────┴──────────────────┴──────────────────┤
│         cross-zone replication (Atlas managed)         │
└────────────────────────────────────────────────────────┘

  cn / ru: excluded, not assigned to any zone — see the Location → ALB region
  mapping table below (same exclusion enforced at the edge, for the same reason).
```

This whole diagram is the **target** state, not what's running today. Only ap-south-1
is live currently (single region, no PrivateLink); the eu-west-1/us-east-1 columns in
the backend VPC layout and the entire MongoDB Atlas Global Cluster box are all
bootstrap work — see the Deployment Order and Required Changes sections below for
exactly what's missing and in what order it needs to be built.

**TLS chain:**
```
Browser ──HTTPS──▶ CloudFront ──[L@E viewer-request: JWT auth + geo-route]──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)                                                  (region ACM cert)
```

**Location → ALB region mapping (as implemented in `jwt-validator-lambda.js.tpl`'s
`LOCATION_TO_REGION`):**

| JWT `location` value | Routed to ALB region |
|---|---|
| `in` | ap-south-1 |
| `apac` | ap-south-1 |
| `me` | ap-south-1 |
| `eu` | eu-west-1 |
| `us` | us-east-1 |
| `br` | us-east-1 |
| `cn` | **not routed — 503** (China needs AWS's separate China partition, unreachable from this infrastructure) |
| `ru` | **not routed — 503** (serving Russia from a commercial region carries OFAC/EAR export-control exposure this business has decided not to take on) |
| any other unmapped location, or a region not yet deployed | **not routed — 503** (no default-region fallback; see below) |

This differs from an earlier version of this table in two ways worth calling out
explicitly: `me` (Middle East) is grouped with `ap-south-1`, not `eu-west-1`; and `cn`/`ru`
are deliberately excluded rather than mapped anywhere — both are compliance decisions
made in the code, not omissions.

**Fallback behaviour — no IP-geo routing exists.** The implementation does **not** use
`CloudFront-Viewer-Country` or any country-to-region map. Instead:
- `PURE_BYPASS_PATHS` (login, google, health) and any authenticated `/api/*` request
  whose location is unmapped or undeployed never get `request.origin` rewritten by the
  Lambda at all — they fall through to the CloudFront distribution's own statically
  configured origin, `local.bootstrap_region = var.backend_regions[0]` (the first region
  in the currently-applied `backend_regions` list; see `infra-live-edge/terraform/cloudfront.tf`).
  An authenticated request with an unmapped/undeployed location gets a 503 instead of
  silently landing on the bootstrap region — the bootstrap-region fallback only applies
  to unauthenticated bypass paths.
- `LOCATION_AWARE_PUBLIC_PATHS` (refresh, logout) and `register` use a **session hint**
  instead: if an existing `access_token`/`refresh_token` cookie or `Authorization: Bearer`
  header carries a valid signature (expiry ignored — staleness doesn't matter for a
  routing hint), its `location` claim is used to pick the ALB, even though the token
  itself no longer authenticates anything. `register` additionally falls back to a
  client-supplied `X-Client-Location` header. No hint found → same bootstrap-region
  fallback as above, never blocked.

---

## Deployment Order

The full sequence interleaves `terraform-atlas` runs (Atlas PrivateLink initiation +
handshake) with `infra-live-backend` runs across a 6-phase pattern (each phase fully
specified below). `infra-live-edge` runs last once all three backends have published
their ALB FQDNs to SSM.

```
Phase 0  — Atlas tier upgrade + terraform-atlas bootstrap   ← not started
           Today's cluster is Atlas M0 (free tier), managed manually, single region
           (ap-south-1) — there is no Atlas Terraform module in this repo at all yet.
           M0 does not support Global Clusters, custom zone sharding, or PrivateLink;
           all three require upgrading to a paid, dedicated tier first. This is a real
           cost decision to make explicitly, not a config toggle — see Change 10d.
           Only after the tier upgrade does `infra-live-atlas` get created (from
           scratch) and `terraform-atlas.yml` get written (also from scratch — it does
           not exist yet either; see the note under Change 10d).

Phase 1a — terraform-atlas (ap-south-1, Phase 1 run)   ← blocked on Phase 0
           Registers ap-south-1 PrivateLink with Atlas; writes endpoint_service_name to SSM.

Phase 1b — terraform-atlas (eu-west-1,  Phase 1 run)
Phase 1c — terraform-atlas (us-east-1,  Phase 1 run)
           Same as 1a for each new region (adds mongodbatlas_privatelink_endpoint per region).
           Each writes /{app}/{env}/atlas/{region}/endpoint_service_name to SSM.

Phase 2a — terraform-live-backend (ap-south-1)         ← blocked on Phase 1a
Phase 2b — terraform-live-backend (eu-west-1)
Phase 2c — terraform-live-backend (us-east-1)
           Each reads atlas/{region}/endpoint_service_name from SSM, creates aws_vpc_endpoint,
           and writes atlas_vpc_endpoint_id + nat_eip_addresses + secrets_manager_arn to SSM.
           Must run after the corresponding Phase 1 step.

Phase 3  — terraform-live-edge
           Reads all three alb_internal_fqdn SSM parameters (written by Phases 2a–2c).
           Fails at plan time if any SSM parameter is missing.

Phase 4  — deploy-live-backend + deploy-live-frontend  (per region)

Phase 5a — terraform-atlas (ap-south-1, Phase 5 run)   ← blocked on Phase 2a
Phase 5b — terraform-atlas (eu-west-1,  Phase 5 run)
Phase 5c — terraform-atlas (us-east-1,  Phase 5 run)
           Each reads atlas_vpc_endpoint_id from SSM (written by Phase 2), completes the
           PrivateLink handshake, rotates MONGODB_URI in Secrets Manager to private SRV.

Phase 6  — restart-live-backend (per region, both services)
           Force-restarts ECS tasks so they pick up the private MONGODB_URI.
```

> **ap-south-1 prerequisite:** phase 0 (Atlas tier upgrade + Terraform bootstrap) and
> phases 1a, 2a, 5a, and 6 for ap-south-1 must all be completed before expanding to new
> regions — none of these have started. Confirmed by checking the actual repo state:
> there is no `infra-live-atlas` directory, no `terraform-atlas.yml` workflow, and no
> `aws_vpc_endpoint`/PrivateLink resources anywhere in `infra-live-backend`. The existing
> MongoDB setup is a manually-managed Atlas **M0 (free tier)** cluster, single region —
> not yet sharded or multi-region at the database layer, and M0 cannot support Global
> Clusters, sharding, or PrivateLink until upgraded (see Change 10d). A broader
> zone-sharding scheme exists elsewhere spanning up to 8 zones across roughly 10 AWS
> regions; that is wider than the 3-region target here and out of scope for this doc —
> the zones this doc uses are capped at exactly ap-south-1/eu-west-1/us-east-1 (see
> Change 10d). The application layer is ahead of the database layer here: `location` is
> already captured on every token and user record (Change 9), specifically so this
> future infra work is the only piece left to do — see Change 10d for what that involves.

Do not apply `infra-live-edge` until phases 2a–2c are complete. The Terraform
`data.aws_ssm_parameter` reads fail at plan time if any SSM parameter is missing.

---

## Required Changes

> **Status: items 1–8 below are implemented — but differently, and more robustly, than
> originally proposed here.** The sections below have been rewritten to describe the
> actual current implementation rather than the stale plan. The real design generalizes
> to any number of regions via `var.backend_regions` (not three hardcoded ALB variables),
> fails closed with a 503 on an unmapped/undeployed location instead of silently
> defaulting to `ap-south-1`, adds an `X-Origin-Verify` shared-secret header the original
> plan never had, and never moved the Lambda from `viewer-request` to `origin-request`
> (see "Why not two separate Lambda@Edge functions?" above). Item 9 (backend) was already
> accurate and needed no change. Only the MongoDB Atlas/PrivateLink work (Change 10d, and
> the `atlas_endpoint_service_name` piece of Change 10) remains genuinely not started —
> confirmed by `infra-live-atlas/` still not existing in the repo.

### 1. `infra-live-edge/functions/jwt-validator-lambda.js.tpl` — implemented (not renamed)

The file was **not** renamed to `jwt-geo-router-lambda.js.tpl` — it's still
`jwt-validator-lambda.js.tpl`, and it combines JWT auth + geo-routing in one
`viewer-request` function, same goal as originally proposed but a different shape.
Key differences from the plan, all confirmed against the real file:

- **Per-region map, not three hardcoded variables.** `REGIONAL_ALB_FQDNS` is built from a
  `regional_alb_fqdns` map template variable (one entry per region actually in
  `var.backend_regions`), not `alb_ap_south_1`/`alb_eu_west_1`/`alb_us_east_1`. This is
  what lets the edge module support 1, 2, or 3 deployed backend regions without a code
  change.
- **Three path classes, not "public vs. authenticated."** `PURE_BYPASS_PATHS` (login,
  google, health) always pass through unchanged — no auth, no routing.
  `LOCATION_AWARE_PUBLIC_PATHS` (refresh, logout) and `REGISTER_PATH` (register) use a
  best-effort **location hint** from an existing session cookie or `Authorization: Bearer`
  token (expiry ignored — a stale-but-validly-signed token is still a trustworthy routing
  hint even though it can no longer authenticate anything); `register` additionally falls
  back to a client-supplied `X-Client-Location` header. None of these three ever block the
  request — no hint found just leaves `request.origin` untouched. Every other `/api/*`
  path requires a valid, unexpired token or gets a 401.
- **No IP-geo fallback exists.** There is no `CloudFront-Viewer-Country` read and no
  `COUNTRY_TO_REGION` map anywhere in the function. The "fallback" for bypass/no-hint
  cases is simply not rewriting `request.origin`, which leaves it at whatever the
  CloudFront distribution's own `alb-backend` origin is statically configured to (see
  Change 4 below) — currently `var.backend_regions[0]`.
- **Fails closed, no default region.** An authenticated request whose `location` claim
  isn't in `LOCATION_TO_REGION`, or whose mapped region isn't in `REGIONAL_ALB_FQDNS`
  (not yet deployed), gets a 503 with an explanatory message — never a silent
  default-region guess. See the corrected location-mapping table above for exactly which
  locations map where (notably: `cn`/`ru` are deliberately excluded, not defaulted).
- **`X-Origin-Verify` header.** Every resolved origin gets a `customHeaders` entry
  carrying a shared secret (`ORIGIN_VERIFY_SECRET`, injected via Terraform from the
  `ORIGIN_VERIFY_SECRET` GitHub Environment Secret — same value on both `infra-live-edge`
  and `infra-live-backend`). The backend ALB has a listener rule that 403s any request
  missing or mismatching this header, so traffic reaching the ALB via CloudFront's shared
  IP range but *not* through this app's own distribution (and therefore never through this
  Lambda's JWT check) is rejected before it reaches ECS. The original plan had no
  equivalent to this.
- **Mobile support.** Bearer-token extraction is checked identically to the cookie path
  throughout — the mobile app has no cookie jar, so it sends its access/refresh token as
  `Authorization: Bearer` instead. The `setOrigin()` helper's comment also documents why
  it never sets the `Host` header: it's read-only in `viewer-request` events, and setting
  it would 502 — CloudFront auto-sends the origin's own `domainName` as `Host` for a
  custom origin regardless.

---

### 2. `infra-live-edge/terraform/lambda_edge.tf` — implemented in-place, as originally recommended

The recommendation to update resources in-place rather than rename them (Lambda@Edge
can't be destroyed while CloudFront replicas exist) was followed. The `archive_file`
source still points at `jwt-validator-lambda.js.tpl` (never renamed — see Change 1) and
its template variables are `jwt_public_keys`, `jwt_key_id`, `regional_alb_fqdns` (a map,
not three scalars), and `origin_verify_secret`. `aws_iam_role`,
`aws_iam_role_policy_attachment`, `aws_lambda_function`, and `time_sleep` are unchanged in
shape, as predicted. The CloudFront `lambda_function_association` (Change 4) points at
`aws_lambda_function.jwt_validator.qualified_arn`, exactly as planned.

---

### 3. `infra-live-edge/terraform/ssm_read.tf` — implemented, generalized to N regions

The real file is a single `for_each` block, not three named data sources:

```hcl
data "aws_ssm_parameter" "alb_internal_fqdn" {
  for_each = toset(var.backend_regions)
  name     = "/${var.app_name}/${var.environment}/backend/${each.key}/alb_internal_fqdn"
}

locals {
  regional_alb_fqdns = { for region, param in data.aws_ssm_parameter.alb_internal_fqdn : region => param.value }
}
```

This reads exactly one SSM parameter per region in `var.backend_regions` — whatever that
list currently contains, not a fixed three. The `regional_alb_fqdns` local feeds directly
into the Lambda template variable of the same name (Change 1/2).

---

### 4. `infra-live-edge/terraform/cloudfront.tf` — implemented, but the Lambda stayed at `viewer-request`

**The event type was not changed.** `lambda_function_association.event_type` is still
`"viewer-request"` — the move to `origin-request` proposed here never happened (see "Why
not two separate Lambda@Edge functions?" above for the reconciled rationale). The
`alb-backend` origin's `domain_name` does reference `local.regional_alb_fqdns[local.bootstrap_region]`
(`bootstrap_region = var.backend_regions[0]`), matching this section's original intent
that the declared origin only matters as a static fallback, with the Lambda dynamically
overriding it per request. No new origin blocks were added — confirmed correct as planned.

---

### 5. `infra-live-edge/terraform/variables.tf` — implemented

`backend_region` (singular) no longer exists. It was replaced by `backend_regions`
(plural, a validated list — `length > 0` and every entry one of `ap-south-1`/`eu-west-1`/
`us-east-1`), not by removing region-parameterization entirely.

---

### 6. `.github/workflows/terraform-live-edge.yml` — implemented, generalized

`backend_region` is gone from every place this section listed. In its place,
`backend_regions` is a **JSON array** workflow input (e.g. `'["ap-south-1","eu-west-1"]'`),
threaded through `run-name`, the `env` block (`TF_VAR_backend_regions`), the SSM
verification step (loops over `jq -r '.[]'` on the JSON array instead of three hardcoded
`check_ssm` calls), and the plan/destroy summary and artifact-name strings. The net effect
matches this section's intent (verify + reflect whichever regions are involved) but scales
to any subset of the three regions, not just "all three."

---

### 7. `.github/workflows/terraform-live-all.yml` — implemented, with flexible region selection

`backend_region` is gone here too, replaced by the same `backend_regions` JSON-array input,
`fromJson()`'d where a matrix over regions is needed (backend apply/destroy jobs). The
`aws_region`/region-choice dropdown offers single regions and multi-region combinations
(e.g. `'["ap-south-1"]'`, `'["ap-south-1","eu-west-1"]'`) rather than a fixed 3-option list —
more flexible than this section's original "add the two new regions" proposal. The
sequencing note (can't bootstrap all regions in one `terraform-live-all` run before each
backend region's SSM parameter exists) still holds and is unchanged.

---

### 8. `infra-live-edge/terraform/tfvars/` — confirmed no changes needed

Still accurate as originally written: no tfvars file carries region configuration —
`backend_regions` is supplied entirely via the workflow input (`TF_VAR_backend_regions`),
not any tfvars file.

---

### 9. Backend — no changes required

The JWT `location` claim is already present in every access token. From
`backend/app/auth_utils.py`:

```python
payload = {
    "sub": sub,
    "iat": now,
    "exp": expire,
    "type": "access",
    "location": location,   # ← already set at token creation
}
```

The `location` value is set from the user's `location` field in the users collection,
which is written at registration time via `backend/app/routing.py:resolve_region()`.
No backend changes are needed.

---

### 10. `infra-live-backend/` — activate two new regions

The backend module is region-agnostic (`var.aws_region`). It publishes
`alb_internal_fqdn` to SSM at `/{app_name}/{environment}/backend/{aws_region}/alb_internal_fqdn`
(confirmed in `infra-live-backend/terraform/ssm_write.tf`). The following changes are
required before applying in new regions:

**a. `infra-live-backend/terraform/variables.tf`** — the region-validation part is
**already done**; the Atlas part is not:

✅ Done — the `aws_region` validation already allows all three regions (confirmed in the
real file, and its description already documents the per-region-stack design accurately,
with no stale `backend_region`-referencing comment left):
```hcl
validation {
  condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
  error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
}
```

❌ Still needed — the `atlas_endpoint_service_name` variable does not exist yet:
```hcl
# Set via SSM from terraform-atlas Phase 1. Empty until Phase 1 has run —
# aws_vpc_endpoint (Atlas PrivateLink) is skipped via count=0.
variable "atlas_endpoint_service_name" { default = "" }
```

This variable would be consumed by `aws_vpc_endpoint.atlas_privatelink` — the Interface
endpoint + its security group that must be added to `infra-live-backend` before
completing PrivateLink. Confirmed absent: no `atlas_endpoint_service_name`,
`atlas_privatelink`, or `mongodbatlas` reference exists anywhere in
`infra-live-backend/terraform/`. See Change 10d Step 2 for the full resource definition.

**b. `.github/workflows/terraform-live-backend.yml`**:

✅ Done — **b1.** `aws_region` workflow_dispatch already offers all three regions:
```yaml
options:
  - ap-south-1
  - eu-west-1
  - us-east-1
```

❌ Still needed — **b1b. "Resolve Atlas SSM inputs" step** — this step does **not** exist in the workflow
yet and needs to be added. Use the **region-specific SSM path** from the start — a
shared path with no region segment would get overwritten every time a different
region's run wrote to it. The step to add (after "Resolve ops email", before "Setup
Terraform"):

```yaml
- name: Resolve Atlas SSM inputs
  if: inputs.action == 'plan' || inputs.action == 'apply'
  run: |
    APP="${{ secrets.APP_NAME }}"
    ENV="${{ inputs.environment }}"
    REGION="${{ inputs.aws_region }}"

    ENDPOINT_SVC=$(aws ssm get-parameter --region us-east-1 \
      --name "/$APP/$ENV/atlas/$REGION/endpoint_service_name" \
      --query "Parameter.Value" --output text 2>/dev/null || echo "")

    if [[ -z "$ENDPOINT_SVC" ]]; then
      echo "WARNING: atlas/$REGION/endpoint_service_name not in SSM."
      echo "Run terraform-atlas (Phase 1) for $REGION before terraform-live-backend."
      echo "Continuing — aws_vpc_endpoint (Atlas PrivateLink) will be skipped (count=0)."
    fi

    echo "TF_VAR_atlas_endpoint_service_name=$ENDPOINT_SVC" >> "$GITHUB_ENV"
    echo "atlas endpoint_service_name: ${ENDPOINT_SVC:-(not set)}"
```

> **Path format matters here:** use `/$APP/$ENV/atlas/$REGION/endpoint_service_name`
> (region segment included), not `/$APP/$ENV/atlas/endpoint_service_name` (no region) —
> the no-region form only works for a single active region and would get silently
> overwritten by whichever region's Phase 1 ran most recently once there are three.

**"Write Atlas and infra SSM outputs" step** — this step also does not exist yet. Add it
after the existing "Initialise app secrets" step:

```yaml
- name: Write Atlas and infra SSM outputs
  if: inputs.action == 'apply'
  run: |
    APP="${{ secrets.APP_NAME }}"
    ENV="${{ inputs.environment }}"
    REGION="${{ inputs.aws_region }}"

    # Atlas PrivateLink VPC endpoint ID — read by terraform-atlas Phase 5
    VPC_EP=$(terraform output -raw atlas_vpc_endpoint_id 2>/dev/null || echo "")
    if [[ -n "$VPC_EP" ]]; then
      aws ssm put-parameter --region us-east-1 \
        --name "/$APP/$ENV/backend/$REGION/atlas_vpc_endpoint_id" \
        --value "$VPC_EP" --type String --overwrite
      echo "Written: /$APP/$ENV/backend/$REGION/atlas_vpc_endpoint_id = $VPC_EP"
    fi

    # NAT EIP public IPs — read by terraform-atlas for ip_access_list
    NAT_EIPS=$(terraform output -json nat_eip_public_ips 2>/dev/null | jq -r 'join(",")' || echo "")
    if [[ -n "$NAT_EIPS" ]]; then
      aws ssm put-parameter --region us-east-1 \
        --name "/$APP/$ENV/backend/$REGION/nat_eip_addresses" \
        --value "$NAT_EIPS" --type String --overwrite
      echo "Written: /$APP/$ENV/backend/$REGION/nat_eip_addresses = $NAT_EIPS"
    fi

    # Secrets Manager ARN — read by terraform-atlas Phase 5 to rotate MONGODB_URI
    SM_ARN=$(terraform output -raw secrets_manager_arn 2>/dev/null || echo "")
    if [[ -n "$SM_ARN" ]]; then
      aws ssm put-parameter --region us-east-1 \
        --name "/$APP/$ENV/backend/$REGION/secrets_manager_arn" \
        --value "$SM_ARN" --type String --overwrite
      echo "Written: /$APP/$ENV/backend/$REGION/secrets_manager_arn = $SM_ARN"
    fi
```

All three paths already include `$REGION` — this step needs no further modification to
work correctly across all three regions. `terraform output` works without `-chdir`
because the job's `working-directory` is already `infra-live-backend/terraform`.

**b2. "Validate required secrets" step** — add new region secrets to the `env:` block
and add corresponding condition checks in the `run:` script:

In the `env:` block of the step, add:
```yaml
ACM_CERTIFICATE_ARN_EU_WEST_1:           ${{ secrets.ACM_CERTIFICATE_ARN_EU_WEST_1 }}
ACM_CERTIFICATE_ARN_US_EAST_1:           ${{ secrets.ACM_CERTIFICATE_ARN_US_EAST_1 }}
UPLOADS_BUCKET_NAME_EU_WEST_1:           ${{ secrets.UPLOADS_BUCKET_NAME_EU_WEST_1 }}
UPLOADS_BUCKET_NAME_US_EAST_1:           ${{ secrets.UPLOADS_BUCKET_NAME_US_EAST_1 }}
REGIONAL_LOGGING_BUCKET_NAME_EU_WEST_1:  ${{ secrets.REGIONAL_LOGGING_BUCKET_NAME_EU_WEST_1 }}
REGIONAL_LOGGING_BUCKET_NAME_US_EAST_1:  ${{ secrets.REGIONAL_LOGGING_BUCKET_NAME_US_EAST_1 }}
```

In the `run:` script, add after the existing ap-south-1 checks:
```bash
[[ "${{ inputs.aws_region }}" == "eu-west-1" && -z "$ACM_CERTIFICATE_ARN_EU_WEST_1"           ]] && missing+=("ACM_CERTIFICATE_ARN_EU_WEST_1")
[[ "${{ inputs.aws_region }}" == "eu-west-1" && -z "$UPLOADS_BUCKET_NAME_EU_WEST_1"           ]] && missing+=("UPLOADS_BUCKET_NAME_EU_WEST_1")
[[ "${{ inputs.aws_region }}" == "eu-west-1" && -z "$REGIONAL_LOGGING_BUCKET_NAME_EU_WEST_1"  ]] && missing+=("REGIONAL_LOGGING_BUCKET_NAME_EU_WEST_1")
[[ "${{ inputs.aws_region }}" == "us-east-1" && -z "$ACM_CERTIFICATE_ARN_US_EAST_1"           ]] && missing+=("ACM_CERTIFICATE_ARN_US_EAST_1")
[[ "${{ inputs.aws_region }}" == "us-east-1" && -z "$UPLOADS_BUCKET_NAME_US_EAST_1"           ]] && missing+=("UPLOADS_BUCKET_NAME_US_EAST_1")
[[ "${{ inputs.aws_region }}" == "us-east-1" && -z "$REGIONAL_LOGGING_BUCKET_NAME_US_EAST_1"  ]] && missing+=("REGIONAL_LOGGING_BUCKET_NAME_US_EAST_1")
```

**b3. "Resolve ACM certificate ARN for backend region" step** — add new case entries
to both the `env:` block and the `case` statement:

In the step's `env:` block, add:
```yaml
ACM_ARN_EU_WEST_1: ${{ secrets.ACM_CERTIFICATE_ARN_EU_WEST_1 }}
ACM_ARN_US_EAST_1: ${{ secrets.ACM_CERTIFICATE_ARN_US_EAST_1 }}
```

In the `case` statement, add before the `*) ... exit 1` catch-all:
```bash
eu-west-1) echo "TF_VAR_acm_certificate_arn=$ACM_ARN_EU_WEST_1" >> "$GITHUB_ENV" ;;
us-east-1) echo "TF_VAR_acm_certificate_arn=$ACM_ARN_US_EAST_1" >> "$GITHUB_ENV" ;;
```

**b4. "Resolve region-specific S3 bucket names" step** — same pattern as ACM. Add new
case entries for `UPLOADS_BUCKET_NAME` and `REGIONAL_LOGGING_BUCKET_NAME` for the two
new regions. Follow the existing ap-south-1 case as a template.

**c. GitHub Environment Secrets** — add the following secrets in each GitHub environment
before running the workflow for each new region:
- `ACM_CERTIFICATE_ARN_EU_WEST_1` — ARN of the ACM cert in eu-west-1 for the internal ALB
- `ACM_CERTIFICATE_ARN_US_EAST_1` — ARN of the ACM cert in us-east-1 for the internal ALB
- `UPLOADS_BUCKET_NAME_EU_WEST_1`, `UPLOADS_BUCKET_NAME_US_EAST_1`
- `REGIONAL_LOGGING_BUCKET_NAME_EU_WEST_1`, `REGIONAL_LOGGING_BUCKET_NAME_US_EAST_1`

Provision these ACM certs in each target region manually before running the workflow.

Then apply:
- `aws_region = eu-west-1` — creates VPC, ALB, ECS, Redis, publishes SSM params
- `aws_region = us-east-1` — creates VPC, ALB, ECS, Redis, publishes SSM params

**d. Atlas tier upgrade, Global Cluster bootstrap, and PrivateLink per region**

> **Corrected premise (previously wrong in this doc):** an earlier version of this
> section assumed a Terraform-managed `mongodbatlas_advanced_cluster.main` resource
> already existed as a single-region `REPLICASET`, needing an Option A/B decision to
> get to `GEOSHARDED`. Checked against the actual repo: **no Atlas Terraform resource
> exists at all** — the current cluster is **Atlas M0 (free tier)**, created and managed
> manually through the Atlas console, single region, ap-south-1, for cost reasons. There
> is no REPLICASET-to-GEOSHARDED migration to perform on an existing
> Terraform resource, because there is no existing Terraform resource — this is a
> **from-scratch bootstrap**, not a conversion.
>
> **Decision (confirmed): Global Cluster, GEOSHARDED, exactly 3 zones.** One Atlas
> Global Cluster, zone-sharded on the `location` field, with zones mapped 1:1 to the
> three backend regions this doc already targets — ap-south-1, eu-west-1, us-east-1 —
> and no others. This is a deliberate cost boundary, not an oversight: both the backend
> ECS footprint and the Atlas zone footprint are capped at these same three regions. A
> broader 8-zone scheme exists elsewhere spanning up to 10 AWS regions (e.g. `apac` →
> ap-southeast-1/ap-northeast-1, `br` → sa-east-1, `me` → me-south-1/me-central-1) — that
> scheme is wider than this 3-region target and needs reconciling separately, outside
> this doc's scope. For this doc's purposes, of the 8 `location` values the backend
> produces (`in`/`apac`/`cn`/`eu`/`me`/`ru`/`us`/`br` — see
> `backend/app/routing.py:COUNTRY_TO_REGION`), **6 collapse into the three zones** in the
> `LOCATION_TO_REGION` map above (APAC/EU/Americas), matching the `REGIONAL_ALB_FQDNS`/
> API-region targets this doc's Lambda@Edge function routes to. **`cn` and `ru` are
> deliberately excluded from both** — the Lambda already fails these closed (503, see the
> Location → ALB region mapping table above), and this Atlas zone design should exclude
> them the same way rather than assign them a zone that the edge layer will never route
> traffic to: sharding `cn`/`ru` user data into a zone no ALB ever serves would mean
> writing data with no corresponding compute path to read it from. If either is added to
> a zone here, add a matching entry to the edge layer's `LOCATION_TO_REGION` at the same
> time — the two must stay in sync now that this doc's `LOCATION_TO_REGION` table has been
> corrected to reflect the real code. `location` is already being captured on every token
> and user record (see Change 9) precisely so the remaining reconciliation is infra-only.
>
> **Prerequisite before any Terraform work: upgrade the Atlas project's tier to M50.** M0
> does not support Global Clusters, custom zone sharding, or PrivateLink — all three
> require a paid, dedicated cluster tier. This target (M50) has already been sized
> elsewhere for the single-region PrivateLink prerequisite, so it's not a new number —
> reuse it here rather than re-deriving it. This is a real, ongoing cost increase — size
> it and get it approved explicitly, the same way the 3-region backend expansion itself
> should be, before starting Phase 0.
>
> **`infra-live-atlas` does not exist yet either.** Everything below that references
> "add a resource to `infra-live-atlas/terraform/main.tf`" assumes that module already
> has a baseline single-region resource to extend. In reality the whole module —
> `main.tf`, `variables.tf`, `outputs.tf`, provider config, remote state — needs to be
> created from scratch, starting with a single `mongodbatlas_advanced_cluster` resource
> for the upgraded-tier ap-south-1 cluster (`cluster_type = "GEOSHARDED"` from the start,
> not created as `REPLICASET` and converted later), before extending it with the
> `eu-west-1`/`us-east-1` `replication_specs` and the `mongodbatlas_global_cluster_config`
> resource described below.

MongoDB traffic must flow via PrivateLink, not NAT Gateway — the same requirement as
ap-south-1's own pending PrivateLink setup (Phases 1 and 5 above). For each new region,
the same 3-step handshake must be completed:

**Step 1 — Atlas side** (`infra-live-atlas` — new module, see the note above): once the
module exists with its baseline ap-south-1 `mongodbatlas_advanced_cluster` resource, add
a `mongodbatlas_privatelink_endpoint` resource for each of the other two regions. Note
the Atlas region name format differs from AWS (`EU_WEST_1`, `US_EAST_1`):
```hcl
resource "mongodbatlas_privatelink_endpoint" "eu_west_1" {
  count         = var.enable_privatelink ? 1 : 0
  project_id    = var.atlas_project_id
  provider_name = "AWS"
  region        = "EU_WEST_1"
}

resource "mongodbatlas_privatelink_endpoint" "us_east_1" {
  count         = var.enable_privatelink ? 1 : 0
  project_id    = var.atlas_project_id
  provider_name = "AWS"
  region        = "US_EAST_1"
}
```
After apply, Atlas returns an `endpoint_service_name` per region. Write each to SSM using
a **region-specific path** — `/{app_name}/{env}/atlas/{aws_region}/endpoint_service_name`.

> **`terraform-atlas.yml` needs to be created from scratch — it does not exist yet.**
> There is no `.github/workflows/terraform-atlas.yml` in this repo at all today (checked
> directly — `find .github/workflows -iname '*atlas*'` returns nothing). The four items
> below describe what the new workflow needs to contain; treat them as the initial
> design, not a diff against something already running. Since it's being written fresh,
> build in `eu-west-1`/`us-east-1` support from the start rather than shipping an
> ap-south-1-only version and revisiting it immediately after:
>
> **1. `aws_region` choices** — include `ap-south-1`, `eu-west-1`, and `us-east-1` in the
> `workflow_dispatch.inputs.aws_region.options` list from the first version of this file.
>
> **2. "Write SSM outputs" step** — two fixes:
>
>    a. Use region-specific SSM paths (not shared paths that would be overwritten per run):
>    ```bash
>    REGION="${{ inputs.aws_region }}"
>    # endpoint_service_name — use region-specific output name based on region
>    case "$REGION" in
>      ap-south-1) ENDPOINT_SVC=$(terraform output -raw endpoint_service_name) ;;
>      eu-west-1)  ENDPOINT_SVC=$(terraform output -raw endpoint_service_name_eu_west_1) ;;
>      us-east-1)  ENDPOINT_SVC=$(terraform output -raw endpoint_service_name_us_east_1) ;;
>    esac
>    aws ssm put-parameter --region us-east-1 \
>      --name "/$APP/$ENV/atlas/$REGION/endpoint_service_name" \
>      --value "$ENDPOINT_SVC" --type String --overwrite
>    ```
>    b. Same pattern for `private_mongodb_uri` (Phase 5 only):
>    ```bash
>    case "$REGION" in
>      ap-south-1) PRIVATE_URI=$(terraform output -raw private_mongodb_uri 2>/dev/null || echo "") ;;
>      eu-west-1)  PRIVATE_URI=$(terraform output -raw private_mongodb_uri_eu_west_1 2>/dev/null || echo "") ;;
>      us-east-1)  PRIVATE_URI=$(terraform output -raw private_mongodb_uri_us_east_1 2>/dev/null || echo "") ;;
>    esac
>    if [[ -n "$PRIVATE_URI" ]]; then
>      aws ssm put-parameter --region us-east-1 \
>        --name "/$APP/$ENV/atlas/$REGION/private_mongodb_uri" \
>        --value "$PRIVATE_URI" --type SecureString --overwrite
>    fi
>    ```
>
> **3. "Resolve SSM inputs" step** — set the correct region-specific Terraform variable
> for `vpc_endpoint_id`. The current step writes `TF_VAR_vpc_endpoint_id` (ap-south-1).
> For new regions it must write `TF_VAR_vpc_endpoint_id_eu_west_1` /
> `TF_VAR_vpc_endpoint_id_us_east_1`:
> ```bash
> VPC_EP=$(get_ssm "/$APP/$ENV/backend/$REGION/atlas_vpc_endpoint_id")
> case "$REGION" in
>   ap-south-1) echo "TF_VAR_vpc_endpoint_id=$VPC_EP"            >> "$GITHUB_ENV" ;;
>   eu-west-1)  echo "TF_VAR_vpc_endpoint_id_eu_west_1=$VPC_EP"  >> "$GITHUB_ENV" ;;
>   us-east-1)  echo "TF_VAR_vpc_endpoint_id_us_east_1=$VPC_EP"  >> "$GITHUB_ENV" ;;
> esac
> ```
>
> **4. "Rotate MONGODB_URI in Secrets Manager" step** — use the region-specific
> Terraform output and `--region $REGION`:
> ```bash
> case "${{ inputs.aws_region }}" in
>   ap-south-1) PRIVATE_URI=$(terraform output -raw private_mongodb_uri) ;;
>   eu-west-1)  PRIVATE_URI=$(terraform output -raw private_mongodb_uri_eu_west_1) ;;
>   us-east-1)  PRIVATE_URI=$(terraform output -raw private_mongodb_uri_us_east_1) ;;
> esac
> # ... then put-secret-value with --region ${{ inputs.aws_region }} (already present)
> ```

**Step 2 — AWS side** (`infra-live-backend`, per region): the backend module does
**not** yet provision `aws_vpc_endpoint` for Atlas PrivateLink in any region, including
ap-south-1 — this needs to be added once, then applies identically to all three
regions since the module is already region-agnostic. Add to
`infra-live-backend/terraform/` (e.g. `vpc_endpoints.tf`):

```hcl
resource "aws_vpc_endpoint" "atlas_privatelink" {
  count = var.atlas_endpoint_service_name != "" ? 1 : 0

  vpc_id             = aws_vpc.main.id
  service_name       = var.atlas_endpoint_service_name
  vpc_endpoint_type  = "Interface"
  subnet_ids         = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.atlas_privatelink.id]
  # Atlas uses its own custom DNS for PrivateLink — do NOT enable AWS private DNS here.
  # With private_dns_enabled = true, AWS would attempt to resolve the Atlas endpoint
  # service name via Route 53 Resolver, which conflicts with Atlas-managed private DNS.
  private_dns_enabled = false

  tags = { Name = "${var.app_name}-${var.environment}-atlas-privatelink" }
}
```

Plus a security group (`aws_security_group.atlas_privatelink`, referenced above)
allowing inbound 27017 from both the API and worker ECS task security groups, and an
egress rule on those task security groups allowing outbound 27017 to this SG. Add the
matching output:

```hcl
output "atlas_vpc_endpoint_id" {
  value = length(aws_vpc_endpoint.atlas_privatelink) > 0 ? aws_vpc_endpoint.atlas_privatelink[0].id : ""
}
```

(`aws_vpc.main`, `aws_subnet.private[*].id`, and `atlas_endpoint_service_name` above are
assumed to already exist in the module under those names — adjust if the actual
resource/variable names differ.)

**Step 3 — complete handshake** (`infra-live-atlas`, per region):

Add two new per-region variables to `infra-live-atlas/terraform/variables.tf` (alongside
the existing `variable "vpc_endpoint_id"` which handles ap-south-1):
```hcl
variable "vpc_endpoint_id_eu_west_1" { default = "" }
variable "vpc_endpoint_id_us_east_1" { default = "" }
```

Add the endpoint service resources to `infra-live-atlas/terraform/main.tf`:
```hcl
resource "mongodbatlas_privatelink_endpoint_service" "eu_west_1" {
  count               = var.enable_privatelink && var.vpc_endpoint_id_eu_west_1 != "" ? 1 : 0
  project_id          = one(mongodbatlas_privatelink_endpoint.eu_west_1).project_id
  private_link_id     = one(mongodbatlas_privatelink_endpoint.eu_west_1).id
  endpoint_service_id = var.vpc_endpoint_id_eu_west_1
  provider_name       = "AWS"
}

resource "mongodbatlas_privatelink_endpoint_service" "us_east_1" {
  count               = var.enable_privatelink && var.vpc_endpoint_id_us_east_1 != "" ? 1 : 0
  project_id          = one(mongodbatlas_privatelink_endpoint.us_east_1).project_id
  private_link_id     = one(mongodbatlas_privatelink_endpoint.us_east_1).id
  endpoint_service_id = var.vpc_endpoint_id_us_east_1
  provider_name       = "AWS"
}
```

Add per-region `endpoint_service_name` and `private_mongodb_uri` outputs to
`infra-live-atlas/terraform/outputs.tf` (alongside the existing single-region outputs):
```hcl
output "endpoint_service_name_eu_west_1" {
  value = var.enable_privatelink ? one(mongodbatlas_privatelink_endpoint.eu_west_1).endpoint_service_name : ""
}

output "endpoint_service_name_us_east_1" {
  value = var.enable_privatelink ? one(mongodbatlas_privatelink_endpoint.us_east_1).endpoint_service_name : ""
}

# Only populated after Phase 5 for that region. For the single GEOSHARDED global
# cluster, each region's PrivateLink endpoint produces a separate SRV string in the
# cluster's connection_strings[0].private_endpoint[] list. The index corresponds to the
# order the endpoints were registered.
output "private_mongodb_uri_eu_west_1" {
  value     = var.enable_privatelink && var.vpc_endpoint_id_eu_west_1 != "" ? mongodbatlas_advanced_cluster.main.connection_strings[0].private_endpoint[1].srv_connection_string : ""
  sensitive = true
}

output "private_mongodb_uri_us_east_1" {
  value     = var.enable_privatelink && var.vpc_endpoint_id_us_east_1 != "" ? mongodbatlas_advanced_cluster.main.connection_strings[0].private_endpoint[2].srv_connection_string : ""
  sensitive = true
}
```

> **`private_endpoint` index note:** Atlas populates `connection_strings[0].private_endpoint[]`
> in the order PrivateLink endpoints are completed (Phase 5). If ap-south-1 was completed
> first it is at index 0, eu-west-1 at index 1, us-east-1 at index 2. Verify the index
> in the Atlas console (Cluster → Connect → Private Endpoint) after each Phase 5 run and
> adjust the index in the output if it differs.

After handshake, Atlas generates a private endpoint-aware SRV connection string per
region. Update `MONGODB_URI` in each region's Secrets Manager to the private SRV string,
then force-restart ECS tasks to pick up the new URI. Until the restart, tasks continue
using the public SRV string via NAT.

**Important:** Atlas PrivateLink for the existing ap-south-1 region is also still
**pending** — nothing described in Step 2 above exists yet, for any region, including
ap-south-1. Complete the ap-south-1 PrivateLink setup before expanding to new regions —
the backend module must have the
Atlas PrivateLink endpoint provisioned and the ECS task SGs updated before applying in
eu-west-1 or us-east-1.

---

## Hard Rules (Do Not Break)

1. **All `/api/*` cache behaviours must keep `cache_policy_id = local.cache_policy_disabled`.**
   Even though the JWT/geo-routing Lambda runs at `viewer-request` (fires before any cache
   lookup), a cacheable response could still be served to a different, unauthenticated
   viewer on a later cache hit without the Lambda re-running its check. Adding a non-zero
   TTL cache policy to any authenticated endpoint risks exactly that.

2. **The `location` claim in the JWT must always map to a key in `LOCATION_TO_REGION`,
   whose mapped region must actually be deployed.** Unlike the original plan, the real
   Lambda has **no default-region fallback** — a missing `LOCATION_TO_REGION` entry, or an
   entry that maps to a region not yet in `var.backend_regions`, produces a 503
   (`resolveRegionalOrigin()` throws rather than guessing an origin). If a new location
   string is added as an output of `backend/app/routing.py:resolve_region()`, a
   corresponding entry must be added to `LOCATION_TO_REGION` in the Lambda template, or
   every token carrying that location gets a hard failure instead of a (possibly wrong,
   but at least working) guess.

3. **There is no `COUNTRY_TO_REGION` map in the Lambda template to keep in sync** — the
   real implementation has no IP-geo routing at all (see Change 1). The thing that *does*
   need to stay in sync is narrower: `LOCATION_TO_REGION` in the Lambda template must
   cover every location value `backend/app/routing.py:resolve_region()` can actually
   produce. A location `resolve_region()` can return but `LOCATION_TO_REGION` doesn't
   recognize hits the 503 path in Rule 2 above for every authenticated request from that
   location — worse than a wrong-but-working default, since it's a hard outage for those
   users rather than a latency/cost inefficiency.

4. **Lambda@Edge must remain in us-east-1.** AWS requires all Lambda@Edge functions to
   be deployed in us-east-1. The `infra-live-edge` Terraform module is already pinned
   to us-east-1.

5. **The existing key rotation procedure keeps working unchanged.** The function still
   uses a `PUBLIC_KEYS` map keyed by `kid`, so a rotation can add a new key alongside the
   old one, wait out the overlap window, then remove the old key — nothing about this
   multi-region change alters that mechanism.

---

## Checklist for Activating a New Region

When adding a fourth region in future:

- [ ] Provision ACM cert in the new region for the internal ALB subdomain; add as GitHub secret
- [ ] Add the region to `infra-live-backend/terraform/variables.tf` `aws_region` validation
- [ ] Add the region to `terraform-live-backend.yml` `aws_region` workflow_dispatch choices
- [ ] Add ACM cert ARN case entry in the "Resolve ACM certificate ARN" step of `terraform-live-backend.yml` (env block + case statement)
- [ ] Add S3 bucket name case entry in the "Resolve region-specific S3 bucket names" step of `terraform-live-backend.yml`
- [ ] Add secret env entries and condition checks in the "Validate required secrets" step of `terraform-live-backend.yml`
- [ ] Add region-specific GitHub environment secrets (ACM cert ARN, uploads bucket, logging bucket)
- [ ] Apply `infra-live-backend` for the new region (VPC, ALB, ECS, Redis, VPC Interface Endpoints, Atlas PrivateLink endpoint + SG)
- [ ] Add `mongodbatlas_privatelink_endpoint.<region>` resource in `infra-live-atlas/terraform/main.tf`
- [ ] Add `variable "vpc_endpoint_id_<region>"` (default `""`) to `infra-live-atlas/terraform/variables.tf`
- [ ] Add `endpoint_service_name_<region>` and `private_mongodb_uri_<region>` outputs to `infra-live-atlas/terraform/outputs.tf`
- [ ] Add `mongodbatlas_privatelink_endpoint_service.<region>` resource in `infra-live-atlas/terraform/main.tf`
- [ ] Add the new region to `terraform-atlas.yml` `aws_region` workflow_dispatch choices (if not already done)
- [ ] Update `terraform-atlas.yml` "Write SSM outputs" step to use region-specific output name and SSM path (see Change 10d Step 1 terraform-atlas.yml note)
- [ ] Update `terraform-atlas.yml` "Resolve SSM inputs" step to write `TF_VAR_vpc_endpoint_id_<region>` (see Change 10d)
- [ ] Update `terraform-atlas.yml` "Rotate MONGODB_URI" step to read `private_mongodb_uri_<region>` output
- [ ] Run `terraform-atlas` (Phase 1 — new region) **before** `infra-live-backend` for that region
- [ ] Apply `infra-live-backend` for the new region (reads `atlas/<region>/endpoint_service_name` from SSM)
- [ ] Run `terraform-atlas` (Phase 5 — new region) after backend apply (reads `atlas_vpc_endpoint_id` from SSM)
- [ ] Update `MONGODB_URI` in new region's Secrets Manager to the private SRV string; restart ECS tasks
- [ ] Add the new region to `var.backend_regions` (a workflow input, not a code change) —
      `infra-live-edge/terraform/ssm_read.tf`'s `for_each` and the Lambda's
      `regional_alb_fqdns` map both pick up the new region automatically; no per-region
      edit to `ssm_read.tf`, `lambda_edge.tf`, or the Lambda template's ALB map is needed
- [ ] Add an entry to `LOCATION_TO_REGION` in the Lambda template (`jwt-validator-lambda.js.tpl`)
      for any new location value that should route to the new region — this one *is* a
      manual code edit, since it's a business decision (see Hard Rules 2–3 above), not
      something `var.backend_regions` can infer
- [ ] The new region's SSM check happens automatically — `terraform-live-edge.yml`'s
      "Verify SSM parameters exist and are readable" step already loops over whatever
      `backend_regions` JSON array is passed in; no hardcoded per-region check to add
- [ ] Add the new region, and any new multi-region combination including it, to
      `terraform-live-all.yml`'s `backend_regions` workflow_dispatch options (a JSON-array
      choice list, not a single `aws_region` — see Change 7)
- [ ] Apply `infra-live-edge`
