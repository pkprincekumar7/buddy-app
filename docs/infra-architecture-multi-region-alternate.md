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
risk than a private/symmetric key, but still key material at the edge). Both the current
plan's function and this proposal's run at CloudFront's `origin-request` stage, which
replicates only to CloudFront's Regional Edge Caches (a much smaller set than the
~400+ viewer-facing PoPs — see the diagram note below), not to every edge location; the
key-leak concern is about that smaller footprint, not the full edge network. This design
removes all key material from Lambda@Edge entirely, at the cost
of adding a regional hop (API Gateway) and reduced edge-side security filtering.

## Design summary

| Concern | Current plan (infra-architecture-multi-region.md) | This proposal |
|---|---|---|
| Signature verification | Lambda@Edge (RS256, public key embedded) | API Gateway Lambda Authorizer (Secrets Manager) |
| Lambda@Edge holds key material | Yes (public key) | **No** |
| Lambda@Edge's job | Full auth + geo-routing | Structural pre-filter (existence + expiry, unverified) + geo-routing (unchanged mechanism — see below) |
| Where a forged-but-well-formed token is caught | At the edge (signature fails) | At the regional API Gateway (signature fails) |
| ECS re-validates token | No (trusts Lambda@Edge) | No (trusts API Gateway authorizer context) |
| MongoDB | Still an open decision (Option A vs B, per that doc's Change 10d) | Assumes Option A (GEOSHARDED) — unaffected by the auth-layer choice either way |

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
        │  Step 1: structural pre-filter│
        │    • skip public paths        │
        │      (PUBLIC_PATHS)           │
        │    • token present, 3 dot-    │
        │      separated segments?      │
        │    • unverified read of `exp` │
        │      claim (no crypto, no key)│
        │    • 401 on failure           │
        │                               │
        │  Step 2: geo-routing          │
        │    • authenticated: read      │
        │      payload.location claim   │
        │      (unverified — safe,      │
        │      routing ≠ security)      │
        │    • public paths: read       │
        │      CloudFront-Viewer-       │
        │      Country header           │
        │    • rewrite origin hostname  │
        │      to nearest region's      │
        │      API Gateway domain       │
        │                               │
        │  Step 3: inject/propagate     │
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
║  PUBLIC_PATHS routes:     ║  PUBLIC_PATHS routes:     ║  PUBLIC_PATHS routes:     ║
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
│              (Option A — GEOSHARDED)                   │
├──────────────────┬──────────────────┬──────────────────┤
│   Zone: APAC     │    Zone: EU      │  Zone: Americas  │
│  (ap-south-1)    │  (eu-west-1)     │  (us-east-1)     │
│  location: in    │  location: eu    │  location: us    │
│  location: apac  │  location: me    │  location: br    │
│  location: cn    │  location: ru    │                  │
├──────────────────┴──────────────────┴──────────────────┤
│         cross-zone replication (Atlas managed)         │
└────────────────────────────────────────────────────────┘
```

**TLS / hop chain:**
```
Browser ──HTTPS──▶ CloudFront ──[L@E: pre-filter + geo-route]──▶ API Gateway ──[Lambda Authorizer: verify sig via Secrets Manager]──▶ VPC Link ──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)                                    (regional custom domain)                                                          (region ACM cert)
```

**Location → API Gateway region mapping:**

| JWT `location` value | Atlas zone | Routed to region's API Gateway |
|---|---|---|
| `in`, `apac`, `cn` | APAC | ap-south-1 |
| `eu`, `me`, `ru` | EU | eu-west-1 |
| `us`, `br` | Americas | us-east-1 |
| authenticated but unrecognized/missing `location` | — | `DEFAULT_REGION` (ap-south-1) |
| no token at all (public paths) | — | IP-geo fallback (see below), not `DEFAULT_REGION` |

**Fallback for public paths (no JWT):** `CloudFront-Viewer-Country` mapped via the same
country-to-region logic as `backend/app/routing.py`; if the country itself is
unrecognized, that also falls back to `DEFAULT_REGION` (ap-south-1).

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

This keeps the current implementation's `origin-request` placement and geo-routing
mechanism (Change 1 / Change 4b in `infra-architecture-multi-region.md`) — only the auth part
changes from full signature verification to a cheap unverified check. Geo-routing is
retained because Route 53 latency-based routing would route on network proximity, not
data locality, which is the exact problem the current doc's
["Why JWT `location` claim for routing instead of IP geo?"](infra-architecture-multi-region.md#why-jwt-location-claim-for-routing-instead-of-ip-geo)
section explains and solves: a user's data lives in a specific Atlas zone regardless of
where they're currently connecting from, and routing by network latency instead of the
JWT's `location` claim would send their requests to the wrong region and turn every
MongoDB read into a cross-region one.

```
Input: request path, Authorization header (Bearer <token>) or access_token cookie
0. Path matches the public allowlist (PUBLIC_PATHS)?
     -> geo-route by CloudFront-Viewer-Country fallback map, skip to step 4
1. Token present and has exactly 3 dot-separated segments?  -> else 401
2. Base64url-decode segment 2 (payload), JSON.parse           (no crypto, no key)
3. payload.exp > now()?                                       -> else 401
   payload.location -> map to target region (LOCATION_TO_REGION, same map as today)
4. Rewrite request.origin.custom.domainName to the target region's API Gateway
   custom domain; inject/propagate correlation ID header (see below)
5. Forward request
```

The public-path allowlist (step 0) carries over unchanged from the current
implementation's `PUBLIC_PATHS` list in `infra-architecture-multi-region.md` (registration,
login, Google OAuth, refresh, logout, health — see that file's Lambda template for the
authoritative list) — without it, unauthenticated endpoints like login/register would
be rejected for lacking a token before they ever get the chance to issue one.

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
- **Routes matching `PUBLIC_PATHS` must be defined without the authorizer attached.**
  HTTP API authorization is configured per-route — a login/register/refresh/health
  route simply has no `authorizer_id` on it. Without this, an unauthenticated login
  request routed here by Lambda@Edge's IP-geo fallback (Section 2) would reach the
  Lambda Authorizer, which requires a valid signed JWT that doesn't exist yet, and get a
  spurious 401 — this is the same class of gap Lambda@Edge's own `LE0` public-path check
  exists to avoid, just one layer further in. Both lists (Lambda@Edge's `PUBLIC_PATHS`
  and HTTP API's no-authorizer routes) **must be kept in sync**, the same maintenance
  hazard the current implementation already flags for `LOCATION_TO_REGION` /
  `COUNTRY_TO_REGION` (see its Hard Rules section).
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
  per request, based on the JWT `location` claim (or the IP-geo fallback for public
  paths). There is no Route 53 latency-based or geolocation routing policy in this path;
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

### 7. MongoDB Atlas Global Cluster (Option A — GEOSHARDED)

`infra-architecture-multi-region.md`'s Change 10d frames this as an **open, undecided**
choice between two options ("decision required before implementation"), not a settled
one. This proposal doesn't resolve that decision — it restates Option A as the one
assumed here, for the same reasons that doc gives, without additional justification:

- Shard key includes a region-affinity field (e.g. `location`), zone-mapped to each
  AWS region so writes/reads for a given zone's data stay local.
- Requires either converting the existing `REPLICASET` cluster to `GEOSHARDED` (via
  Atlas support migration) or standing up a new Global Cluster — this is a real data
  migration, not a config toggle, and needs its own rollout plan independent of the
  auth-layer changes above.
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
