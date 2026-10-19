'use strict'

// Lambda@Edge origin-request — RS256 JWT validation + location-based backend
// routing.
// Runs on every /api/* request before forwarding to the ALB (cache is
// disabled for /api/*, so every request is an origin request). Must be
// origin-request, not viewer-request: CloudFront silently ignores changes to
// request.origin made in a viewer-request event, so routing would always
// land on the bootstrap origin.
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
//   jwt_public_keys      — map of kid => RSA public key PEM. A token whose
//                          header has no kid, or a kid not in this map, is
//                          rejected — there is no default key.
//   location_to_region   — map of location => AWS region (shared/routing.json,
//                          see ../terraform/routing.tf)
//   regional_alb_fqdns   — map of AWS region => internal ALB FQDN, one entry
//                          per region currently in var.backend_regions (see
//                          ../terraform/ssm_read.tf)
//   jwt_issuer           — required `iss` claim, "<app_name>-<environment>"
//   jwt_audience         — required `aud` claim, "<app_name>-api" (both built
//                          from the same expressions as the backend's
//                          JWT_ISSUER / JWT_AUDIENCE)
//
// Deliberately NOT a template variable: the X-Origin-Verify secret. Anything
// rendered here ends up in the function code, readable by anyone with
// lambda:GetFunction and replicated to every edge region. setOrigin() copies
// the header from the distribution's own alb-backend origin instead (see
// originCustomHeaders below), so rotating it is a CloudFront config change
// only — no Lambda redeploy.

const crypto = require('crypto')

const PUBLIC_KEYS = {
%{ for kid, pem in jwt_public_keys ~}
  ${jsonencode(kid)}: ${jsonencode(pem)},
%{ endfor ~}
}

// Parsed once per execution environment (at cold start), not per request —
// crypto.verify() with a PEM string re-parses the key on every call, which
// roughly doubles the CPU cost of each /api/* request. A malformed entry is
// skipped (its kid then fails as unknown → 401) instead of throwing here:
// a throw at module load would fail every /api/* request, login included.
const PUBLIC_KEY_OBJECTS = {}
for (const [kid, pem] of Object.entries(PUBLIC_KEYS)) {
  try {
    PUBLIC_KEY_OBJECTS[kid] = crypto.createPublicKey(pem)
  } catch (e) {
    console.error('jwt_public_keys: ignoring malformed key for kid ' + kid + ': ' + e.message)
  }
}

// The only algorithm the backend signs with (settings.jwt_algorithm). Checked
// explicitly so a token can never pick its own verification algorithm.
const EXPECTED_ALG = 'RS256'

// Tolerated clock skew between the region that minted a token and this edge
// location, in seconds — same value as the backend's JWT_LEEWAY_SECONDS.
const CLOCK_SKEW_LEEWAY_SECONDS = 30

// Every token must name this environment as issuer and this API as audience
// (EDGE-04), so a token from another environment fails even if it was signed
// with the same key. `aud` may be a string or a list, as in RFC 7519.
const EXPECTED_ISS = ${jsonencode(jwt_issuer)}
const EXPECTED_AUD = ${jsonencode(jwt_audience)}

function audienceMatches(aud) {
  return Array.isArray(aud) ? aud.includes(EXPECTED_AUD) : aud === EXPECTED_AUD
}

const COOKIE_NAME = 'access_token'
const CLIENT_LOCATION_HEADER = 'x-client-location'

const PURE_BYPASS_PATHS = ['/api/v1/auth/login', '/api/v1/auth/google', '/api/health']
const LOCATION_AWARE_PUBLIC_PATHS = ['/api/v1/auth/refresh', '/api/v1/auth/logout']
const REGISTER_PATH = '/api/v1/auth/register'

function matchesAnyPath(uri, paths) {
  return paths.some(p => uri === p || uri.startsWith(p + '/'))
}

// location => AWS region, injected from shared/routing.json (the repo-wide
// single source of truth — see ../terraform/routing.tf). Every location a token
// can carry is assigned by the backend from that same file at registration.
//
// Deliberately no default: a location absent here fails closed below (503).
// That covers legacy accounts carrying cn/ru — China legitimately requires
// AWS's separate China partition (a different account/infrastructure entirely,
// not reachable from here), and serving Russia from a commercial region carries
// export-control exposure (OFAC/EAR) this business has decided not to take on.
// Those countries (and other sanctioned ones) are now refused at registration,
// so no new account gets them, and a token carrying one gets a clean 503
// instead of silently landing somewhere compliance hasn't signed off on.
const LOCATION_TO_REGION = {
%{ for loc, region in location_to_region ~}
  ${jsonencode(loc)}: ${jsonencode(region)},
%{ endfor ~}
}

// Only regions actually applied via infra-live-backend appear here (see
// var.backend_regions) — a location that maps to a region not yet deployed
// fails closed the same way an unmapped location does.
const REGIONAL_ALB_FQDNS = {
%{ for region, fqdn in regional_alb_fqdns ~}
  '${region}': ${jsonencode(fqdn)},
%{ endfor ~}
}

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
// — staleness must still reject there, and `exp` is mandatory.
function verifyJwt(token, { ignoreExpiry = false } = {}) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed token')

  const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'))
  if (header.alg !== EXPECTED_ALG) throw new Error('unexpected alg: ' + header.alg)
  // Every token the backend issues carries a kid; one without is invalid.
  if (typeof header.kid !== 'string' || !header.kid) throw new Error('missing kid')

  const publicKey = PUBLIC_KEY_OBJECTS[header.kid]
  if (!publicKey) throw new Error('unknown kid: ' + header.kid)

  const signingInput = parts[0] + '.' + parts[1]
  const signature = base64urlDecode(parts[2])

  let valid
  try {
    valid = crypto.verify(
      'SHA256',
      Buffer.from(signingInput),
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      signature
    )
  } catch (_) {
    throw new Error('invalid signature')
  }
  if (!valid) throw new Error('invalid signature')

  const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'))
  // Checked even for routing hints: another environment's token must not
  // steer this environment's traffic either.
  if (payload.iss !== EXPECTED_ISS) throw new Error('unexpected iss')
  if (!audienceMatches(payload.aud)) throw new Error('unexpected aud')
  if (!ignoreExpiry) {
    const now = Math.floor(Date.now() / 1000)
    if (typeof payload.exp !== 'number') throw new Error('missing exp')
    if (now > payload.exp + CLOCK_SKEW_LEEWAY_SECONDS) throw new Error('expired')
    if (typeof payload.nbf === 'number' && now < payload.nbf - CLOCK_SKEW_LEEWAY_SECONDS) {
      throw new Error('not yet valid')
    }
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

// In an origin-request event, request.origin.custom.customHeaders holds the
// custom headers configured on the distribution's alb-backend origin
// (cloudfront.tf) — including X-Origin-Verify, which every regional ALB's
// listener rule requires. Replacing request.origin drops them, so carry them
// over unchanged. Returns {} if none are configured; the ALB then rejects the
// request with its default 403, the same as any other unverified caller.
function originCustomHeaders(request) {
  const custom = (request.origin && request.origin.custom) || {}
  return custom.customHeaders || {}
}

function setOrigin(request, albFqdn) {
  const customHeaders = originCustomHeaders(request)
  // A custom header can't share a name with a request header, or CloudFront
  // rejects the function's output (502). /api/* forwards all viewer headers,
  // so a viewer-sent X-Origin-Verify would otherwise collide. Drop the
  // viewer's copy — the configured value is the only one that counts.
  for (const name of Object.keys(customHeaders)) {
    delete request.headers[name]
  }
  request.origin = {
    custom: {
      domainName: albFqdn,
      port: 443,
      protocol: 'https',
      path: '',
      sslProtocols: ['TLSv1.2'],
      readTimeout: 60,
      keepaliveTimeout: 5,
      customHeaders,
    },
  }
  // In an origin-request event, Host already holds the distribution's
  // configured origin (the bootstrap region's ALB) and is NOT updated when
  // request.origin changes — it must be rewritten to match, or the selected
  // ALB receives the wrong Host (and TLS SNI) and the request fails.
  request.headers['host'] = [{ key: 'Host', value: albFqdn }]
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
  // Only access tokens authenticate API calls. A refresh token (longer-lived)
  // must not work as one — the backend rejects it too (deps.py), but failing
  // here keeps it off the ALB entirely.
  if (payload.type !== 'access') return unauthorized()

  let albFqdn
  try {
    albFqdn = resolveRegionalOrigin(payload.location)
  } catch (e) {
    return serviceUnavailable(e.message)
  }

  setOrigin(request, albFqdn)
  return request
}
