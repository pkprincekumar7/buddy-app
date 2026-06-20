'use strict'

// Lambda@Edge viewer-request — RS256 JWT validation
// Runs on every /api/* viewer request before forwarding to the ALB.
// Invalid or missing tokens are rejected with 401 at the edge.
//
// Template variables (injected by Terraform templatefile()):
//   jwt_public_keys — map of kid => RSA public key PEM
//   jwt_key_id      — default key ID when JWT header omits kid

const crypto = require('crypto')

const PUBLIC_KEYS = {
%{ for kid, pem in jwt_public_keys ~}
  '${kid}': ${jsonencode(pem)},
%{ endfor ~}
}

const DEFAULT_KID = '${jwt_key_id}'

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
    const key = pair.slice(0, idx).trim()
    const val = pair.slice(idx + 1).trim()
    cookies[key] = val
  })
  return cookies
}

function unauthorized() {
  return {
    status: '401',
    statusDescription: 'Unauthorized',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'application/json' }],
    },
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

exports.handler = async (event) => {
  const request = event.Records[0].cf.request

  for (const path of PUBLIC_PATHS) {
    if (request.uri === path || request.uri.startsWith(path + '/')) {
      return request
    }
  }

  const cookies = parseCookies(request.headers)
  let token = cookies[COOKIE_NAME]

  if (!token) {
    const authHeader = ((request.headers['authorization'] || [])[0] || {}).value || ''
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
  }

  if (!token) return unauthorized()

  try {
    verifyJwt(token)
    return request
  } catch (e) {
    return unauthorized()
  }
}
