# JWT Key Management

The backend signs JWTs with a 2048-bit RSA private key (RS256). The corresponding public key is embedded in a Lambda@Edge function that validates every `/api/*` request at the edge before it reaches the ALB.

## GitHub Actions secrets inventory

Three secrets are required per GitHub environment (`dev`, `sbx`, `stg`, `prod`):

| Secret | Format | Used by |
|---|---|---|
| `JWT_PRIVATE_KEY` | Single-line PEM (`\n` escaped) | Backend workflow → ECS / Secrets Manager |
| `JWT_KEY_ID` | Plain string, e.g. `key-v1` | Backend workflow → ECS env var |
| `JWT_PUBLIC_KEYS` | JSON map of kid → single-line public key PEM | Edge workflow → Terraform → Lambda@Edge |

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

---

## Key rotation (zero-downtime)

Rotation requires no code changes and no template edits — only GitHub secret updates and two workflow runs.

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

Run the **edge workflow** (`terraform-live-edge.yml`, action: `apply`).
Lambda@Edge now accepts tokens signed by either key — existing sessions are unaffected.

> **Note:** Lambda@Edge propagation takes 5–15 minutes (CloudFront distribution update). Wait for the workflow to fully complete before proceeding to Step 3.

### Step 3 — Switch the backend to the new key

Update two secrets:

- **`JWT_PRIVATE_KEY`** → single-line output of `jwt_private_v2.pem`
- **`JWT_KEY_ID`** → `key-v2`

Run the **backend workflow** (`terraform-live-backend.yml`, action: `apply`) or use `restart-live-backend.yml` to pick up the Secrets Manager change without a full Terraform run.

New tokens are now signed with `key-v2`.

### Step 4 — Wait for old tokens to expire

Wait at least `JWT_ACCESS_EXPIRE_MINUTES` (default: 30 minutes) for all `key-v1` tokens to expire naturally.

### Step 5 — Remove the old public key

Update `JWT_PUBLIC_KEYS` to contain only the new key:

```json
{"key-v2": "-----BEGIN PUBLIC KEY-----\n<new key>\n-----END PUBLIC KEY-----\n"}
```

Run the **edge workflow** again (`apply`). Rotation complete.

### Step 6 — Clean up local key files

```bash
rm jwt_private.pem jwt_public.pem jwt_private_v2.pem jwt_public_v2.pem
```

---

## How it works

- The backend (`FastAPI` on ECS) **signs** tokens with `JWT_PRIVATE_KEY`. The private key never leaves Secrets Manager.
- The Lambda@Edge function **verifies** tokens at the edge using the public keys embedded in `JWT_PUBLIC_KEYS` at Terraform deploy time. Invalid or missing tokens are rejected with `401` before the request reaches the ALB.
- The `JWT_KEY_ID` / `kid` header ties signing to verification: the function looks up the key by `kid` from the token header, so multiple keys can coexist during the rotation overlap window.
