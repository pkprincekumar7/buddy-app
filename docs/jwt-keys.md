# JWT Key Management

The **auth** service signs JWTs with a 2048-bit RSA private key (RS256). **Every** backend service (auth, users, children, onboarding, discover, grow, transform, release, shared) verifies them by `kid` against the `JWT_PUBLIC_KEYS` map (APP-02). Only auth holds the private key; every other service verifies with `JWT_PUBLIC_KEYS` alone (see "Which service holds which key" below). The same map is embedded in a Lambda@Edge function that validates `/api/*` requests at the edge before they reach the ALB — not every one, though: `login`/`google`/`health` are bypassed entirely (no check at all), and `refresh`/`logout`/`register` only read an unverified location *hint* from an existing token, never requiring or blocking on one. Full signature verification (the thing this document is about managing keys for) applies to every other `/api/*` request. See `infra-architecture-multi-region.md`'s Lambda@Edge section for the full path breakdown.

## GitHub Actions secrets and variables inventory

Three values per GitHub environment (`dev`, `sbx`, `stg`, `prod`). Only the private key is a **secret**; the key ID and the public keys aren't confidential, so they're environment **variables**:

| Name (kind) | Format | Used by |
|---|---|---|
| `JWT_PRIVATE_KEY` (secret) | Single-line PEM (`\n` escaped) | Backend workflow → Secrets Manager (first apply only; rotate with `put-secret-value`, see Step 3) → **auth** service only |
| `JWT_KEY_ID` (variable) | Plain string, e.g. `key-v1` | Backend workflow → ECS env var (`JWT_KEY_ID`) on every service runtime; only auth uses it (the `kid` it signs with). Defaults to `key-v1` if unset |
| `JWT_PUBLIC_KEYS` (variable) | JSON map of kid → single-line public key PEM | Edge workflow → Lambda@Edge, **and** backend workflow → ECS env var (`JWT_PUBLIC_KEYS`) on every service runtime and worker (`local.jwt_environment` in `infra-live-backend/terraform/services.tf`). **Required by both workflows** |

Rules both sides enforce (EDGE-04 / APP-02):

- Every token needs a `kid` that is a key in `JWT_PUBLIC_KEYS`. A missing or unknown `kid` is a 401; there is no default key.
- `JWT_PUBLIC_KEYS` **must contain `JWT_KEY_ID`'s public key**: the other services have no private key to derive it from, so without that entry they would reject every token auth issues. The backend workflow checks this before applying ("Check JWT_PUBLIC_KEYS holds JWT_PRIVATE_KEY's public key"), and Terraform's `jwt_public_keys` validation checks the kid is listed. If the entry is missing or isn't the public half of `JWT_PRIVATE_KEY`, **auth refuses to start** (`TokenIssuer.check_published` in `backend/auth/app/tokens.py`). Every service refuses to start if `JWT_PUBLIC_KEYS` is empty or not a JSON map of valid PEM public keys (`AuthzConfig` in `backend/common/authz.py`).
- `alg` must be `RS256`, and `exp`, `iat`, `iat_ms`, `sub`, `type`, `iss` and `aud` are required (`jti` and `family_id` too for refresh tokens). Clock skew of 30 s is allowed (`JWT_LEEWAY_SECONDS` on the backend, `CLOCK_SKEW_LEEWAY_SECONDS` in the Lambda).
- `iss` must be `<app_name>-<environment>` (e.g. `superpower-prod`) and `aud` must be `<app_name>-api`. Auth stamps both on every token it issues. Terraform builds the same two values for every service (`JWT_ISSUER` / `JWT_AUDIENCE`, `local.jwt_environment` in `infra-live-backend/terraform/services.tf`) and the Lambda (`infra-live-edge/terraform/lambda_edge.tf`); nothing to set by hand. Locally they default to `superpower-local` / `superpower-api`.
- Each environment should still have its **own** key pair. `iss` already stops a dev token working in prod, but a shared key would let anyone holding one environment's private key mint tokens for another.
- **Deploying the `iss`/`aud` change** invalidates every token issued before it (they have no `iss`/`aud`), so users log in again once. Deploy the backend before the edge (`terraform-live-all` does), or the edge rejects tokens from the not-yet-updated backend for a few minutes.

### Which service holds which key

Each service is its own ECS service (and image), so what it can do with tokens is set by what its code and its secret contain (`local.secret_keys` in `infra-live-backend/terraform/services.tf`):

| Service | Serves | `JWT_PRIVATE_KEY` | `JWT_PUBLIC_KEYS` |
|---|---|---|---|
| `auth` (and its worker) | `/api/v1/auth/*`: login, registration, refresh, logout, account deletion, and the admin routes (allow-list, account listing, lock / unlock, roles) | ✅ — the only one that mints tokens (`backend/auth/app/tokens.py`) | ✅ required — also checked against its own key at startup |
| users, children, onboarding, discover, grow, transform, release, shared (and their workers) | Everything else under `/api/v1` | ❌ — not in their secrets | ✅ required — their only verification keys |
| local dev (compose) | Every service | ✅ auth only, from the root `.env` | Derived from `JWT_PRIVATE_KEY` by the one-shot `local-keys` service (`scripts/local-keys.py`) |

Token minting code exists only in the auth service, and the import-linter contracts (`backend/tools/import_contracts.py`) stop any service importing another's code, so a compromised non-auth task can verify tokens but can't forge them.

---

## Initial setup

### 1. Generate a key pair

```bash
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

### 2. Convert to single-line format

Docker Compose `.env` files and GitHub secrets do not support multiline values. Convert both keys to a single line with literal `\n` escape sequences:

```bash
# Private key — paste into JWT_PRIVATE_KEY
awk 'NF {sub(/\r/,""); printf "%s\\n",$0}' jwt_private.pem

# Public key — used to build JWT_PUBLIC_KEYS below
awk 'NF {sub(/\r/,""); printf "%s\\n",$0}' jwt_public.pem
```

### 3. Set GitHub secrets

In each GitHub environment, set:

- **`JWT_PRIVATE_KEY`** — single-line output from the private key awk command.
- **`JWT_KEY_ID`** — `key-v1` (or whatever label you chose).
- **`JWT_PUBLIC_KEYS`** — a JSON map with the public key:

```json
{"key-v1": "-----BEGIN PUBLIC KEY-----\nMIIBIj...your key here...\n-----END PUBLIC KEY-----\n"}
```

> The JSON value must be on one line. The `\n` sequences are literal backslash-n, not real newlines.

### 4. Set local `.env` (Docker / dev)

```bash
cp .env.example .env
# Paste the single-line private key output as JWT_PRIVATE_KEY
# JWT_KEY_ID defaults to key-v1 — no change needed unless you used a different label
```

`JWT_PUBLIC_KEYS` isn't set locally: compose's `local-keys` service derives it from `JWT_PRIVATE_KEY` on every `docker compose up`.

---

## Key rotation (zero-downtime)

Rotation requires no code changes and no template edits — only GitHub secret updates, a
`put-secret-value` per region, and workflow runs. Both the edge and the backend verify with
`JWT_PUBLIC_KEYS`, so **both** need the new key before anything signs with it, and both keep
the old key until the last old token (a 24 h refresh token) has expired. The easiest way to
apply both everywhere is one `terraform-live-all.yml` run with the full region set.

### Step 1 — Generate a new key pair

```bash
openssl genrsa -out jwt_private_v2.pem 2048
openssl rsa -in jwt_private_v2.pem -pubout -out jwt_public_v2.pem

# Convert to single-line
awk 'NF {sub(/\r/,""); printf "%s\\n",$0}' jwt_private_v2.pem
awk 'NF {sub(/\r/,""); printf "%s\\n",$0}' jwt_public_v2.pem
```

### Step 2 — Add new public key alongside the old one

Update `JWT_PUBLIC_KEYS` to include **both** keys:

```json
{
  "key-v1": "-----BEGIN PUBLIC KEY-----\n<old key>\n-----END PUBLIC KEY-----\n",
  "key-v2": "-----BEGIN PUBLIC KEY-----\n<new key>\n-----END PUBLIC KEY-----\n"
}
```

Run the **edge workflow** (`terraform-live-edge.yml`, `apply`) **and the backend workflow
(`terraform-live-backend.yml`, `apply`) for every active region** — or one
`terraform-live-all.yml` run. Lambda@Edge and every backend region now accept tokens signed by
either key; existing sessions are unaffected.

> **Note:** Lambda@Edge propagation takes 5–15 minutes (CloudFront distribution update). Wait for every run to complete before Step 3. Tokens are minted in the bootstrap region and verified in the user's home region, so a region that doesn't know `key-v2` yet would reject them.

### Step 3 — Switch the backend to the new key

Do these together — auth refuses to start if `JWT_KEY_ID` and `JWT_PRIVATE_KEY` disagree (and the backend workflow's key check fails first). The other services need nothing new here: they already have `key-v2` from Step 2.

1. Set the GitHub secret **`JWT_PRIVATE_KEY`** → single-line `jwt_private_v2.pem`, and the GitHub variable **`JWT_KEY_ID`** → `key-v2`.
2. In **every active region**, write the new private key into Secrets Manager. The workflow only fills that secret on the first apply, so the GitHub secret alone doesn't reach a running environment. `put-secret-value` replaces the whole JSON, so send every key (see `infra-operations.md` → "Rotating a value").
3. Run the **backend workflow** (`apply`) for every active region. This updates the `JWT_KEY_ID` env var and restarts the auth tasks with the new private key.

> **Multi-region: repeat this for every active backend region.** Each region has its own Secrets Manager secret and its own backend run. Skipping a region doesn't break anything immediately — everyone still accepts `key-v1` — but that region keeps signing with the old key, defeating the rotation for it.

New tokens are now signed with `key-v2`, in every region you ran this against.

### Step 4 — Wait for old tokens to expire

Wait at least `JWT_REFRESH_EXPIRE_HOURS` (default: **24 hours**) — starting from whichever region you ran Step 3 against **last**. Access tokens expire after 30 minutes, but refresh tokens signed with `key-v1` stay valid for 24 h, and the backend must still verify them, or those users are logged out (APP-02).

### Step 5 — Remove the old public key

Update `JWT_PUBLIC_KEYS` to contain only the new key:

```json
{"key-v2": "-----BEGIN PUBLIC KEY-----\n<new key>\n-----END PUBLIC KEY-----\n"}
```

Run the **edge workflow** and the **backend workflow for every region** again (`apply`), or one `terraform-live-all.yml` run. Rotation complete.

### Step 6 — Clean up local key files

```bash
rm jwt_private.pem jwt_public.pem jwt_private_v2.pem jwt_public_v2.pem
```

---

## How it works

- The auth service (FastAPI on ECS) **signs** tokens with `JWT_PRIVATE_KEY` (`TokenIssuer` in `backend/auth/app/tokens.py`), always with the current key only. The private key never leaves Secrets Manager, and only auth's task definitions reference it.
- The Lambda@Edge function **verifies** tokens at the edge using the public keys embedded in `JWT_PUBLIC_KEYS` at Terraform deploy time — for the paths that require it. Invalid or missing tokens are rejected with `401` on those; the bypass and hint-based paths noted above never reach this check at all. Keys are parsed once per cold start, not per request.
- Every service **verifies** access tokens with the same `kid` lookup in `JWT_PUBLIC_KEYS` — `Authorizer.verify()` in `backend/common/authz.py`; auth verifies refresh tokens the same way (`decode_refresh()` in `backend/auth/app/tokens.py`). There is no default key: a missing or unknown `kid` is a 401.
- The `JWT_KEY_ID` / `kid` header ties signing to verification, so multiple keys can coexist during the rotation overlap window.
