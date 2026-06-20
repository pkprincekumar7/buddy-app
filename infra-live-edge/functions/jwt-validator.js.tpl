// CloudFront Function — RS256 JWT validation
// Runs on every /api/* viewer request before forwarding to the ALB.
// Invalid or missing tokens are rejected with 401 at the edge.
//
// Template variables (injected by Terraform templatefile()):
//   jwt_public_keys — map of kid => RSA public key PEM
//   jwt_key_id      — key ID label matching the JWT kid header claim

var PUBLIC_KEYS = {
%{ for kid, pem in jwt_public_keys ~}
  "${kid}": "${pem}",
%{ endfor ~}
}

var COOKIE_NAME = "access_token"

var PUBLIC_PATHS = [
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/google",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/health",
]

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/")
  while (str.length % 4) str += "="
  return str
}

async function verifyJwt(token) {
  var parts = token.split(".")
  if (parts.length !== 3) throw new Error("malformed token")

  var header = JSON.parse(atob(base64urlDecode(parts[0])))
  var kid = header.kid || "${jwt_key_id}"

  var publicKeyPem = PUBLIC_KEYS[kid]
  if (!publicKeyPem) throw new Error("unknown kid: " + kid)

  var pemBody = publicKeyPem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\n/g, "")

  var keyData = Uint8Array.from(atob(pemBody), function(c) { return c.charCodeAt(0) })

  var cryptoKey = await crypto.subtle.importKey(
    "spki",
    keyData.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  )

  var signingInput = parts[0] + "." + parts[1]
  var signature = Uint8Array.from(atob(base64urlDecode(parts[2])), function(c) { return c.charCodeAt(0) })
  var data = new TextEncoder().encode(signingInput)

  var valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature.buffer, data)
  if (!valid) throw new Error("invalid signature")

  var payload = JSON.parse(atob(base64urlDecode(parts[1])))
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error("expired")

  return payload
}

async function handler(event) {
  var request = event.request

  for (var i = 0; i < PUBLIC_PATHS.length; i++) {
    if (request.uri === PUBLIC_PATHS[i] || request.uri.startsWith(PUBLIC_PATHS[i] + "/")) {
      return request
    }
  }

  // Web clients send the token as an HttpOnly cookie.
  // React Native clients send it as Authorization: Bearer (no cookie jar in RN fetch).
  var token = (request.cookies[COOKIE_NAME] || {}).value
  if (!token) {
    var authHeader = ((request.headers["authorization"] || [])[0] || {}).value || ""
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7)
    }
  }

  if (!token) {
    return {
      statusCode: 401,
      headers: { "content-type": [{ value: "application/json" }] },
      body: JSON.stringify({ message: "Unauthorized" })
    }
  }

  try {
    await verifyJwt(token)
    return request
  } catch (e) {
    return {
      statusCode: 401,
      headers: { "content-type": [{ value: "application/json" }] },
      body: JSON.stringify({ message: "Unauthorized" })
    }
  }
}
