# Multi-Region Edge Routing — Design & Implementation Plan

This document is the single source of truth for the multi-region deployment architecture.
It covers the full rationale, updated architecture diagram, and every infra and code change
required. When implementing, refer only to this file.

---

## Background & Decision Trail

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

╔══════════════════╦══════════════════╦══════════════════╗
║   ap-south-1     ║   eu-west-1      ║   us-east-1      ║
║  (Mumbai)        ║  (Ireland)       ║  (N. Virginia)   ║
╠══════════════════╬══════════════════╬══════════════════╣
║ VPC              ║ VPC              ║ VPC              ║
║  [public subnet] ║  [public subnet] ║  [public subnet] ║
║  ALB (HTTPS/443) ║  ALB (HTTPS/443) ║  ALB (HTTPS/443) ║
║  NAT Gateway     ║  NAT Gateway     ║  NAT Gateway     ║
║  [private subnet]║  [private subnet]║  [private subnet]║
║  ECS Fargate     ║  ECS Fargate     ║  ECS Fargate     ║
║  Redis (in-VPC)  ║  Redis (in-VPC)  ║  Redis (in-VPC)  ║
╚══════════════════╩══════════════════╩══════════════════╝
  each region: outbound via NAT Gateway ──▶ ECR (regional) · Secrets Manager (regional)
         │                  │                  │
         │ TLS              │ TLS              │ TLS
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

Regions must be activated in sequence. The edge module reads ALB FQDNs from SSM; SSM is
only populated after `infra-live-backend` is applied in each region.

```
1. Apply infra-live-backend  (ap-south-1)  ← already done
2. Apply infra-live-backend  (eu-west-1)
3. Apply infra-live-backend  (us-east-1)
4. Apply infra-live-edge     (all three ALB FQDNs now in SSM)
```

Do not apply `infra-live-edge` until all three backend regions are applied. The Terraform
`data.aws_ssm_parameter` reads fail at plan time if the SSM parameter does not exist.

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
# API request without exception. See docs/multi-region-edge-routing.md.
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

Two changes are needed — the origin `domain_name` reference and the lambda association
event type:

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
`viewer-request` to `origin-request`:

```hcl
    # Remove the old viewer-request block and replace with:
    lambda_function_association {
      event_type   = "origin-request"
      lambda_arn   = aws_lambda_function.jwt_validator.qualified_arn
      include_body = false
    }
```

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

**a. `infra-live-backend/terraform/variables.tf`** — relax the `aws_region` validation
(currently locked to `ap-south-1`):
```hcl
validation {
  condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
  error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
}
```

**b. `.github/workflows/terraform-live-backend.yml`** — four edits in this file:

**b1. `aws_region` workflow_dispatch choices** — add the two new regions:
```yaml
options:
  - ap-south-1
  - eu-west-1
  - us-east-1
```

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

5. **Key rotation procedure (from `docs/jwt-keys.md`) is unchanged.** The function
   still uses a `PUBLIC_KEYS` map keyed by `kid`, supporting multi-key overlap windows.

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
- [ ] Apply `infra-live-backend` for the new region
- [ ] Add SSM read for the new region in `infra-live-edge/terraform/ssm_read.tf`
- [ ] Add the new ALB hostname template variable to the `templatefile()` call in `lambda_edge.tf` (`data "archive_file" "jwt_validator_lambda"`)
- [ ] Add the new template variable (`alb_<region_underscored>`) to the Lambda template `ALB_BY_REGION`
- [ ] Add entries to `LOCATION_TO_REGION` and `COUNTRY_TO_REGION` in the Lambda template for
      any new location/country values that should route to the new region
- [ ] Add the new region's SSM check to the "Verify SSM parameters" step in `terraform-live-edge.yml`
- [ ] Add the new region to `terraform-live-all.yml` `aws_region` workflow_dispatch choices
- [ ] Apply `infra-live-edge`
