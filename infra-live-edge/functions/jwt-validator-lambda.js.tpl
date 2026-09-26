'use strict'

// Lambda@Edge viewer-request — RS256 JWT validation + location-based backend
// routing.
// Runs on every /api/* viewer request before forwarding to the ALB.
// Invalid or missing tokens are rejected with 401 at the edge. A valid token
// whose location has no deployed backend region is rejected with 503 — there
// is no default region to fall back to.
//
// Not every path is authenticated /api/* traffic, and they don't all behave
// the same way:
//   PURE_BYPASS_PATHS         — login, google, health: no location signal
//                               exists yet (or matters), always land on the
//                               static bootstrap origin (local.bootstrap_region
//                               in ../terraform/cloudfront.tf) unchanged.
//   LOCATION_AWARE_PUBLIC_PATHS — refresh, logout: an existing session
//                               (access_token/refresh_token cookie for the
//                               web app, or an Authorization: Bearer header
//                               for the mobile app, which has no cookie jar
//                               at all) usually already carries location —
//                               read it as a best-effort routing HINT, not an
//                               auth check (the backend still does that
//                               itself). No hint found → same static
//                               fallback as PURE_BYPASS_PATHS, never blocked.
//   REGISTER_PATH             — register: same session-based hint first
//                               (rare, but a stale session from a prior
//                               visit on this device still counts), then
//                               falls back to the client-supplied
//                               X-Client-Location header the registration
//                               form sends. Still only a hint — never blocks
//                               the request, and never influences the
//                               account's real `location` field, which the
//                               backend always computes itself server-side
//                               from the validated
//                               country_code in the request body.
//
// Template variables (injected by Terraform templatefile(), see ../terraform/lambda_edge.tf):
//   jwt_public_keys      — map of kid => RSA public key PEM
//   jwt_key_id           — default key ID when JWT header omits kid
//   regional_alb_fqdns   — map of AWS region => internal ALB FQDN, one entry
//                          per region currently in var.backend_regions (see
//                          ../terraform/ssm_read.tf)
//   origin_verify_secret — shared secret sent as X-Origin-Verify to whichever
//                          regional ALB is selected below

const crypto = require('crypto')

const PUBLIC_KEYS = {
%{ for kid, pem in jwt_public_keys ~}
  '${kid}': ${jsonencode(pem)},
%{ endfor ~}
}

const DEFAULT_KID = '${jwt_key_id}'

const COOKIE_NAME = 'access_token'
const CLIENT_LOCATION_HEADER = 'x-client-location'

const PURE_BYPASS_PATHS = ['/api/v1/auth/login', '/api/v1/auth/google', '/api/health']
const LOCATION_AWARE_PUBLIC_PATHS = ['/api/v1/auth/refresh', '/api/v1/auth/logout']
const REGISTER_PATH = '/api/v1/auth/register'

function matchesAnyPath(uri, paths) {
  return paths.some(p => uri === p || uri.startsWith(p + '/'))
}

// Mirrors backend/app/routing.py's COUNTRY_TO_REGION groupings, collapsed to
// this app's 3 AWS regions. Every location a token can actually carry is
// produced by resolve_region() in backend/app/routing.py, whose only possible
// outputs are the 8 keys that would appear here: eu, us, br, apac, in, me,
// cn, ru.
//
// cn/ru are deliberately absent — NOT a default, an unrecognised value still
// fails closed below. Mapping them to a region was considered and reverted:
// China legitimately requires AWS's separate China partition (a different
// account/infrastructure entirely, not reachable from here), and serving
// Russia from a commercial region carries export-control exposure (OFAC/EAR)
// this business has decided not to take on. A token carrying either location
// gets a clean 503 instead of silently landing somewhere compliance hasn't
// signed off on.
const LOCATION_TO_REGION = {
  eu: 'eu-west-1',
  us: 'us-east-1',
  br: 'us-east-1',
  in: 'ap-south-1',
  apac: 'ap-south-1',
  me: 'ap-south-1',
  // cn: 'us-east-1', -- intentionally disabled, see comment above
  // ru: 'us-east-1', -- intentionally disabled, see comment above
}

// Only regions actually applied via infra-live-backend appear here (see
// var.backend_regions) — a location that maps to a region not yet deployed
// fails closed the same way an unmapped location does.
const REGIONAL_ALB_FQDNS = {
%{ for region, fqdn in regional_alb_fqdns ~}
  '${region}': ${jsonencode(fqdn)},
%{ endfor ~}
}

const ORIGIN_VERIFY_SECRET = ${jsonencode(origin_verify_secret)}

function base64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function parseCookies(headers) {
  const cookies = {}
  const cookieHeader = (headers['cookie'] || []).map(h => h.value).join('; ')
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=')
    if (idx < 0) return
    const key = pair.slice(0, idx).trim()
    const val = pair.slice(idx + 1).trim()
    cookies[key] = val
  })
  return cookies
}

function jsonErrorResponse(status, statusDescription, message) {
  return {
    status: String(status),
    statusDescription,
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'application/json' }],
      // /api/* already uses cache_policy_disabled so this would never be
      // cached anyway, but pin it explicitly — an error response must never
      // be servable to a different, legitimately authenticated user.
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: JSON.stringify({ message }),
  }
}

function unauthorized() {
  return jsonErrorResponse(401, 'Unauthorized', 'Unauthorized')
}

// No default region: a location absent from LOCATION_TO_REGION, or a region
// absent from REGIONAL_ALB_FQDNS (not yet deployed), fails the request
// instead of guessing an origin.
function serviceUnavailable(message) {
  return jsonErrorResponse(503, 'Service Unavailable', message)
}

// Resolves the token's location claim to a regional ALB FQDN. Throws (never
// returns a fallback) when the location is unmapped or its region isn't
// deployed yet — the caller converts that into a 503.
function resolveRegionalOrigin(location) {
  const region = LOCATION_TO_REGION[location]
  if (!region) {
    throw new Error('unsupported location: ' + location)
  }
  const fqdn = REGIONAL_ALB_FQDNS[region]
  if (!fqdn) {
    throw new Error('backend not provisioned for region: ' + region)
  }
  return fqdn
}

// ignoreExpiry: used only for the routing-hint helpers below, where a stale
// (expired, but still correctly signed) cookie's location claim is still a
// trustworthy hint even though it can no longer authenticate anything. The
// real authenticated /api/* path always calls this with the default (false)
// — staleness must still reject there.
function verifyJwt(token, { ignoreExpiry = false } = {}) {
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
  if (!ignoreExpiry) {
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && now > payload.exp) throw new Error('expired')
    if (payload.nbf && now < payload.nbf) throw new Error('not yet valid')
  }

  return payload
}

// Best-effort location hint from an existing session, for the PUBLIC_PATHS
// that have no fresh access_token to route by otherwise. Tries, in order:
// the access_token cookie, the refresh_token cookie, then the Authorization
// Bearer header — the last one matters for the mobile app, which has no
// cookie jar at all and sends both its access token (on ordinary calls) and
// its refresh token (specifically on /auth/refresh) as a Bearer header
// instead. Whichever token is found, only its `location` claim is read, so
// it works the same way regardless of whether it's an access or refresh
// token. Signature is still checked (a forged token shouldn't be able to
// steer routing), but expiry is deliberately ignored since staleness doesn't
// matter for a hint that never authenticates anything. Returns null on any
// failure; callers must treat null as "no hint" and fall back to the static
// bootstrap origin, never block the request.
function locationHintFromSession(request, cookies) {
  const candidates = [cookies[COOKIE_NAME], cookies['refresh_token']]
  const authHeader = ((request.headers['authorization'] || [])[0] || {}).value || ''
  if (authHeader.startsWith('Bearer ')) {
    candidates.push(authHeader.slice(7))
  }
  for (const token of candidates) {
    if (!token) continue
    try {
      const payload = verifyJwt(token, { ignoreExpiry: true })
      if (payload.location) return payload.location
    } catch (_) {
      // try the next candidate
    }
  }
  return null
}

// Best-effort location hint from the client-supplied header the
// registration form sends (see frontend/src/lib/locationHint.ts) — the raw
// country the user is about to register with, resolved client-side. Never
// trusted for anything beyond picking which region's ALB handles this one
// bootstrap call: the account's real `location` field is always computed
// server-side from the validated country_code in the request body,
// regardless of which region processes it, so a missing/wrong/forged header
// only costs latency, never correctness.
function locationHintFromHeader(request) {
  const raw = ((request.headers[CLIENT_LOCATION_HEADER] || [])[0] || {}).value || ''
  const location = raw.trim().toLowerCase()
  return location || null
}

// Applies a resolved hint to request.origin, or leaves the request
// unchanged (falling through to the static bootstrap origin) if there is no
// hint, or the hint doesn't resolve to a deployed region. Never blocks.
function applyLocationHint(request, hint) {
  if (!hint) return request
  let albFqdn
  try {
    albFqdn = resolveRegionalOrigin(hint)
  } catch (_) {
    return request
  }
  setOrigin(request, albFqdn)
  return request
}

function setOrigin(request, albFqdn) {
  request.origin = {
    custom: {
      domainName: albFqdn,
      port: 443,
      protocol: 'https',
      path: '',
      sslProtocols: ['TLSv1.2'],
      readTimeout: 60,
      keepaliveTimeout: 5,
      customHeaders: {
        'x-origin-verify': [{ key: 'X-Origin-Verify', value: ORIGIN_VERIFY_SECRET }],
      },
    },
  }
  // Host is read-only in viewer-request events (AWS's documented edge-function
  // restrictions) — setting it here fails CloudFront's validation with a 502
  // ("tried to add, delete, or change a read-only header"). No need to
  // anyway: for a custom origin, CloudFront always sends the origin's own
  // domainName (set above) as the Host header, regardless of what the
  // /api/* cache behaviour's origin request policy (AllViewerExceptHostHeader)
  // forwards from the viewer — that policy's exclusion of Host is exactly
  // why this is automatic.
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request
  const cookies = parseCookies(request.headers)

  if (matchesAnyPath(request.uri, PURE_BYPASS_PATHS)) {
    return request
  }

  if (matchesAnyPath(request.uri, LOCATION_AWARE_PUBLIC_PATHS)) {
    return applyLocationHint(request, locationHintFromSession(request, cookies))
  }

  if (request.uri === REGISTER_PATH || request.uri.startsWith(REGISTER_PATH + '/')) {
    const hint = locationHintFromSession(request, cookies) || locationHintFromHeader(request)
    return applyLocationHint(request, hint)
  }

  let token = cookies[COOKIE_NAME]

  if (!token) {
    const authHeader = ((request.headers['authorization'] || [])[0] || {}).value || ''
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
  }

  if (!token) return unauthorized()

  let payload
  try {
    payload = verifyJwt(token)
  } catch (e) {
    return unauthorized()
  }

  let albFqdn
  try {
    albFqdn = resolveRegionalOrigin(payload.location)
  } catch (e) {
    return serviceUnavailable(e.message)
  }

  setOrigin(request, albFqdn)
  return request
}
