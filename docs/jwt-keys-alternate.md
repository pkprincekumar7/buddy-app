# JWT Key Management — API Gateway + Lambda Authorizer Variant

> **Status: exploratory proposal, not implemented.**
> This is the key-management runbook for the alternative design in
> [`docs/infra-architecture-multi-region-alternate.md`](infra-architecture-multi-region-alternate.md). It is a
> variant of [`docs/jwt-keys.md`](jwt-keys.md), which remains the runbook for the current,
> implemented Lambda@Edge-only architecture in
> [`docs/infra-architecture-multi-region.md`](infra-architecture-multi-region.md). Use this document
> only if that alternative design is adopted.

The backend signs JWTs with a 2048-bit RSA private key (RS256) — unchanged from the
current setup. What changes is *where the public key lives and who verifies with it*:

| | Current (`jwt-keys.md`) | This variant |
|---|---|---|
| Verifier | Lambda@Edge, at CloudFront's Regional Edge Caches (origin-request — not every PoP; see `infra-architecture-multi-region-alternate.md`'s diagram note) | Lambda Authorizer, per region (×3) |
| Public key storage | Embedded in Lambda@Edge code via Terraform `templatefile()` | AWS Secrets Manager secret, multi-region replicated |
| Rotation mechanism | Terraform apply + CloudFront propagation (5–15 min) | Secrets Manager `put-secret-value` + replica sync (typically under a few minutes) + authorizer cache TTL |
| Lambda@Edge involvement | Holds and uses the key | **None** — no key material at the edge at all |

---

## Secrets inventory

Both secrets below use new names (`buddy-app/jwt-*`) to avoid clashing with the
`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEYS` **GitHub Actions secrets** used by the current
architecture — those remain untouched and unrelated to this variant.

| Secret name | Format | Location | Used by |
|---|---|---|---|
| `buddy-app/jwt-private-key` | JSON: `{"key_id": "key-v1", "private_key": "<single-line PEM>"}` | Secrets Manager, primary region + **multi-region replicas** (all 3 regions need to sign tokens locally — see note below) | Backend/ECS, all 3 regions — signs tokens |
| `buddy-app/jwt-public-keys` | JSON map of `kid` → single-line public key PEM | Secrets Manager, primary region + **multi-region replicas** | Lambda Authorizer, all 3 regions — verifies tokens |

The critical structural change from the current setup: public key material is no longer
a GitHub Actions secret consumed by Terraform at deploy time — it's a **live Secrets
Manager secret** that the Lambda Authorizer reads at runtime (with in-memory caching).
Rotating it no longer requires a Terraform apply or a CloudFront distribution update.

**Why the private key also needs replication:** login/register requests are geo-routed
by Lambda@Edge via the CloudFront-Viewer-Country IP-geo fallback (see
`infra-architecture-multi-region-alternate.md` Section 2 — these are unauthenticated `PUBLIC_PATHS`,
so there's no JWT `location` claim yet to route by), which can land on any of the 3
regions depending on the client's network location. Every region's ECS must therefore be
able to sign a token without a cross-region Secrets Manager call — the same regional-read
argument used for the public keys applies symmetrically to the private key.

---

## Initial setup

### 1. Generate a key pair

```bash
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

### 2. Create the public-keys secret with multi-region replication

```bash
aws secretsmanager create-secret \
  --region us-east-1 \
  --name "buddy-app/jwt-public-keys" \
  --secret-string '{"key-v1": "-----BEGIN PUBLIC KEY-----\n<contents>\n-----END PUBLIC KEY-----\n"}' \
  --add-replica-regions '[{"Region":"eu-west-1"},{"Region":"ap-south-1"}]'
```

- `us-east-1` (or whichever region you designate) holds the **primary** secret; the two
  `--add-replica-regions` entries get read-only replicas that Secrets Manager keeps in sync
  automatically on every update to the primary.
- Each region's Lambda Authorizer reads **its own regional replica** — never a
  cross-region Secrets Manager call. This keeps the earlier latency/cost argument for
  the authorizer intact (regional Secrets Manager reads only).

### 3. Create the private-key secret (signing side), also replicated

```bash
aws secretsmanager create-secret \
  --region us-east-1 \
  --name "buddy-app/jwt-private-key" \
  --secret-string '{"key_id": "key-v1", "private_key": "-----BEGIN PRIVATE KEY-----\n<contents>\n-----END PRIVATE KEY-----\n"}' \
  --add-replica-regions '[{"Region":"eu-west-1"},{"Region":"ap-south-1"}]'
```

Backend/ECS in each region reads its **local replica** at task startup (or via a cached
fetch), same as the current `Secrets Manager → ECS env` pattern already in use for other
secrets in this repo — never a cross-region read.

### 4. Set local `.env` (Docker / dev)

Unchanged from `jwt-keys.md` — local dev still signs with a locally-generated key and
does not need Secrets Manager or the Lambda Authorizer path.

---

## Key rotation (zero-downtime)

The overlap-window mechanics are the same idea as the current runbook — sign with a new
key while still accepting the old one, then retire the old key once all its tokens have
expired. What changes is the propagation mechanism and timing.

### Step 1 — Generate a new key pair

```bash
openssl genrsa -out jwt_private_v2.pem 2048
openssl rsa -in jwt_private_v2.pem -pubout -out jwt_public_v2.pem
```

### Step 2 — Add the new public key alongside the old one

```bash
aws secretsmanager put-secret-value \
  --region us-east-1 \
  --secret-id "buddy-app/jwt-public-keys" \
  --secret-string '{
    "key-v1": "-----BEGIN PUBLIC KEY-----\n<old key>\n-----END PUBLIC KEY-----\n",
    "key-v2": "-----BEGIN PUBLIC KEY-----\n<new key>\n-----END PUBLIC KEY-----\n"
  }'
```

This single call updates the primary; Secrets Manager propagates it to the `eu-west-1`
and `ap-south-1` replicas automatically.

> **Propagation timing — two things to wait for, not one:**
> 1. **Replica sync**: typically completes within a few minutes of the primary update,
>    but is not instantaneous or SLA-guaranteed by AWS — verify with
>    `aws secretsmanager get-secret-value --region <replica-region> ...` in each region
>    before proceeding, rather than assuming a fixed wait is sufficient.
> 2. **Authorizer in-memory cache TTL** (e.g. 15 min, per
>    [`infra-architecture-multi-region-alternate.md`](infra-architecture-multi-region-alternate.md)): a warm
>    Lambda Authorizer execution environment won't re-fetch the secret until its cached
>    copy expires. Worst case, a given authorizer instance keeps using the old
>    keys-only view for up to the TTL after replica sync completes. Wait at least the
>    full TTL after confirming replica sync in all 3 regions before proceeding to Step 3.

### Step 3 — Switch the backend to the new key

```bash
aws secretsmanager put-secret-value \
  --region us-east-1 \
  --secret-id "buddy-app/jwt-private-key" \
  --secret-string '{"key_id": "key-v2", "private_key": "-----BEGIN PRIVATE KEY-----\n<new key>\n-----END PRIVATE KEY-----\n"}'
```

Same caution as Step 2: this updates the primary only. Verify replica sync in
`eu-west-1` and `ap-south-1` (`aws secretsmanager get-secret-value --region <region> ...`)
**before** restarting ECS tasks in those regions. Then **explicitly confirm** every
region has actually switched to signing with `key-v2` — don't just restart and move on;
check each region's `/health` (or a debug claim in a freshly-issued token) actually shows
`key-v2`. If a region relies on its own secret-refresh poll cycle instead of an
immediate restart, it can keep minting `key-v1`-signed tokens for as long as that cycle
takes to pick up the change — this is not merely "defeats the point of a predictable
timeline," it directly sets the clock for Step 4, and getting it wrong causes valid
tokens to be rejected early (a real outage, not a cosmetic one — see Step 4).

### Step 4 — Wait for old tokens to expire

Start this wait from the moment **every region confirmed** it switched to `key-v2` in
Step 3 — not from the Step 3 `put-secret-value` call, and not from the first region to
switch. If, say, the last region only finishes switching 15 minutes after the
`put-secret-value` call (e.g. because it was on a poll cycle rather than an immediate
restart), that region can legitimately issue `key-v1` tokens up to that point, and those
tokens remain valid for the full access-token lifetime from *their* issuance — not from
Step 3's timestamp. Wait at least `JWT_ACCESS_EXPIRE_MINUTES` (default: 30 minutes) from
the last-confirmed switchover, for all `key-v1` tokens to expire naturally. Starting the
countdown early and proceeding to Step 5 before this window has actually elapsed
produces spurious 401s for users holding still-valid `key-v1` tokens.

### Step 5 — Remove the old public key

```bash
aws secretsmanager put-secret-value \
  --region us-east-1 \
  --secret-id "buddy-app/jwt-public-keys" \
  --secret-string '{"key-v2": "-----BEGIN PUBLIC KEY-----\n<new key>\n-----END PUBLIC KEY-----\n"}'
```

Wait for replica sync + authorizer cache TTL again (same check as Step 2) before
considering `key-v1` fully retired.

### Step 6 — Clean up local key files

```bash
rm jwt_private.pem jwt_public.pem jwt_private_v2.pem jwt_public_v2.pem
```

---

## How it works

- The backend (ECS) **signs** tokens with the private key from
  `buddy-app/jwt-private-key`. The private key never leaves Secrets Manager /
  ECS task memory — same guarantee as today.
- Each region's **Lambda Authorizer** fetches `buddy-app/jwt-public-keys` from its
  **local** Secrets Manager replica, caches it in memory for the configured TTL, and
  verifies incoming tokens against the `kid`-matched key. Invalid, unsigned, or
  incorrectly-signed tokens are rejected with `401` at the regional API Gateway — before
  reaching the VPC Link/ALB/ECS.
- **Lambda@Edge holds no key at all** in this variant — it only checks that a token is
  present and structurally well-formed with an unexpired `exp` claim (unverified read,
  no cryptographic check). It plays no role in key rotation.
- The `kid` header on each token ties signing to verification, same mechanism as today —
  multiple keys can coexist in the Secrets Manager JSON map during the overlap window.

## Operational notes specific to this variant

- **No CloudFront/Lambda@Edge propagation wait** for key rotation — that 5–15 minute
  wait in the current runbook goes away, replaced by the (usually faster, but
  verify-don't-assume) Secrets Manager replica sync + authorizer cache TTL.
- **Three regions must each be checked independently** during rotation — a mistake here
  (e.g. proceeding to Step 3 before confirming replica sync in *all* three regions, not
  just the primary) reintroduces exactly the kind of partial-rollout inconsistency the
  overlap window is designed to prevent.
- If the authorizer cache TTL is later tuned, this runbook's wait times in Steps 2 and 5
  must be updated to match — the TTL value lives in the authorizer's code/config, not
  here, so keep them in sync manually.
