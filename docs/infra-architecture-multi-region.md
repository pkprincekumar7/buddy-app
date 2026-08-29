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
current plan — one combined origin-request L@E function — is the minimal correct solution.

---

### Why not CloudFront Functions for JWT auth?

CloudFront Functions run in a sandboxed ES5.1 runtime. RS256 JWT verification requires
`crypto.verify()`, `Buffer`, and RSA-PKCS#1 PEM key parsing — none of which exist in
that runtime. Switching to HS256 (HMAC) would require embedding the shared secret inside
the function code, which is exposed in Terraform state. CloudFront Functions were
evaluated and ruled out for this reason.

### Why not two separate Lambda@Edge functions?

The original V2 plan placed JWT auth at `viewer-request` and geo-routing at
`origin-request`. This adds two sequential Lambda invocations per request. The
`viewer-request` placement for JWT exists to guard cached responses — but the `/api/*`
cache policy is `cache_policy_disabled` (every request is a cache miss), so
`origin-request` fires on every API request anyway. Moving JWT to `origin-request`
closes no security gap and allows both concerns to be handled in one function invocation.

**Architectural constraint:** Enabling a cache policy on any authenticated endpoint in
the future would bypass JWT validation (cached responses skip `origin-request`). This is
a hard rule: all `/api/*` behaviours must keep `cache_policy_id = local.cache_policy_disabled`.

### Why JWT `location` claim for routing instead of IP geo?

Pure IP geo routing (CloudFront-Viewer-Country) routes based on where the user
currently is, not where their data lives. A user registered in India (data in Atlas APAC
zone, `location=in`) travelling to the UK would be routed to eu-west-1, causing every
MongoDB read to cross regions (~150–200 ms penalty). The JWT access token already
carries a `location` claim (set at login from the user's stored `location` field in the
users collection). The combined L@E function decodes the token for auth anyway, so
reading `payload.location` for routing is free. IP geo is used only as a fallback for
unauthenticated public paths (login, register, health).

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
        │  origin-request (single fn)   │    │  (us-east-1)            │
        │                               │    │  OAC — no public access │
        │  Step 1: JWT auth (RS256)     │    └─────────────────────────┘
        │    • skip public paths        │
        │    • extract access_token     │
        │      cookie / Bearer header   │
        │    • verify signature + exp   │
        │    • 401 on failure           │
        │                               │
        │  Step 2: geo-routing          │
        │    • authenticated: read      │
        │      payload.location claim   │
        │    • public paths: read       │
        │      CloudFront-Viewer-       │
        │      Country header           │
        │    • rewrite origin hostname  │
        │      to nearest region's ALB  │
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
│  location: cn    │  location: ru    │                  │
├──────────────────┴──────────────────┴──────────────────┤
│         cross-zone replication (Atlas managed)         │
└────────────────────────────────────────────────────────┘
```

This whole diagram is the **target** state, not what's running today. Only ap-south-1
is live currently (single region, no PrivateLink); the eu-west-1/us-east-1 columns in
the backend VPC layout and the entire MongoDB Atlas Global Cluster box are all
bootstrap work — see the Deployment Order and Required Changes sections below for
exactly what's missing and in what order it needs to be built.

**TLS chain:**
```
Browser ──HTTPS──▶ CloudFront ──[L@E origin-request: JWT auth + geo-route]──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)                                                  (region ACM cert)
```

**Location → ALB region mapping:**

| JWT `location` value | Atlas zone | Routed to ALB region |
|---|---|---|
| `in` | APAC | ap-south-1 |
| `apac` | APAC | ap-south-1 |
| `cn` | APAC | ap-south-1 |
| `eu` | EU | eu-west-1 |
| `me` | EU | eu-west-1 |
| `ru` | EU | eu-west-1 |
| `us` | Americas | us-east-1 |
| `br` | Americas | us-east-1 |
| unknown / missing | — | fallback (see below) |

**Fallback for public paths (no JWT):** `CloudFront-Viewer-Country` header mapped using
the same country-to-region logic as `backend/app/routing.py`. If country is unknown,
defaults to `ap-south-1` (current single active region during rollout).

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

### 1. `infra-live-edge/functions/` — rename and rewrite the Lambda template

**File:** rename `jwt-validator-lambda.js.tpl` → `jwt-geo-router-lambda.js.tpl`

Replace the entire file content with:

```javascript
'use strict'

// Lambda@Edge origin-request — RS256 JWT validation + geo-routing
//
// Runs on every /api/* origin-request (cache is disabled on /api/*, so this
// fires on every API request without exception).
//
// Step 1: JWT auth — rejects unauthenticated requests with 401 before they
//         reach the ALB. Public paths listed in PUBLIC_PATHS are skipped.
// Step 2: Geo-routing — rewrites request.origin.custom.domainName to the ALB
//         nearest to the user's data location. Authenticated requests use the
//         `location` claim from the JWT payload (data-locality routing).
//         Public paths fall back to CloudFront-Viewer-Country IP geo.
//
// Template variables injected by Terraform templatefile():
//   jwt_public_keys — map of kid → RSA public key PEM (PKCS#8)
//   jwt_key_id      — default key ID when JWT header omits kid
//   alb_ap_south_1  — internal ALB FQDN for ap-south-1
//   alb_eu_west_1   — internal ALB FQDN for eu-west-1
//   alb_us_east_1   — internal ALB FQDN for us-east-1

const crypto = require('crypto')

const PUBLIC_KEYS = {
%{ for kid, pem in jwt_public_keys ~}
  '${kid}': ${jsonencode(pem)},
%{ endfor ~}
}

const DEFAULT_KID = '${jwt_key_id}'

// ALB FQDN per region — injected at deploy time from SSM via Terraform
const ALB_BY_REGION = {
  'ap-south-1': '${alb_ap_south_1}',
  'eu-west-1':  '${alb_eu_west_1}',
  'us-east-1':  '${alb_us_east_1}',
}

// JWT location claim → ALB region
// Keys here are the location values produced by backend/app/routing.py:resolve_region().
// If a new location value is added to routing.py, add a corresponding entry here.
const LOCATION_TO_REGION = {
  'in':   'ap-south-1',
  'apac': 'ap-south-1',
  'cn':   'ap-south-1',
  'eu':   'eu-west-1',
  'me':   'eu-west-1',
  'ru':   'eu-west-1',
  'us':   'us-east-1',
  'br':   'us-east-1',
}

// CloudFront-Viewer-Country → ALB region (fallback for public paths)
// All 56 country codes from backend/app/routing.py:COUNTRY_TO_REGION, mapped to the
// ALB region that serves each country's Atlas zone. Must stay in sync with that map.
const COUNTRY_TO_REGION = {
  // EU
  AT:'eu-west-1', BE:'eu-west-1', BG:'eu-west-1', CY:'eu-west-1', CZ:'eu-west-1',
  DE:'eu-west-1', DK:'eu-west-1', EE:'eu-west-1', ES:'eu-west-1', FI:'eu-west-1',
  FR:'eu-west-1', GR:'eu-west-1', HR:'eu-west-1', HU:'eu-west-1', IE:'eu-west-1',
  IT:'eu-west-1', LT:'eu-west-1', LU:'eu-west-1', LV:'eu-west-1', MT:'eu-west-1',
  NL:'eu-west-1', PL:'eu-west-1', PT:'eu-west-1', RO:'eu-west-1', SE:'eu-west-1',
  SI:'eu-west-1', SK:'eu-west-1', GB:'eu-west-1', NO:'eu-west-1', IS:'eu-west-1',
  LI:'eu-west-1', SA:'eu-west-1', AE:'eu-west-1', QA:'eu-west-1', KW:'eu-west-1',
  BH:'eu-west-1', OM:'eu-west-1', RU:'eu-west-1',
  // Americas
  US:'us-east-1', CA:'us-east-1', MX:'us-east-1', BR:'us-east-1',
  // APAC
  SG:'ap-south-1', MY:'ap-south-1', ID:'ap-south-1', PH:'ap-south-1',
  TH:'ap-south-1', VN:'ap-south-1', JP:'ap-south-1', KR:'ap-south-1',
  AU:'ap-south-1', NZ:'ap-south-1', HK:'ap-south-1', TW:'ap-south-1',
  IN:'ap-south-1', CN:'ap-south-1',
}

const DEFAULT_REGION = 'ap-south-1'

const COOKIE_NAME = 'access_token'

const PUBLIC_PATHS = [
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/google',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/health',
]

function base64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function parseCookies(headers) {
  const cookies = {}
  const cookieHeader = (headers['cookie'] || []).map(h => h.value).join('; ')
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=')
    if (idx < 0) return
    const k = pair.slice(0, idx).trim()
    const v = pair.slice(idx + 1).trim()
    cookies[k] = v
  })
  return cookies
}

function unauthorized() {
  return {
    status: '401',
    statusDescription: 'Unauthorized',
    headers: { 'content-type': [{ key: 'Content-Type', value: 'application/json' }] },
    body: JSON.stringify({ message: 'Unauthorized' }),
  }
}

function verifyJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed token')

  const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'))
  const kid = header.kid || DEFAULT_KID
  const publicKeyPem = PUBLIC_KEYS[kid]
  if (!publicKeyPem) throw new Error('unknown kid: ' + kid)

  const signingInput = parts[0] + '.' + parts[1]
  const signature = base64urlDecode(parts[2])

  let valid
  try {
    valid = crypto.verify(
      'SHA256',
      Buffer.from(signingInput),
      { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      signature
    )
  } catch (_) {
    throw new Error('invalid signature')
  }
  if (!valid) throw new Error('invalid signature')

  const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now > payload.exp) throw new Error('expired')
  if (payload.nbf && now < payload.nbf) throw new Error('not yet valid')

  return payload
}

function rewriteOrigin(request, targetRegion) {
  const alb = ALB_BY_REGION[targetRegion] || ALB_BY_REGION[DEFAULT_REGION]
  request.origin.custom.domainName = alb
  request.headers['host'] = [{ key: 'Host', value: alb }]
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request

  const isPublic = PUBLIC_PATHS.some(
    p => request.uri === p || request.uri.startsWith(p + '/')
  )

  if (isPublic) {
    // Geo-routing fallback: use CloudFront-Viewer-Country for public paths
    const country = ((request.headers['cloudfront-viewer-country'] || [])[0] || {}).value || ''
    const region = COUNTRY_TO_REGION[country.toUpperCase()] || DEFAULT_REGION
    rewriteOrigin(request, region)
    return request
  }

  // -- Step 1: JWT auth -------------------------------------------------------

  const cookies = parseCookies(request.headers)
  let token = cookies[COOKIE_NAME]

  if (!token) {
    const authHeader = ((request.headers['authorization'] || [])[0] || {}).value || ''
    if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7)
  }

  if (!token) return unauthorized()

  let payload
  try {
    payload = verifyJwt(token)
  } catch (_) {
    return unauthorized()
  }

  // -- Step 2: geo-routing using JWT location claim ---------------------------

  const location = (payload.location || '').toLowerCase()
  const region = LOCATION_TO_REGION[location] || DEFAULT_REGION
  rewriteOrigin(request, region)

  return request
}
```

---

### 2. `infra-live-edge/terraform/lambda_edge.tf` — update in-place (do not rename resources)

**Do not rename the Terraform resources or AWS resource names.** `function_name` and
`aws_iam_role.name` are immutable in AWS — renaming them forces destroy+create. For a
Lambda@Edge function, destroy fails while CloudFront replicas still exist ("Lambda was
unable to delete ... because it is a replicated function"). Updating the existing
resources in-place avoids this entirely: Terraform publishes a new Lambda version and
CloudFront continues to use the same function ARN structure.

Make the following targeted edits to the existing file:

**a.** In `data "archive_file" "jwt_validator_lambda"`, update the `source` block to
reference the renamed template file and add the three ALB variables:

```hcl
  source {
    content = templatefile(
      "${path.module}/../functions/jwt-geo-router-lambda.js.tpl",
      {
        jwt_public_keys = var.jwt_public_keys
        jwt_key_id      = var.jwt_key_id
        alb_ap_south_1  = data.aws_ssm_parameter.alb_fqdn_ap_south_1.value
        alb_eu_west_1   = data.aws_ssm_parameter.alb_fqdn_eu_west_1.value
        alb_us_east_1   = data.aws_ssm_parameter.alb_fqdn_us_east_1.value
      }
    )
    filename = "index.js"
  }
```

**b.** Update `output_path` in the same `data "archive_file"` block to reflect the new
zip name (optional but keeps the filename meaningful):

```hcl
  output_path = "${path.module}/jwt-geo-router-lambda.zip"
```

**c.** Update the top-of-file comment to reflect the new dual purpose:

```hcl
# Lambda@Edge — RS256 JWT validation + geo-routing (combined origin-request)
#
# Single function handles both concerns at origin-request event stage.
# Safe because /api/* has caching disabled — origin-request fires on every
# API request without exception. See docs/infra-architecture-multi-region.md.
```

All other resources (`aws_iam_role`, `aws_iam_role_policy_attachment`, `aws_lambda_function`,
`time_sleep`) remain unchanged. Terraform will publish a new Lambda version with the
updated code; the CloudFront lambda_function_association (Change 4) points to
`aws_lambda_function.jwt_validator.qualified_arn` which resolves to the new version.

---

### 3. `infra-live-edge/terraform/ssm_read.tf` — add per-region ALB reads

Replace the existing file entirely:

```hcl
# ---------------------------------------------------------------------------
# SSM reads — one ALB FQDN per backend region.
# Apply infra-live-backend in each region before applying infra-live-edge.
# The SSM path pattern is defined in infra-live-backend/terraform/ssm_write.tf.
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "alb_fqdn_ap_south_1" {
  name = "/${var.app_name}/${var.environment}/backend/ap-south-1/alb_internal_fqdn"
}

data "aws_ssm_parameter" "alb_fqdn_eu_west_1" {
  name = "/${var.app_name}/${var.environment}/backend/eu-west-1/alb_internal_fqdn"
}

data "aws_ssm_parameter" "alb_fqdn_us_east_1" {
  name = "/${var.app_name}/${var.environment}/backend/us-east-1/alb_internal_fqdn"
}
```

---

### 4. `infra-live-edge/terraform/cloudfront.tf` — three changes

Lambda@Edge at `origin-request` can rewrite `request.origin.custom.domainName` to any
hostname freely — the target does **not** need to be pre-registered as an origin in the
CloudFront distribution. The existing `alb-backend` origin block (pointing to ap-south-1)
is sufficient as the declared origin; the Lambda function dynamically overrides the
hostname at request time.

Three changes are needed — the origin `domain_name` reference, the lambda association
event type, and the checkov skip comment:

**Change a:** In the `alb-backend` origin block, update `domain_name` from the old
(now deleted) SSM data source to the ap-south-1 one:

```hcl
  origin {
    origin_id   = "alb-backend"
    domain_name = data.aws_ssm_parameter.alb_fqdn_ap_south_1.value  # was: alb_internal_fqdn
    ...
  }
```

This is the statically declared CloudFront origin hostname. Lambda@Edge dynamically
overrides `request.origin.custom.domainName` at runtime, so the declared hostname is
only used when Lambda@Edge does not rewrite it (which never happens for `/api/*`). It
must still reference a valid Terraform data source after Change 3 removes
`data.aws_ssm_parameter.alb_internal_fqdn`.

**Change b:** In the `/api/*` ordered_cache_behavior, change the lambda association from
`viewer-request` to `origin-request`. Only the `event_type` changes — everything else
(including `origin_request_policy_id = local.origin_request_all_viewer_except_host`)
stays unchanged:

```hcl
    # Change event_type from "viewer-request" to "origin-request" only:
    lambda_function_association {
      event_type   = "origin-request"
      lambda_arn   = aws_lambda_function.jwt_validator.qualified_arn
      include_body = false
    }
```

> The `origin_request_policy_id` on the same cache behavior is kept as-is.
> At `origin-request` the policy has already been applied before L@E fires, so
> there is no conflict. Do not remove it.

**Change c:** Update the checkov skip comment on the distribution to reflect multi-region:

```hcl
  #checkov:skip=CKV_AWS_310:Origin failover not configured — multi-region routing is handled by Lambda@Edge geo-routing; CloudFront origin failover is not used
```

No new origin blocks are needed in the distribution. The Lambda template receives all
three ALB FQDNs as injected variables and sets `request.origin.custom.domainName`
directly at runtime.

---

### 5. `infra-live-edge/terraform/variables.tf` — remove `backend_region`

The `backend_region` variable is no longer used (replaced by three explicit SSM reads).
Delete the entire `variable "backend_region"` block from `variables.tf`.

---

### 6. `.github/workflows/terraform-live-edge.yml` — extensive changes

`backend_region` appears in eight places in this workflow. All must be updated:

**a. `run-name`** — remove the `Backend: ${{ inputs.backend_region }}` suffix:
```yaml
run-name: "Terraform Live Edge (${{ inputs.action }}, ${{ inputs.environment }}, us-east-1)"
```

**b. `workflow_dispatch.inputs`** — delete the entire `backend_region` input block.

**c. `workflow_call.inputs`** — delete the entire `backend_region` input block.

**d. `concurrency.group`** — remove the `backend_region` segment:
```yaml
concurrency:
  group: terraform-live-edge-buddy360-${{ inputs.environment }}-us-east-1
  cancel-in-progress: false
```

**e. `env` block** — delete the `TF_VAR_backend_region` line.

**f. `Verify SSM parameters exist and are readable` step** — replace the single-path
check with checks for all three regions:
```yaml
- name: Verify SSM parameters exist and are readable
  if: inputs.action == 'plan' || inputs.action == 'apply'
  run: |
    check_ssm() {
      local name="$1"
      local value
      value=$(aws ssm get-parameter --region us-east-1 --name "$name" --query "Parameter.Value" --output text 2>&1)
      if [[ $? -ne 0 ]]; then
        echo "ERROR: Cannot read SSM parameter '$name': $value"
        echo "Ensure infra-live-backend has been applied in that region and the IAM role has ssm:GetParameter on this path."
        return 1
      fi
      echo "OK: $name"
    }
    APP="${{ secrets.APP_NAME }}"
    ENV="${{ inputs.environment }}"
    check_ssm "/$APP/$ENV/backend/ap-south-1/alb_internal_fqdn"
    check_ssm "/$APP/$ENV/backend/eu-west-1/alb_internal_fqdn"
    check_ssm "/$APP/$ENV/backend/us-east-1/alb_internal_fqdn"
```

**g. Step summary strings** — remove `Backend: ${{ inputs.backend_region }}` from both
the plan summary step and the destroy plan summary step.

**h. Artifact names** — remove `-backend-${{ inputs.backend_region }}` from both
upload-artifact steps:
```yaml
# plan artifact
name: tfplan-edge-${{ inputs.environment }}-us-east-1
# destroy artifact
name: tfplan-edge-destroy-${{ inputs.environment }}-us-east-1
```

---

### 7. `.github/workflows/terraform-live-all.yml` — remove `backend_region` and expand region choices

`terraform-live-all.yml` calls `terraform-live-edge.yml` via `workflow_call` and passes
`backend_region` in two places. Since `backend_region` is being removed from the edge
workflow's `workflow_call.inputs`, both call sites must be updated.

**a. Stale comment above `tf-edge` job** — remove this comment block (it references `backend_region`):
```yaml
# backend_region tells CloudFront which ALB to use as /api/* origin.
```

**b. `tf-edge` job `with:` block** — remove the `backend_region` line:
```yaml
tf-edge:
  name: "2 · Terraform Edge"
  needs: tf-backend
  if: inputs.action == 'plan' || inputs.action == 'apply'
  uses: ./.github/workflows/terraform-live-edge.yml
  with:
    action:      ${{ inputs.action }}
    environment: ${{ inputs.environment }}
  secrets: inherit
```

**c. `destroy-tf-edge` job `with:` block** — remove the `backend_region` line:
```yaml
destroy-tf-edge:
  name: "D2 · Terraform Edge (destroy)"
  needs: destroy-tf-frontend
  if: inputs.action == 'plan-destroy' || inputs.action == 'destroy'
  uses: ./.github/workflows/terraform-live-edge.yml
  with:
    action:      ${{ inputs.action }}
    environment: ${{ inputs.environment }}
  secrets: inherit
```

**d. `aws_region` workflow_dispatch choices** — add the two new regions:
```yaml
options:
  - ap-south-1
  - eu-west-1
  - us-east-1
```

**Note on tf-all and deployment sequencing:** `terraform-live-all.yml` cannot be used to
bootstrap the multi-region setup in a single run because `infra-live-edge` reads all
three ALB SSM parameters at plan time. If any backend region is not yet deployed, the
plan fails with "parameter not found". Follow the explicit deployment order in the
**Deployment Order** section above — apply each backend region manually first, then run
the edge workflow.

---

### 8. `infra-live-edge/terraform/tfvars/` — no changes needed

The three ALB FQDNs are read from SSM at apply time. `backend_region` is not present in
any of the four tfvars files (dev, sbx, stg, prod) — it was always supplied via
`TF_VAR_backend_region` in the workflow. No tfvars changes are needed.

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

**a. `infra-live-backend/terraform/variables.tf`** — two changes:

Relax the `aws_region` validation (currently locked to `ap-south-1`):
```hcl
validation {
  condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
  error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
}
```

Also add the `atlas_endpoint_service_name` variable — not yet implemented:
```hcl
# Set via SSM from terraform-atlas Phase 1. Empty until Phase 1 has run —
# aws_vpc_endpoint (Atlas PrivateLink) is skipped via count=0.
variable "atlas_endpoint_service_name" { default = "" }
```

This variable is consumed by `aws_vpc_endpoint.atlas_privatelink` — the Interface
endpoint + its security group that must be added to `infra-live-backend` before
applying new regions. See Change 10d Step 2 for the full resource definition.

Also remove or update the stale comment inside the `aws_region` variable block (lines 5–15
of the current file). Line 15 says "Update infra-live-edge/terraform/variables.tf similarly
— the edge module must read the ALB FQDN for whichever backend_region is being targeted."
This is no longer accurate after Change 5 (which removes `backend_region` from the edge
module). Replace the entire comment block with the updated checklist items from this document.

**b. `.github/workflows/terraform-live-backend.yml`** — four edits in this file:

**b1. `aws_region` workflow_dispatch choices** — add the two new regions:
```yaml
options:
  - ap-south-1
  - eu-west-1
  - us-east-1
```

**b1b. "Resolve Atlas SSM inputs" step** — this step does **not** exist in the workflow
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
> this doc's scope. For this doc's purposes, every `location` value the backend already
> produces (`in`/`apac`/`cn`/`eu`/`me`/`ru`/`us`/`br` — see
> `backend/app/routing.py:COUNTRY_TO_REGION`) collapses into exactly the three zones in
> the `LOCATION_TO_REGION` map above (APAC/EU/Americas), matching the `ALB_BY_REGION`/
> API-region targets this doc's Lambda@Edge function routes to. No further reconciliation
> is needed on the application side — `location` is already being captured on every
> token and user record (see Change 9) precisely so this remains infra-only work.
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
   The combined origin-request L@E approach is only safe because no API response is ever
   cached. Adding a non-zero TTL cache policy to any authenticated endpoint bypasses JWT
   validation for cached responses.

2. **The `location` claim in the JWT must always map to a key in `LOCATION_TO_REGION`.**
   If a new location string is added as an output of `backend/app/routing.py:resolve_region()`
   (i.e., as a new value in the `COUNTRY_TO_REGION` map, not a new country code key), a
   corresponding entry must be added to `LOCATION_TO_REGION` in the Lambda template.
   Missing entries fall back to `DEFAULT_REGION` (ap-south-1), which routes correctly
   during single-region operation but causes cross-region reads once all three regions
   are live.

3. **`COUNTRY_TO_REGION` in the Lambda template must stay in sync with
   `backend/app/routing.py:COUNTRY_TO_REGION`.** The backend map determines which Atlas
   shard a user's data lands on at registration. The Lambda map determines which ALB
   handles unauthenticated requests. Divergence causes new users' registration requests
   to land on a different ALB than the shard that will hold their data.

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
- [ ] Add SSM read for the new region in `infra-live-edge/terraform/ssm_read.tf`
- [ ] Add the new ALB hostname template variable to the `templatefile()` call in `lambda_edge.tf` (`data "archive_file" "jwt_validator_lambda"`)
- [ ] Add the new template variable (`alb_<region_underscored>`) to the Lambda template `ALB_BY_REGION`
- [ ] Add entries to `LOCATION_TO_REGION` and `COUNTRY_TO_REGION` in the Lambda template for
      any new location/country values that should route to the new region
- [ ] Add the new region's SSM check to the "Verify SSM parameters" step in `terraform-live-edge.yml`
- [ ] Add the new region to `terraform-live-all.yml` `aws_region` workflow_dispatch choices
- [ ] Apply `infra-live-edge`
