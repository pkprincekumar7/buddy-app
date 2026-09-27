# Alternative Auth Architecture — API Gateway + Lambda Authorizer

> **Status: exploratory proposal, not implemented.**
> The current source of truth for the multi-region deployment is
> [`docs/infra-architecture-multi-region.md`](infra-architecture-multi-region.md), which documents a
> different, already-partially-implemented decision: Lambda@Edge performs full RS256
> signature verification (with public keys embedded via Terraform) *and* geo-routing in a
> single function, with no API Gateway in the path. That doc's
> ["Why not API Gateway with a Lambda Authorizer?"](infra-architecture-multi-region.md#why-not-api-gateway-with-a-lambda-authorizer)
> section lays out cost, complexity, and performance reasons against the approach below.
>
> This document captures an alternative design discussed as a "what if" — it is **not**
> a replacement for the current plan unless a separate decision is made to pivot. Read
> both before treating this as actionable.

---

## Why this design differs from the current plan

The trigger for this alternative was a specific concern: **no signing/verification key
should live inside Lambda@Edge**, to shrink the blast radius if the edge function's code
or config ever leaks. The current plan embeds the JWT *public* key in Lambda@Edge (lower
risk than a private/symmetric key, but still key material at the edge).

**Correction (this section originally assumed the current plan also runs at
`origin-request` — it doesn't):** the current plan's function runs at **`viewer-request`**
(confirmed in `infra-live-edge/terraform/cloudfront.tf`'s `lambda_function_association`),
which replicates to **every one of CloudFront's ~400+ viewer-facing PoPs**, not just the
smaller set of Regional Edge Caches. That actually makes the key-leak footprint for the
current plan *larger* than this section originally stated, not smaller — the public key
sits at every edge location globally, not a reduced subset. This proposal's own function
runs at `origin-request` instead (a real, deliberate change from the current plan, not a
shared trait with it — see the correction under Section 2 below), which is exactly why
removing the key here also shrinks the footprint of *any* remaining key-adjacent logic to
Regional Edge Caches only, on top of removing the key itself. This design removes all key
material from Lambda@Edge entirely, at the cost of adding a regional hop (API Gateway) and
reduced edge-side security filtering.

## Design summary

| Concern | Current plan (infra-architecture-multi-region.md) | This proposal |
|---|---|---|
| Signature verification | Lambda@Edge (RS256, public key embedded) | API Gateway Lambda Authorizer (Secrets Manager) |
| Lambda@Edge holds key material | Yes (public key) | **No** |
| Lambda@Edge's job | Full auth + geo-routing | Structural pre-filter (existence + expiry, unverified) + geo-routing (unchanged mechanism — see below) |
| Where a forged-but-well-formed token is caught | At the edge (signature fails) | At the regional API Gateway (signature fails) |
| ECS re-validates token | **Yes** — `backend/app/deps.py`'s `get_current_user` independently re-verifies the RS256 signature (`jwt.decode(...)` against the public key) as defense-in-depth; it does not trust Lambda@Edge's check at all | **No, by design** — Section 5 explicitly removes this re-validation, trusting API Gateway's injected headers instead |
| MongoDB | Confirmed: Global Cluster, GEOSHARDED, exactly 3 zones (per that doc's Change 10d) | Same confirmed design — unaffected by the auth-layer choice either way |

---

## Architecture diagram

```
                              Users (global)
                                    │
                          ┌─────────▼──────────┐
                          │     Route 53        │
                          │   ALIAS record      │
                          └─────────┬──────────┘
                                    │ HTTPS
                          ┌─────────▼──────────┐
                          │     CloudFront      │
                          │  + WAF WebACL       │
                          │  (rate-based rule,  │
                          │   per-source-IP)    │
                          │  (us-east-1/global) │
                          └──────┬─────────┬───┘
                       /api/*    │         │   /*
                  ┌──────────────┘         └──────────────────────┐
                  │                                                 │
                  ▼                                                 ▼
        ┌───────────────────────────────┐    ┌─────────────────────────┐
        │       Lambda@Edge             │    │  S3 — frontend assets   │
        │  origin-request (single fn)   │    │  (us-east-1)            │
        │  NO key material stored       │    │  OAC — no public access │
        │  (runs at CloudFront's        │    └─────────────────────────┘
        │   Regional Edge Caches)       │
        │                               │
        │  Bypass paths (login/google/  │
        │  health): pass through        │
        │  unchanged — no check, no     │
        │  routing                      │
        │                               │
        │  Refresh/logout/register:     │
        │    • unverified read of a     │
        │      location HINT from an    │
        │      existing cookie/Bearer   │
        │      token's payload, or      │
        │      (register only)          │
        │      X-Client-Location header │
        │    • never blocks; no hint    │
        │      → static bootstrap       │
        │      region's API Gateway     │
        │                               │
        │  All other paths:             │
        │    • token present, 3 dot-    │
        │      separated segments?      │
        │    • unverified read of `exp` │
        │      claim (no crypto, no key)│
        │    • 401 on failure           │
        │    • unverified read of       │
        │      payload.location →       │
        │      target region's API GW   │
        │      (routing ≠ security)     │
        │    • unmapped/undeployed      │
        │      location → same          │
        │      bootstrap-region fallback│
        │      as bypass paths (open    │
        │      question: see below)     │
        │                               │
        │  Step: inject/propagate       │
        │    X-Request-Id header        │
        └───────────────┬───────────────┘
                        │ HTTPS/443 to region-specific API Gateway
                        ▼

── Backend regional stack (x3) ──

╔═══════════════════════════╦═══════════════════════════╦═══════════════════════════╗
║   ap-south-1              ║   eu-west-1               ║   us-east-1               ║
║   (Mumbai)                ║   (Ireland)               ║   (N. Virginia)           ║
║   3 AZs · 5 VPC endpoints ║   3 AZs · 5 VPC endpoints ║   3 AZs · 5 VPC endpoints ║
║   + 1 Atlas PrivateLink   ║   + 1 Atlas PrivateLink   ║   + 1 Atlas PrivateLink   ║
║   + 2 Secrets Mgr secrets ║   + 2 Secrets Mgr secrets ║   + 2 Secrets Mgr secrets ║
║     (replicated, local)   ║     (replicated, local)   ║     (replicated, local)   ║
╠═══════════════════════════╬═══════════════════════════╬═══════════════════════════╣
║ API Gateway (HTTP API)    ║ API Gateway (HTTP API)    ║ API Gateway (HTTP API)    ║
║  bypass-path routes:      ║  bypass-path routes:      ║  bypass-path routes:      ║
║   no authorizer attached  ║   no authorizer attached  ║   no authorizer attached  ║
║  all other routes:        ║  all other routes:        ║  all other routes:        ║
║   Lambda Authorizer       ║   Lambda Authorizer       ║   Lambda Authorizer       ║
║   (REQUEST, cached ≤1hr)  ║   (REQUEST, cached ≤1hr)  ║   (REQUEST, cached ≤1hr)  ║
║    • fetch pub. key from  ║    • fetch pub. key from  ║    • fetch pub. key from  ║
║      local Secrets Mgr    ║      local Secrets Mgr    ║      local Secrets Mgr    ║
║      replica (≤15m cache) ║      replica (≤15m cache) ║      replica (≤15m cache) ║
║    • verify sig, exp,     ║    • verify sig, exp,     ║    • verify sig, exp,     ║
║      nbf, iss, aud        ║      nbf, iss, aud        ║      nbf, iss, aud        ║
║    • on pass: overwrite   ║    • on pass: overwrite   ║    • on pass: overwrite   ║
║      X-User-Id / -Roles / ║      X-User-Id / -Roles / ║      X-User-Id / -Roles / ║
║      X-Token-Iat headers  ║      X-Token-Iat headers  ║      X-Token-Iat headers  ║
║  VPC Link (3 AZs)         ║  VPC Link (3 AZs)         ║  VPC Link (3 AZs)         ║
║ [public subnet]           ║ [public subnet]           ║ [public subnet]           ║
║  ALB (HTTPS/443)          ║  ALB (HTTPS/443)          ║  ALB (HTTPS/443)          ║
║  NAT Gateway × 3          ║  NAT Gateway × 3          ║  NAT Gateway × 3          ║
║ [private subnet]          ║ [private subnet]          ║ [private subnet]          ║
║  ECS Fargate (API+worker) ║  ECS Fargate (API+worker) ║  ECS Fargate (API+worker) ║
║   reads trusted headers,  ║   reads trusted headers,  ║   reads trusted headers,  ║
║   no JWT decode — session ║   no JWT decode — session ║   no JWT decode — session ║
║   revocation check uses   ║   revocation check uses   ║   revocation check uses   ║
║   X-Token-Iat instead     ║   X-Token-Iat instead     ║   X-Token-Iat instead     ║
║  Redis (in-VPC)           ║  Redis (in-VPC)           ║  Redis (in-VPC)           ║
║  VPC Interface Endpoints  ║  VPC Interface Endpoints  ║  VPC Interface Endpoints  ║
║  (ECR, SM, CW, X-Ray)     ║  (ECR, SM, CW, X-Ray)     ║  (ECR, SM, CW, X-Ray)     ║
║  Secrets Mgr replica      ║  Secrets Mgr replica      ║  Secrets Mgr replica      ║
║   (jwt-public-keys,       ║   (jwt-public-keys,       ║   (jwt-public-keys,       ║
║    jwt-private-key)       ║    jwt-private-key)       ║    jwt-private-key)       ║
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
│         (GEOSHARDED, confirmed — exactly 3 zones)      │
├──────────────────┬──────────────────┬──────────────────┤
│   Zone: APAC     │    Zone: EU      │  Zone: Americas  │
│  (ap-south-1)    │  (eu-west-1)     │  (us-east-1)     │
│  location: in    │  location: eu    │  location: us    │
│  location: apac  │                  │  location: br    │
│  location: me    │                  │                  │
├──────────────────┴──────────────────┴──────────────────┤
│         cross-zone replication (Atlas managed)         │
└────────────────────────────────────────────────────────┘

  cn / ru: excluded, not assigned to any zone — same exclusion as the current
  plan, for the same compliance reasons (see the mapping table below).
```

**TLS / hop chain:**
```
Browser ──HTTPS──▶ CloudFront ──[L@E: pre-filter + geo-route]──▶ API Gateway ──[Lambda Authorizer: verify sig via Secrets Manager]──▶ VPC Link ──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)                                    (regional custom domain)                                                          (region ACM cert)
```

**Location → API Gateway region mapping** (corrected to match the current plan's real
`LOCATION_TO_REGION` — an earlier version of this table had `me` grouped with EU and
`cn`/`ru` mapped to a zone; both were wrong):

| JWT `location` value | Atlas zone | Routed to region's API Gateway |
|---|---|---|
| `in`, `apac`, `me` | APAC | ap-south-1 |
| `eu` | EU | eu-west-1 |
| `us`, `br` | Americas | us-east-1 |
| `cn`, `ru` | — | **not routed** — same deliberate exclusion as the current plan (China needs AWS's separate China partition; Russia carries OFAC/EAR export-control exposure) |
| authenticated but unrecognized/undeployed `location` | — | bootstrap-region fallback (see below) — **open question**, see "Open questions" section: without a verified signature at this point, this design can't tell a legitimate unmapped location from a forged one the way the current plan's fail-closed 503 can |
| no token at all (bypass paths) | — | same bootstrap-region fallback, unconditionally |

**Fallback mechanism — no IP-geo routing, matching the current plan's real behaviour**
(an earlier version of this section described a `CloudFront-Viewer-Country` fallback that
doesn't exist in the current plan): bypass paths (login, google, health) and any
authenticated request with an unmapped/undeployed location simply aren't rewritten —
they fall through to the CloudFront distribution's statically configured origin (the
first region in whatever region list is deployed). Refresh/logout/register instead read
a best-effort location *hint* from an existing session cookie/Bearer token, or
(register only) a client-supplied `X-Client-Location` header — never IP geo.

---

## Component plan

### 1. AWS WAF — rate-based rules on the CloudFront distribution

Since Lambda@Edge no longer verifies signatures, a flood of structurally-valid-but-forged
tokens (correct shape, unexpired `exp`, invalid signature) is no longer stopped at the
edge — it travels all the way to a regional API Gateway before being rejected. WAF rate
limiting compensates for this gap at the layer that still sees every request globally.

- Attach a WAF WebACL to the CloudFront distribution (extends the existing
  `infra-live-edge` CloudFront + WAF setup).
- Add a **rate-based rule** keyed on source IP (aggregate over a 5-minute window,
  standard WAF rate-based rule behavior): block/challenge IPs exceeding a threshold
  tuned to normal per-client request volume.
- Action: `Block` once confirmed tuned; start in `Count` mode to baseline traffic before
  enforcing, to avoid false-positives on legitimate bursty clients.
- **What this does and doesn't cover**: WAF evaluates the viewer request *before*
  CloudFront's cache lookup, which is *before* the `origin-request` Lambda@Edge function
  (Section 2) ever runs — so WAF cannot inspect anything Lambda@Edge computes or sets on
  that same request (e.g. a per-token marker), only the raw incoming request. Per-IP
  rate limiting also only bounds a **single-source flood** of forged tokens; it does
  nothing against a distributed attack spreading forged-token traffic across many IPs
  below the per-IP threshold — that traffic still reaches the regional API Gateway
  before the Lambda Authorizer's signature check catches it. If that threat matters for
  this deployment, it needs a mitigation that doesn't depend on source IP (e.g. AWS
  Shield Advanced, or a WAF rule on request-shape anomalies) — plain per-IP rate
  limiting does not bound it, despite being the only mitigation proposed here.

### 2. Lambda@Edge — structural pre-filter + geo-routing, no key material

**Correction: this changes the event-stage placement, it doesn't keep it.** The current
plan's function runs at `viewer-request`, not `origin-request` (see the correction under
"Why this design differs from the current plan" above) — so moving to `origin-request`
here is a real, deliberate change this proposal makes, not something carried over
unchanged. What *is* kept is the current plan's geo-routing **intent and mechanism**:
route by the JWT's `location` claim (or a session hint for a few specific paths), not by
network proximity. Geo-routing is retained because Route 53 latency-based routing would
route on network proximity, not data locality, which is the exact problem the current
doc's
["Why JWT `location` claim for routing instead of IP geo?"](infra-architecture-multi-region.md#why-jwt-location-claim-for-routing-instead-of-ip-geo)
section explains and solves: a user's data lives in a specific Atlas zone regardless of
where they're currently connecting from, and routing by network latency instead of the
JWT's `location` claim would send their requests to the wrong region and turn every
MongoDB read into a cross-region one.

```
Input: request path, Authorization header (Bearer <token>) or access_token cookie
0. Path matches the pure-bypass allowlist (login, google, health)?
     -> forward unchanged, no check, no routing
0b. Path is refresh/logout, or register?
     -> unverified read of a location HINT from an existing cookie/Bearer token's
        payload (register also falls back to X-Client-Location) -> map via
        LOCATION_TO_REGION; no hint or unmapped -> bootstrap-region fallback,
        never blocks, skip to step 4
1. Token present and has exactly 3 dot-separated segments?  -> else 401
2. Base64url-decode segment 2 (payload), JSON.parse           (no crypto, no key)
3. payload.exp > now()?                                       -> else 401
   payload.location -> map to target region via LOCATION_TO_REGION (corrected to
   match the current plan: me groups with ap-south-1, not eu-west-1; cn/ru are
   excluded, not mapped anywhere) -> unmapped/undeployed region: bootstrap-region
   fallback (open question — see "Open questions" below)
4. Rewrite request.origin.custom.domainName to the target region's API Gateway
   custom domain; inject/propagate correlation ID header (see below)
5. Forward request
```

The pure-bypass allowlist (step 0) carries over unchanged from the current
implementation's `PURE_BYPASS_PATHS` (login, Google OAuth, health — see that file's
Lambda template for the authoritative list) — without it, unauthenticated endpoints like
login would be rejected for lacking a token before they ever get the chance to issue one.
Register is *not* in that bypass list in the current implementation (an earlier version
of this section grouped it there) — it gets its own hint-based handling (step 0b), same
as refresh/logout.

Reading `location` from the decoded-but-unverified payload is safe even though the
signature hasn't been checked yet: routing is not a security decision. A forged token
with a fake `location` only sends the request to a *different region's* API Gateway,
which still authoritatively verifies (or rejects) the signature — an attacker gains
nothing by lying about `location`, since they can't forge a signature to go with it.

No `crypto.verify`, no embedded public/private key, no Secrets Manager call for the
auth check — this is pure local computation on the unverified claim, which is what
makes "no key in Lambda@Edge" achievable. The auth check specifically is **not** a
security boundary — treat it as traffic-shedding only (see the WAF section above for
what covers the gap it leaves). Geo-routing was never a security boundary in the
current design either — it's an optimization, and remains one here.

### 3. Correlation ID propagation

A request now crosses CloudFront → Lambda@Edge (which picks the region) → API Gateway
→ Lambda Authorizer → ALB → ECS → MongoDB, with logs landing in whichever regions each
hop executed in. Without a shared ID, tracing one failed request is guesswork.

- **Lambda@Edge** (origin-request — the same single function described in Section 2,
  not a separate invocation): if the incoming request has no `X-Request-Id` header,
  generate one (UUID) and set it. If present (e.g., set by a mobile client or a retry),
  pass it through unchanged.
- **API Gateway**: pass `X-Request-Id` through to the Lambda Authorizer's event and to
  the backend integration (HTTP API parameter mapping) unmodified.
- **Lambda Authorizer**: include `X-Request-Id` in its structured logs so a rejected
  request can be traced from CloudWatch (edge region) to the regional authorizer's logs.
- **ECS**: read `X-Request-Id` from the incoming request header, include it in every log
  line for that request (structured logging, e.g. via a request-scoped logger context),
  and pass it downstream to any outbound calls (Mongo driver command comments, outbound
  HTTP calls) where the tooling supports it.
- **Response**: echo `X-Request-Id` back to the client in the response headers — lets a
  user/support ticket reference the exact ID when reporting an issue.

### 4. API Gateway HTTP API + Lambda Authorizer — authoritative check

- One HTTP API + one Lambda Authorizer **per region** (3 total), each reading the JWT
  signing key from its **regional Secrets Manager replica** (multi-region secret
  replication configured once, read locally in each region — no cross-region Secrets
  Manager calls).
- **Routes matching the pure-bypass paths (login, Google OAuth, health) must be defined
  without the authorizer attached.** HTTP API authorization is configured per-route — one
  of those routes simply has no `authorizer_id` on it. Without this, an unauthenticated
  login request forwarded unchanged by Lambda@Edge's bypass step (Section 2, step 0)
  would reach the Lambda Authorizer, which requires a valid signed JWT that doesn't exist
  yet, and get a spurious 401 — this is the same class of gap Lambda@Edge's own step-0
  bypass check exists to avoid, just one layer further in. Both lists (Lambda@Edge's
  bypass paths and HTTP API's no-authorizer routes) **must be kept in sync**, the same
  maintenance hazard the current implementation already flags for `LOCATION_TO_REGION`
  (see its Hard Rules section — note the current implementation has no
  `COUNTRY_TO_REGION` map at all, an earlier version of this note assumed one existed).
- Authorizer caches the fetched key in-memory per execution environment with a bounded
  TTL (e.g. 15 min), not indefinitely — so key rotation propagates without a redeploy.
- Authorizer performs full verification: signature, `exp`, `nbf`, `iss`, `aud`, and any
  role/claim checks needed for coarse-grained access control.
- On success, authorizer returns a `context` object. This **must include `iat`**, not
  just `userId`/`roles`/`tenantId` — see Section 5 for why (a real, shipped feature
  depends on it).
- Configure HTTP API integration parameter mapping to **overwrite** (not append) the
  corresponding header on the request forwarded to ECS — e.g.
  `overwrite:header.X-User-Id`, not `append:header.X-User-Id`. If a client supplies its
  own `X-User-Id`/`X-User-Roles`/`X-Token-Iat` header and the mapping only appends,
  ECS could see two values for the same header (order-dependent, or comma-joined),
  reopening exactly the header-spoofing hole the "lock down the VPC Link" mitigation in
  Section 5 doesn't cover (that mitigation only stops a client from *bypassing* API
  Gateway, not from supplying spoofed headers that *pass through* it).
- Enable **authorizer result caching** (per-token, up to 1hr TTL) to avoid re-running
  full verification on every repeat request from the same client within the window.
  Each region maintains its own independent cache — a token revoked while cached-valid
  in one region stays valid there until the cache TTL expires, even if another region
  has already picked up the revocation. This is a real, if narrow, additional gap this
  design accepts (see "Known gap" section) on top of the one already noted there.

### 5. ECS — drop the duplicate signature check, but preserve session revocation

- Remove JWT signature/expiry verification from the ECS application code — API Gateway's
  authorizer is now authoritative.
- ECS reads identity from the trusted headers injected by API Gateway (`X-User-Id`,
  `X-User-Roles`, `X-Token-Iat`, etc.) rather than re-parsing the raw token.
- **This is not optional**: `backend/app/deps.py` (lines ~56–65) already implements a
  live, DB-backed session-revocation check — comparing the token's `iat` claim against
  the user's `tokens_revoked_at` field — used by admin account-lock
  (`backend/app/routers/admin.py`) and self-service "log out everywhere"/account
  deletion (`backend/app/routers/auth.py`). If ECS no longer decodes the raw JWT, it
  loses `iat` unless the authorizer explicitly propagates it (Section 4). Skipping this
  silently disables a real, shipped security feature — a locked account or a "log out
  everywhere" action would stop actually revoking anything. Replicate the same
  `token_issued_at <= revoked_at` comparison in ECS using the propagated `X-Token-Iat`
  header instead of a decoded token.
- Keep (or add) **business-level authorization** in ECS — resource ownership, per-tenant
  access rules — this is a different concern from "is this token valid" and still
  belongs at the application layer.
- **Security dependency**: lock down the VPC Link/ALB security group so ECS is only
  reachable through the VPC Link's ENIs. This stops a client from *bypassing* API
  Gateway entirely, but does **not** stop a client that goes *through* API Gateway from
  also supplying its own `X-User-Id`/`X-User-Roles`/`X-Token-Iat` headers — that hole is
  closed only by the overwrite-parameter-mapping requirement in Section 4, not by this
  security group rule. Both are necessary; neither is sufficient alone.

### 6. Route 53

- `api.example.com`: ALIAS record → CloudFront distribution. (`infra-architecture-multi-region.md`'s
  own diagram only shows a generic "Route 53 (DNS)" node without specifying record type
  or domain — so this isn't verifiably "the same" as that doc, just a reasonable default
  for the same purpose.)
- Per-region API Gateway custom domains get plain (non-routing-policy) DNS records —
  Lambda@Edge selects among them directly by rewriting `request.origin.custom.domainName`
  per request, based on the JWT `location` claim (or the bootstrap-region fallback for
  bypass paths). There is no Route 53 latency-based or geolocation routing policy in this path;
  using one would make DNS pick a region by network proximity, undoing the data-locality
  routing Lambda@Edge is doing on purpose (see Section 2).
- **Regional failover is an open gap, same as today**: the current implementation
  explicitly does not configure CloudFront origin failover either (see its
  `checkov:skip=CKV_AWS_310` comment) — an unhealthy region isn't automatically routed
  around in either design. If this matters more here (three regions instead of one),
  it's worth solving explicitly rather than assumed away by switching to Route 53
  latency routing, which would silently reintroduce the data-locality problem to gain
  failover. A cleaner fix, if needed: Route 53 health checks feeding a per-region
  healthy/unhealthy flag that Lambda@Edge reads (e.g. via a small cached lookup or a
  periodically-refreshed value baked into the function) before falling back to a
  secondary region for that user's zone.

### 7. MongoDB Atlas Global Cluster (GEOSHARDED, exactly 3 zones)

**Correction: this is no longer an open decision.** An earlier version of this section
described `infra-architecture-multi-region.md`'s Change 10d as framing this as an open
choice between two options requiring a decision before implementation. That doc's Change
10d now reads: *"Decision (confirmed): Global Cluster, GEOSHARDED, exactly 3 zones"* —
settled, not restated as an assumption here. It also corrected a premise this section
inherited: there is no existing Terraform-managed `mongodbatlas_advanced_cluster`
resource to convert from `REPLICASET` — today's cluster is a manually-managed Atlas
**M0 (free tier)**, single region. This is a from-scratch bootstrap, not a migration
between cluster types. This proposal doesn't change any of that decision, and inherits
it unmodified:

- Shard key includes a region-affinity field (`location`), zone-mapped to each of the
  three target AWS regions (ap-south-1/eu-west-1/us-east-1) so writes/reads for a given
  zone's data stay local. `cn`/`ru` are excluded from every zone, not assigned one — see
  the corrected Atlas zone diagram above and the location-mapping table's note.
- Requires upgrading the Atlas project to a paid tier (M0 can't support Global Clusters,
  custom zone sharding, or PrivateLink) and building the whole `infra-live-atlas` module
  from scratch — a real bootstrap effort, not a config toggle, and one that needs its own
  rollout plan independent of the auth-layer changes above.
- Cross-zone queries (global aggregations) are the exception path, not the common case —
  application code should avoid triggering them on hot paths.

---

## Known gaps this design accepts

1. A structurally well-formed but cryptographically forged token (fake signature, but
   correct shape and a fabricated future `exp`) is no longer rejected at the edge — it
   travels to a regional API Gateway before being caught. This is the direct trade-off
   for removing key material from Lambda@Edge. The WAF rate-based rule (Section 1)
   bounds a **single-source** flood of this traffic; it does **not** bound a
   distributed one (many IPs, low rate each) — see Section 1 for why, and for what
   would actually be needed to close that gap.
2. Each region's API Gateway authorizer cache is independent. A token revoked while
   cached-valid in one region stays valid there until that region's cache TTL expires,
   even after another region has already picked up the revocation (Section 4).

## Open questions before this could become actionable

1. Does the cost/complexity delta vs the current Lambda@Edge-only plan (documented in
   `infra-architecture-multi-region.md`) justify removing key material from the edge? That
   doc's cost table shows API Gateway adding $1.00–3.50/M requests **per region** on top
   of CloudFront, which is already paid for either way.
2. Would embedding only the **public** key (as the current plan does) actually pose a
   meaningful leak risk, given a public key is not secret by design? If the concern is
   specifically about future migration to a symmetric (HMAC) scheme, that risk applies
   regardless of Lambda@Edge vs API Gateway — API Gateway's authorizer would need the
   same protection either way and gets it "for free" via Secrets Manager, but so could
   Lambda@Edge if it fetched a public key from a public, non-secret source instead of
   embedding it in code.
3. If this direction is pursued, `infra-architecture-multi-region.md` needs a formal decision
   entry (not a silent supersede). The key-management runbook for this variant already
   exists separately at [`docs/jwt-keys-alternate.md`](jwt-keys-alternate.md) —
   `docs/jwt-keys.md` itself is untouched and remains correct for the current,
   implemented architecture.
4. **What should happen to an authenticated request whose `location` is unmapped or maps
   to an undeployed region, given the edge Lambda here never verifies the signature?**
   The current plan can safely 503 that case, because by the time it makes that call the
   token has already been cryptographically verified — the failure is known to be a
   real, legitimate account hitting an infra gap, not a guess. This proposal's Lambda@Edge
   can't tell the difference between that and an attacker sending a forged token with a
   made-up `location` to see what happens, since no signature check has run yet. Falling
   through to the bootstrap region (as this doc currently assumes) forwards the ambiguity
   to the Lambda Authorizer, which will reject a forged token anyway — but a *legitimate*
   user with an undeployed location would then get routed to the wrong region's API
   Gateway and Authorizer instead of a clean, informative failure. Not resolved here.
