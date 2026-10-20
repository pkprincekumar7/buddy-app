'use strict'

// Functional test suite for jwt-validator-lambda.js.tpl — the Lambda@Edge
// that does RS256 JWT validation and location-based backend routing (see the
// .tpl file's own top-of-file comment for the full design).
//
// Renders the actual .tpl through real Terraform (not a hand-rolled
// reimplementation of HCL's templatefile() syntax) so these tests exercise
// exactly what gets deployed, not an approximation of it. Requires the
// `terraform` CLI on PATH — skips with a clear message if it isn't found,
// rather than failing every other test file in the repo.
//
// Run with: node --test infra-live-edge/functions/jwt-validator-lambda.test.js

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const TEMPLATE_PATH = path.join(__dirname, 'jwt-validator-lambda.js.tpl')

// What lambda_edge.tf builds for app_name "superpower", environment "dev".
const ISS = 'superpower-dev'
const AUD = 'superpower-api'

// The real location => region map, derived from the repo-wide source of truth
// exactly as ../terraform/routing.tf does, so the tests route like production.
const ROUTING = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'routing.json'), 'utf8'),
)
const LOCATION_TO_REGION = Object.fromEntries(
  Object.entries(ROUTING.regions).flatMap(([region, { locations }]) =>
    locations.map((loc) => [loc, region]),
  ),
)

function terraformAvailable() {
  try {
    execFileSync('terraform', ['version'], { stdio: 'ignore' })
    return true
  } catch (_) {
    return false
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Renders jwt-validator-lambda.js.tpl through a real `terraform apply` in a
// throwaway temp directory, using the supplied test RSA public key and a
// small fixed regional_alb_fqdns map. Returns the rendered JS source as a
// string. Cleans up the temp directory before returning.
//
// Deliberately passes no origin_verify_secret: templatefile() errors on any
// variable the template references but isn't given, so a successful render
// here proves the secret can't end up in the deployed code (EDGE-02).
function renderTemplate({ publicKeyPem, regionalAlbFqdns }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-validator-lambda-test-'))
  try {
    const tf = `
terraform {
  required_version = ">= 1.0.0"
}
locals {
  rendered = templatefile(${JSON.stringify(TEMPLATE_PATH)}, {
    jwt_public_keys      = { "key-v1" = ${JSON.stringify(publicKeyPem)} }
    regional_alb_fqdns    = ${JSON.stringify(regionalAlbFqdns)}
    location_to_region    = ${JSON.stringify(LOCATION_TO_REGION)}
    jwt_issuer            = ${JSON.stringify(ISS)}
    jwt_audience          = ${JSON.stringify(AUD)}
  })
}
output "rendered" {
  value = local.rendered
}
`
    fs.writeFileSync(path.join(dir, 'main.tf'), tf)
    execFileSync('terraform', ['init', '-input=false'], { cwd: dir, stdio: 'ignore' })
    execFileSync('terraform', ['apply', '-auto-approve', '-input=false'], { cwd: dir, stdio: 'ignore' })
    return execFileSync('terraform', ['output', '-raw', 'rendered'], { cwd: dir }).toString('utf8')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function loadLambda(rendered) {
  // Same secure-temp-file pattern as renderTemplate() above: mkdtempSync creates
  // a uniquely-named, owner-only-permissioned directory atomically, instead of
  // writing a predictably-named file straight into the shared os.tmpdir() (which
  // a local attacker could race or pre-plant a symlink at, before this code
  // require()s — i.e. executes — whatever ends up at that path).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-validator-lambda-rendered-'))
  const modulePath = path.join(dir, 'index.js')
  fs.writeFileSync(modulePath, rendered)
  try {
    delete require.cache[require.resolve(modulePath)]
    return require(modulePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// The X-Origin-Verify value the distribution's alb-backend origin carries in
// these tests — what CloudFront puts in request.origin.custom.customHeaders.
const ORIGIN_VERIFY_VALUE = 'origin-verify-from-cloudfront-config'

function mockRequest(uri, { cookies = {}, headers = {}, originCustomHeaders } = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  const h = {}
  if (cookieHeader) h['cookie'] = [{ key: 'Cookie', value: cookieHeader }]
  for (const [k, v] of Object.entries(headers)) {
    h[k.toLowerCase()] = [{ key: k, value: v }]
  }
  return {
    uri,
    headers: h,
    origin: {
      custom: {
        domainName: 'placeholder.example.com',
        customHeaders: originCustomHeaders || {
          'x-origin-verify': [{ key: 'X-Origin-Verify', value: ORIGIN_VERIFY_VALUE }],
        },
      },
    },
  }
}

async function invoke(lambda, request) {
  return lambda.handler({ Records: [{ cf: { request } }] })
}

test('jwt-validator-lambda', { skip: !terraformAvailable() && 'terraform CLI not found on PATH' }, async (t) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' })

  // Defaults match what the backend issues: alg RS256, a kid, and an exp 30
  // minutes out. Options override each one for the negative tests.
  function signJwt(payload, { kid = 'key-v1', exp, alg = 'RS256', omitKid = false, omitExp = false } = {}) {
    const header = { alg, typ: 'JWT' }
    if (!omitKid) header.kid = kid
    const fullPayload = { iat: Math.floor(Date.now() / 1000), iss: ISS, aud: AUD, ...payload }
    if (!omitExp) fullPayload.exp = exp !== undefined ? exp : Math.floor(Date.now() / 1000) + 1800
    const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(fullPayload))
    const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    })
    return signingInput + '.' + b64url(signature)
  }

  const rendered = renderTemplate({
    publicKeyPem,
    regionalAlbFqdns: { 'ap-south-1': 'alb.ap-south-1.example.com', 'eu-west-1': 'alb.eu-west-1.example.com' },
  })
  const lambda = loadLambda(rendered)

  await t.test('pure bypass paths (login/google/health) never override origin', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/login'))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
  })

  await t.test('register with no signal at all falls through to the bootstrap origin', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/register'))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
  })

  await t.test('register with only the X-Client-Location header routes to that region', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/register', { headers: { 'X-Client-Location': 'eu' } }))
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('register: an expired but validly-signed session cookie wins over the header', async () => {
    const expiredToken = signJwt({ sub: 'u1', type: 'access', location: 'eu' }, { exp: Math.floor(Date.now() / 1000) - 3600 })
    const res = await invoke(
      lambda,
      mockRequest('/api/v1/auth/register', {
        cookies: { access_token: expiredToken },
        headers: { 'X-Client-Location': 'us' },
      })
    )
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('register: a forged (bad signature) cookie is ignored, falls through unchanged', async () => {
    const forged = signJwt({ sub: 'u1', type: 'access', location: 'eu' })
    const tampered = forged.slice(0, -5) + 'AAAAA'
    const res = await invoke(lambda, mockRequest('/api/v1/auth/register', { cookies: { access_token: tampered } }))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
  })

  await t.test('refresh: a valid refresh_token cookie routes by its location claim', async () => {
    const refreshToken = signJwt({ sub: 'u1', type: 'refresh', jti: 'j1', location: 'eu' })
    const res = await invoke(lambda, mockRequest('/api/v1/auth/refresh', { cookies: { refresh_token: refreshToken } }))
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('logout: no cookie at all falls through unchanged, never blocked', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/logout'))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
    assert.equal(res.status, undefined)
  })

  await t.test('refresh: a location mapped to a region not yet deployed falls through unchanged, not 503', async () => {
    const refreshToken = signJwt({ sub: 'u1', type: 'refresh', jti: 'j1', location: 'br' })
    const res = await invoke(lambda, mockRequest('/api/v1/auth/refresh', { cookies: { refresh_token: refreshToken } }))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
    assert.equal(res.status, undefined)
  })

  await t.test('rerouting also rewrites Host to the selected ALB', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/me', { cookies: { access_token: signJwt({ type: 'access', location: 'eu' }) } }))
    assert.equal(res.headers['host'][0].value, 'alb.eu-west-1.example.com')
  })

  await t.test('authenticated /api/* call with a valid token routes by location', async () => {
    const accessToken = signJwt({ sub: 'u1', type: 'access', location: 'eu' }, { exp: Math.floor(Date.now() / 1000) + 1800 })
    const res = await invoke(lambda, mockRequest('/api/v1/users/me', { cookies: { access_token: accessToken } }))
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('authenticated /api/* call with an expired token: 401 (staleness must reject here)', async () => {
    const expiredToken = signJwt({ sub: 'u1', type: 'access', location: 'eu' }, { exp: Math.floor(Date.now() / 1000) - 3600 })
    const res = await invoke(lambda, mockRequest('/api/v1/users/me', { cookies: { access_token: expiredToken } }))
    assert.equal(res.status, '401')
  })

  await t.test('authenticated /api/* call with location=cn (deliberately excluded): 503', async () => {
    const accessToken = signJwt({ sub: 'u1', type: 'access', location: 'cn' }, { exp: Math.floor(Date.now() / 1000) + 1800 })
    const res = await invoke(lambda, mockRequest('/api/v1/users/me', { cookies: { access_token: accessToken } }))
    assert.equal(res.status, '503')
  })

  await t.test('mobile: refresh_token sent as Authorization: Bearer (no cookie jar) still routes correctly', async () => {
    const refreshToken = signJwt({ sub: 'u1', type: 'refresh', jti: 'j1', location: 'eu' })
    const res = await invoke(
      lambda,
      mockRequest('/api/v1/auth/refresh', { headers: { Authorization: `Bearer ${refreshToken}` } })
    )
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('mobile: register with a stale Bearer access_token still wins over the X-Client-Location header', async () => {
    const accessToken = signJwt({ sub: 'u1', type: 'access', location: 'eu' }, { exp: Math.floor(Date.now() / 1000) - 10 })
    const res = await invoke(
      lambda,
      mockRequest('/api/v1/auth/register', {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Client-Location': 'us' },
      })
    )
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('mobile: logout with no token at all falls through unchanged, never blocked', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/logout'))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
  })

  // -- EDGE-04: stricter validation on authenticated paths --------------------

  const now = () => Math.floor(Date.now() / 1000)
  const callMe = (token) => invoke(lambda, mockRequest('/api/v1/users/me', { cookies: { access_token: token } }))

  await t.test('EDGE-04: a token with no exp is rejected (401)', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu' }, { omitExp: true }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: a refresh token on an authenticated path is rejected (401)', async () => {
    const res = await callMe(signJwt({ type: 'refresh', jti: 'j1', location: 'eu' }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: a token with no type is rejected (401)', async () => {
    const res = await callMe(signJwt({ location: 'eu' }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: a header alg other than RS256 is rejected (401), even with a valid RS256 signature', async () => {
    for (const alg of ['HS256', 'none', 'RS512']) {
      const res = await callMe(signJwt({ type: 'access', location: 'eu' }, { alg }))
      assert.equal(res.status, '401', alg)
    }
  })

  await t.test('EDGE-04: a token with no kid is rejected (401) — no default key', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu' }, { omitKid: true }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: an unknown kid is rejected (401)', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu' }, { kid: 'key-v9' }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: a token expired 10 s ago is still inside the 30 s leeway', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu' }, { exp: now() - 10 }))
    assert.equal(res.status, undefined)
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('EDGE-04: a token expired 60 s ago is outside the leeway (401)', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu' }, { exp: now() - 60 }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: nbf in the future beyond the leeway is rejected; inside it is allowed', async () => {
    assert.equal((await callMe(signJwt({ type: 'access', location: 'eu', nbf: now() + 120 }))).status, '401')
    assert.equal((await callMe(signJwt({ type: 'access', location: 'eu', nbf: now() + 10 }))).status, undefined)
  })

  await t.test('EDGE-04: routing hints still accept an expired, correctly signed refresh token', async () => {
    const stale = signJwt({ type: 'refresh', jti: 'j1', location: 'eu' }, { exp: now() - 86400 })
    const res = await invoke(lambda, mockRequest('/api/v1/auth/refresh', { cookies: { refresh_token: stale } }))
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test('EDGE-04: a routing hint with a bad alg is ignored, never trusted', async () => {
    const bad = signJwt({ type: 'refresh', jti: 'j1', location: 'eu' }, { alg: 'HS256' })
    const res = await invoke(lambda, mockRequest('/api/v1/auth/refresh', { cookies: { refresh_token: bad } }))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
  })

  // -- EDGE-04: iss / aud bind a token to this environment and API -------------

  await t.test('EDGE-04: a token from another environment (same key) is rejected (401)', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu', iss: 'superpower-prod' }))
    assert.equal(res.status, '401')
  })

  await t.test('EDGE-04: a wrong audience (string or list) is rejected (401)', async () => {
    assert.equal((await callMe(signJwt({ type: 'access', location: 'eu', aud: 'other-api' }))).status, '401')
    assert.equal((await callMe(signJwt({ type: 'access', location: 'eu', aud: ['other-api'] }))).status, '401')
  })

  await t.test('EDGE-04: missing iss or aud is rejected (401)', async () => {
    assert.equal((await callMe(signJwt({ type: 'access', location: 'eu', iss: undefined }))).status, '401')
    assert.equal((await callMe(signJwt({ type: 'access', location: 'eu', aud: undefined }))).status, '401')
  })

  await t.test('EDGE-04: an audience list containing ours is accepted', async () => {
    const res = await callMe(signJwt({ type: 'access', location: 'eu', aud: ['other-api', AUD] }))
    assert.equal(res.status, undefined)
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
  })

  await t.test("EDGE-04: another environment's token can't steer routing hints either", async () => {
    const foreign = signJwt({ type: 'refresh', jti: 'j1', location: 'eu', iss: 'superpower-prod' })
    const res = await invoke(lambda, mockRequest('/api/v1/auth/refresh', { cookies: { refresh_token: foreign } }))
    assert.equal(res.origin.custom.domainName, 'placeholder.example.com')
  })

  // -- EDGE-02: X-Origin-Verify comes from the distribution config, not the code --

  await t.test('authenticated re-route carries the configured X-Origin-Verify header over', async () => {
    const accessToken = signJwt({ type: 'access', location: 'eu' })
    const res = await invoke(lambda, mockRequest('/api/v1/users/me', { cookies: { access_token: accessToken } }))
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
    assert.deepEqual(res.origin.custom.customHeaders, {
      'x-origin-verify': [{ key: 'X-Origin-Verify', value: ORIGIN_VERIFY_VALUE }],
    })
  })

  await t.test('hint-based re-route (refresh) also carries the X-Origin-Verify header over', async () => {
    const refreshToken = signJwt({ sub: 'u1', type: 'refresh', jti: 'j1', location: 'eu' })
    const res = await invoke(lambda, mockRequest('/api/v1/auth/refresh', { cookies: { refresh_token: refreshToken } }))
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
    assert.equal(res.origin.custom.customHeaders['x-origin-verify'][0].value, ORIGIN_VERIFY_VALUE)
  })

  await t.test('a rotated value in the distribution config is used as-is (no redeploy needed)', async () => {
    const accessToken = signJwt({ type: 'access', location: 'eu' })
    const res = await invoke(
      lambda,
      mockRequest('/api/v1/users/me', {
        cookies: { access_token: accessToken },
        originCustomHeaders: { 'x-origin-verify': [{ key: 'X-Origin-Verify', value: 'rotated-value' }] },
      })
    )
    assert.equal(res.origin.custom.customHeaders['x-origin-verify'][0].value, 'rotated-value')
  })

  await t.test('origin with no custom headers: re-route still works and sends none (ALB 403s it)', async () => {
    const accessToken = signJwt({ type: 'access', location: 'eu' })
    const req = mockRequest('/api/v1/users/me', { cookies: { access_token: accessToken } })
    delete req.origin.custom.customHeaders
    const res = await invoke(lambda, req)
    assert.equal(res.origin.custom.domainName, 'alb.eu-west-1.example.com')
    assert.deepEqual(res.origin.custom.customHeaders, {})
  })

  await t.test('re-route drops a viewer-sent X-Origin-Verify so it cannot collide with the custom header', async () => {
    const accessToken = signJwt({ type: 'access', location: 'eu' })
    const res = await invoke(
      lambda,
      mockRequest('/api/v1/users/me', {
        cookies: { access_token: accessToken },
        headers: { 'X-Origin-Verify': 'viewer-guess' },
      })
    )
    assert.equal(res.headers['x-origin-verify'], undefined)
    assert.equal(res.origin.custom.customHeaders['x-origin-verify'][0].value, ORIGIN_VERIFY_VALUE)
  })

  await t.test('bypass paths leave the configured origin (and its header) untouched', async () => {
    const res = await invoke(lambda, mockRequest('/api/v1/auth/login'))
    assert.equal(res.origin.custom.customHeaders['x-origin-verify'][0].value, ORIGIN_VERIFY_VALUE)
  })
})

test('a malformed key in jwt_public_keys is skipped, not fatal for the whole function', { skip: !terraformAvailable() && 'terraform CLI not found on PATH' }, async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const good = publicKey.export({ type: 'spki', format: 'pem' })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-validator-lambda-badkey-'))
  let rendered
  try {
    fs.writeFileSync(path.join(dir, 'main.tf'), `
locals {
  rendered = templatefile(${JSON.stringify(TEMPLATE_PATH)}, {
    jwt_public_keys    = { "key-v1" = ${JSON.stringify(good)}, "key-bad" = "-----BEGIN PUBLIC KEY-----\\nnot a key\\n-----END PUBLIC KEY-----\\n" }
    regional_alb_fqdns = { "eu-west-1" = "alb.eu-west-1.example.com" }
    location_to_region = ${JSON.stringify(LOCATION_TO_REGION)}
    jwt_issuer         = ${JSON.stringify(ISS)}
    jwt_audience       = ${JSON.stringify(AUD)}
  })
}
output "rendered" { value = local.rendered }
`)
    execFileSync('terraform', ['init', '-input=false'], { cwd: dir, stdio: 'ignore' })
    execFileSync('terraform', ['apply', '-auto-approve', '-input=false'], { cwd: dir, stdio: 'ignore' })
    rendered = execFileSync('terraform', ['output', '-raw', 'rendered'], { cwd: dir }).toString('utf8')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  const origError = console.error
  const logged = []
  console.error = (msg) => logged.push(msg)
  let lambda
  try {
    lambda = loadLambda(rendered)
  } finally {
    console.error = origError
  }
  assert.ok(logged.some((m) => m.includes('key-bad')))

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'key-v1' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = Buffer.from(JSON.stringify({ sub: 'u1', type: 'access', location: 'eu', iat: now, exp: now + 600, iss: ISS, aud: AUD })).toString('base64url')
  const sig = crypto.sign('SHA256', Buffer.from(`${header}.${body}`), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64url')
  const ok = await invoke(lambda, mockRequest('/api/v1/users/me', { cookies: { access_token: `${header}.${body}.${sig}` } }))
  assert.equal(ok.origin.custom.domainName, 'alb.eu-west-1.example.com')
  const bypass = await invoke(lambda, mockRequest('/api/v1/auth/login'))
  assert.equal(bypass.origin.custom.domainName, 'placeholder.example.com')
})

test('lambda_edge.tf never passes the origin-verify secret or a default kid into the template', () => {
  const tf = fs.readFileSync(path.join(__dirname, '..', 'terraform', 'lambda_edge.tf'), 'utf8')
  const call = tf.slice(tf.indexOf('templatefile('), tf.indexOf('filename = "index.js"'))
  assert.ok(call.includes('templatefile('), 'templatefile() call not found in lambda_edge.tf')
  assert.ok(!/origin_verify/.test(call), 'origin_verify_* must not be a templatefile() variable')
  assert.ok(!/jwt_key_id/.test(call), 'jwt_key_id (a default kid) must not be a templatefile() variable')
})
