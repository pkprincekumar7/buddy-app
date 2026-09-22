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
function renderTemplate({ publicKeyPem, regionalAlbFqdns, originVerifySecret = 'test-secret' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-validator-lambda-test-'))
  try {
    const tf = `
terraform {
  required_version = ">= 1.0.0"
}
locals {
  rendered = templatefile(${JSON.stringify(TEMPLATE_PATH)}, {
    jwt_public_keys      = { "key-v1" = ${JSON.stringify(publicKeyPem)} }
    jwt_key_id            = "key-v1"
    regional_alb_fqdns    = ${JSON.stringify(regionalAlbFqdns)}
    origin_verify_secret  = ${JSON.stringify(originVerifySecret)}
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
  const modulePath = path.join(os.tmpdir(), `jwt-validator-lambda-rendered-${Date.now()}-${Math.random()}.js`)
  fs.writeFileSync(modulePath, rendered)
  try {
    delete require.cache[require.resolve(modulePath)]
    return require(modulePath)
  } finally {
    fs.rmSync(modulePath, { force: true })
  }
}

function mockRequest(uri, { cookies = {}, headers = {} } = {}) {
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
    origin: { custom: { domainName: 'placeholder.example.com' } },
  }
}

async function invoke(lambda, request) {
  return lambda.handler({ Records: [{ cf: { request } }] })
}

test('jwt-validator-lambda', { skip: !terraformAvailable() && 'terraform CLI not found on PATH' }, async (t) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' })

  function signJwt(payload, { kid = 'key-v1', exp } = {}) {
    const header = { alg: 'RS256', typ: 'JWT', kid }
    const fullPayload = { iat: Math.floor(Date.now() / 1000), ...payload }
    if (exp !== undefined) fullPayload.exp = exp
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
    assert.equal(res.headers.host[0].value, 'alb.eu-west-1.example.com')
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
})
