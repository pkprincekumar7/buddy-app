# Service split: API reference

**Status:** proposal, companion to [auth-users-split.md](auth-users-split.md). Implemented so far: the users endpoints (build plan 3.1, `backend/users/`) and every auth endpoint: sign-in (3.2), `GET /internal/authz` (3.3), the admin endpoints (3.4), account deletion and the email lookup (3.5), in `backend/auth/`; the children endpoints (4.1, `backend/children/`) and the Connect visit (5.7); the onboarding endpoints (5.1, `backend/onboarding/`); the discover endpoints (5.2, `backend/discover/`); the grow endpoints (5.3, `backend/grow/`); the transform endpoints (5.4, `backend/transform/`); the release endpoints (5.5, `backend/release/`); the shared endpoints (5.6, `backend/shared/`). The rest isn't built yet.
**Scope:** one entry per endpoint in [section 13.4](auth-users-split.md#134-full-api-list) of the proposal, with what it accepts, what it does and what it returns. Entries are added one at a time; the list in 13.4 stays the index.

**Conventions for every entry:**
- **Authz changes** (logout-all, refresh reuse detection, lock, unlock, role change, account deletion) are one `findOneAndUpdate` with `$inc: {authz_version: 1}` on `auth.auth`. The cache entry `authz:{id}` is then written with the returned version, through the versioned write (proposal 9.3).
- **Paths** are relative to the site origin. Public endpoints sit under `/api/v1/` on port 8000; internal ones under `/internal/` on port 8001 (proposal 13.2).
- **Errors** use FastAPI's shape, `{"detail": …}`. Where the client must tell errors apart, `detail` is `{"code": "…", "msg": "…"}`.
- **"Today"** notes describe the current backend (`backend/app/routers/…`), so the differences are visible.
- **Circle endpoints** (`/api/v1/children/{id}/…`) share these rules:
  - **Ownership:** only the child's parent; an admin with `children:read:any` can read, from admin tools only. **An admin read must pass `?location=`** (the child's owner's location, from the account listing): the admin's own token location may be another zone, and every read is targeted by location. Anyone else, or a child that doesn't exist or is soft-deleted, gets `404 child_not_found`. The check uses the circle's `child_access` copy, with read-through on a miss (proposal 7.5).
  - **Unlock:** a circle that isn't unlocked yet returns `403 circle_locked`, but only after confirm-before-deny with the previous circle (proposal 12.4). A confirmed answer is stored as `child_access.confirmed.<circle>`, never over `progress` or `version`.
- **Generation endpoints** (`…/generation`) share these rules:
  - **Start:** `POST` returns `202 Accepted` with `{"job_id", "status"}`. The server builds the prompt from its own data and local copies; the client sends no prompt (proposal 8).
  - **One at a time:** if the same kind is already `pending` or `processing` for that child (and area), the existing job is returned with `200 OK` instead of starting another.
  - **Limits:** 10 starts per minute per user, plus the shared hourly LLM limit per user across every circle (`LLM_HOURLY_LIMIT`, default 200, in Valkey), which returns `429 llm_limit`.
  - **Kind and type:** `kind` is the short name the API uses (`plan`, `life_pathway`, …); the stored job's `type` keeps today's job-type name (`generate_ninety_day_plan`, …). Each circle's entry maps one to the other.
  - **Polling:** `GET …/generation/{job_id}` returns `{"job_id", "kind", "status", "error", "created_at", "completed_at"}`, with `status` `pending`, `processing`, `completed` or `failed`. A job of another child is `404 job_not_found`. When `completed`, the result is already stored, so the client reloads the circle's `GET`.
  - **Retries:** the worker retries the LLM call with backoff, as today (`llm_attempt`, `retry_after`). A job that still fails is `failed`, with a short `error`, and the client may start again.

---

## Endpoints

**auth** (public):
- [POST /api/v1/auth/register](#post-apiv1authregister)
- [POST /api/v1/auth/login](#post-apiv1authlogin)
- [POST /api/v1/auth/google](#post-apiv1authgoogle)
- [POST /api/v1/auth/refresh](#post-apiv1authrefresh)
- [POST /api/v1/auth/logout](#post-apiv1authlogout)
- [POST /api/v1/auth/logout-all](#post-apiv1authlogout-all) ✳
- [GET /api/v1/auth/me](#get-apiv1authme)
- [DELETE /api/v1/auth/account](#delete-apiv1authaccount)
- [GET /api/v1/auth/accounts](#get-apiv1authaccounts)
- [POST /api/v1/auth/accounts/search](#post-apiv1authaccountssearch) ✳
- [POST /api/v1/auth/accounts/{id}/lock](#post-apiv1authaccountsidlock)
- [POST /api/v1/auth/accounts/{id}/unlock](#post-apiv1authaccountsidunlock)
- [PATCH /api/v1/auth/accounts/{id}/role](#patch-apiv1authaccountsidrole)
- [GET /api/v1/auth/allowed-emails](#get-apiv1authallowed-emails)
- [POST /api/v1/auth/allowed-emails/search](#post-apiv1authallowed-emailssearch) ✳
- [POST /api/v1/auth/allowed-emails](#post-apiv1authallowed-emails)
- [DELETE /api/v1/auth/allowed-emails/{key}](#delete-apiv1authallowed-emailskey) ✳

**auth** (internal, port 8001):
- [GET /internal/authz/{user_id}](#get-internalauthzuser_id)
- [GET /internal/auth/users/{user_id}/email](#get-internalauthusersuser_idemail) ✳

**users:**
- [GET /api/v1/users/{user_id}/profile](#get-apiv1usersuser_idprofile)
- [GET /api/v1/users/profiles](#get-apiv1usersprofiles) ✳
- [PATCH /api/v1/users/{user_id}/profile](#patch-apiv1usersuser_idprofile)
- [GET /api/v1/users/{user_id}/preferences](#get-apiv1usersuser_idpreferences)
- [PATCH /api/v1/users/{user_id}/preferences](#patch-apiv1usersuser_idpreferences)
- [PUT /internal/users/{user_id}](#put-internalusersuser_id) (internal)
- [DELETE /internal/users/{user_id}](#delete-internalusersuser_id) (internal) ✳

**children:**
- [GET /api/v1/children](#get-apiv1children)
- [POST /api/v1/children](#post-apiv1children)
- [GET /api/v1/children/{id}](#get-apiv1childrenid)
- [PATCH /api/v1/children/{id}](#patch-apiv1childrenid)
- [DELETE /api/v1/children/{id}](#delete-apiv1childrenid)
- [POST /api/v1/children/{id}/avatar/presign](#post-apiv1childrenidavatarpresign) ✳
- [GET /internal/children/{id}](#get-internalchildrenid) (internal)

**onboarding:**
- [GET /api/v1/children/{id}/onboarding](#get-apiv1childrenidonboarding)
- [PUT /api/v1/children/{id}/onboarding](#put-apiv1childrenidonboarding)
- [GET /internal/onboarding/children/{id}/status](#get-internalonboardingchildrenidstatus) (internal)
- [GET /internal/onboarding/children/{id}/answers](#get-internalonboardingchildrenidanswers) (internal) ✳

**discover:**
- [GET /api/v1/children/{id}/personality](#get-apiv1childrenidpersonality)
- [POST /api/v1/children/{id}/personality/generation](#post-apiv1childrenidpersonalitygeneration)
- [GET /api/v1/children/{id}/personality/generation/{job_id}](#get-apiv1childrenidpersonalitygenerationjob_id)
- [POST /api/v1/children/{id}/personality/viewed](#post-apiv1childrenidpersonalityviewed) ✳
- [GET /internal/discover/children/{id}/status](#get-internaldiscoverchildrenidstatus) (internal)
- [GET /internal/discover/children/{id}/summary](#get-internaldiscoverchildrenidsummary) (internal) ✳

**grow:**
- [GET /api/v1/children/{id}/growth-areas](#get-apiv1childrenidgrowth-areas)
- [PUT /api/v1/children/{id}/growth-areas/{area_id}](#put-apiv1childrenidgrowth-areasarea_id) ✳
- [POST /api/v1/children/{id}/growth-areas/{area_id}/generation](#post-apiv1childrenidgrowth-areasarea_idgeneration) ✳
- [GET /api/v1/children/{id}/growth-areas/{area_id}/generation/{job_id}](#get-apiv1childrenidgrowth-areasarea_idgenerationjob_id) ✳
- [GET /internal/grow/children/{id}/status](#get-internalgrowchildrenidstatus) (internal)
- [GET /internal/grow/children/{id}/areas](#get-internalgrowchildrenidareas) (internal) ✳
- [Not in the grow API](#not-in-the-grow-api)

**transform:**
- [GET /api/v1/children/{id}/transform](#get-apiv1childrenidtransform)
- [PATCH /api/v1/children/{id}/transform](#patch-apiv1childrenidtransform) ✳
- [POST /api/v1/children/{id}/transform/generation](#post-apiv1childrenidtransformgeneration) ✳
- [GET /api/v1/children/{id}/transform/generation/{job_id}](#get-apiv1childrenidtransformgenerationjob_id) ✳
- [POST /api/v1/children/{id}/transform/photos/presign](#post-apiv1childrenidtransformphotospresign) ✳
- [GET /internal/transform/children/{id}/status](#get-internaltransformchildrenidstatus) (internal)

**release:**
- [GET /api/v1/children/{id}/observations](#get-apiv1childrenidobservations)
- [PATCH /api/v1/children/{id}/observations](#patch-apiv1childrenidobservations) ✳
- [POST /api/v1/children/{id}/observations/generation](#post-apiv1childrenidobservationsgeneration) ✳
- [GET /api/v1/children/{id}/observations/generation/{job_id}](#get-apiv1childrenidobservationsgenerationjob_id) ✳
- [GET /internal/release/children/{id}/status](#get-internalreleasechildrenidstatus) (internal)

**connect** (served by children until a connect service exists):
- [POST /api/v1/children/{id}/connect/visit](#post-apiv1childrenidconnectvisit)

**shared:**
- [POST /api/v1/speech/transcriptions](#post-apiv1speechtranscriptions)
- [GET /api/v1/downloads/apk](#get-apiv1downloadsapk)
- [GET /api/health](#get-apihealth)

✳ = first defined in proposal 13.4 or in this file, rather than elsewhere in the proposal.

---

## POST /api/v1/auth/register

Creates a parent account with email and password, creates its profile, and signs the user in.

| | |
|---|---|
| **Service** | auth (HTTP) |
| **Routing** | Edge: `REGISTER_PATH` in the JWT validator. It uses an existing session's `location` as a hint, else the region for the body's `country_code`. ALB: rule 120, `/api/v1/auth/*` (proposal 13.1) |
| **Access** | Public (route policy `public`, proposal 11.2). No token needed. |
| **Rate limit** | 5 per minute per client IP, as today |
| **Success** | `201 Created` |
| **Today** | Same path. One handler writes `email_index` and `users` (`routers/auth.py`, `register`). |

### Request

`Content-Type: application/json`

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | ✅ | ≤ 255 characters, a valid address (no deliverability check). Normalised with `auth.emails.normalise()`: trimmed and lower-cased, nothing else (proposal 6.3). |
| `password` | string | ✅ | 8–128 characters, at least one letter and one digit, not one character repeated. Same policy as today. |
| `first_name` | string | ✅ | 1–100 characters after trimming |
| `middle_name` | string | — | ≤ 100 characters |
| `last_name` | string | — | ≤ 100 characters |
| `country_code` | string | ✅ | ISO 3166-1 alpha-2, trimmed and upper-cased. Must be a known country in `COUNTRY_TO_REGION` or `BLOCKED_COUNTRIES`. |
| `address_line_one`, `address_line_two`, `address_line_three` | string | — | ≤ 200 characters each. Personal data: never logged (proposal 5.3) |

Unknown fields are rejected (`422`). There's no `full_name`: it's built in code from the three name parts (proposal 5.3).

```json
{
  "email": "Jane.Doe@Example.com",
  "password": "s3cure-pass",
  "first_name": "Jane",
  "last_name": "Doe",
  "country_code": "in"
}
```

### Processing

The registration saga (proposal 10.1). Each numbered step either succeeds or the steps before it are undone.

1. **Validate** the body.
2. **Allow-list:** `key = HMAC-SHA256(pepper, normalised email)`. If `allowed_emails` has no row with `_id = key`, return `403 registration_closed`.
3. **Country:** if `country_code` is in `BLOCKED_COUNTRIES`, return `403 country_not_supported`. Otherwise `location = resolve_region(country_code)`.
4. **Reserve the email:** insert into `email_index` `{_id: key, key_version, user_id: <new UUIDv4>, location, status: "reserved", reserved_at: now}`.
   - **During a pepper rotation** (proposal 6.5), first check the email's key under **every** active pepper version. If any version has a row, the email is taken, so a second account can't be created while v1 and v2 rows coexist.
   - **Duplicate key, row is `active`:** run a dummy bcrypt check (so timing doesn't reveal the outcome), then return `409 email_taken`.
   - **Duplicate key, row is `reserved` and older than 15 minutes:** a stale attempt. Take it over with a conditional update that matches its old `user_id` and `reserved_at`. **Then delete what the old attempt may have left:** its `auth.auth` document and its profile (`DELETE /internal/users/{old_user_id}`, idempotent). Then continue. If that update matches nothing, another attempt got there first: `409 email_taken`.
   - **Duplicate key, row is `reserved` and newer:** another registration for this email is in progress, so `409 email_taken`.
5. **Credentials:** insert `auth.auth` `{_id: user_id, email, password_hash (bcrypt, cost 12), role: "parent", country_code, location, auth_provider: "password", tokens_revoked_at: null, is_locked: false, is_being_deleted: false, authz_version: 1, created_at, updated_at, schema_version}`.
6. **Profile:** call users' `PUT /internal/users/{user_id}` through Cloud Map, with a service token (`aud = "users-internal"`). The body has the names, `location` and the address fields, and **no email**. It's an upsert, so a retry is harmless.
7. **Activate:** set `email_index.status = "active"`. A conditional update on `{_id: key, user_id, status: "reserved"}`, so a reaper that cleaned up the row in the meantime is detected; the saga is then undone and `503` is returned.
8. **Sign in:**
   - create the access and refresh tokens (claims in proposal 9.2);
   - insert a `sessions` row with a new `family_id`;
   - write `authz:{user_id}` to Valkey, so the first request doesn't miss the cache.

**Failure handling:**

| Fails at | Undo | Response |
|---|---|---|
| Step 5 | Delete the `email_index` reservation | `500 registration_failed` |
| Step 6 (users unreachable, or it returns 5xx) | Call `DELETE /internal/users/{user_id}` (users may have created the profile before the call timed out), then delete `auth.auth`, then the reservation. If the users call fails too, keep the reservation, so the reaper can clean up from it. | `503 registration_unavailable`, with `Retry-After: 5` |
| Step 7 | As step 6, plus delete the users profile with `DELETE /internal/users/{user_id}` | `503 registration_unavailable` |
| Step 8 (Valkey) | None: the account exists. The first request fills the cache from auth (proposal 9.3). | `201` as normal |
| An undo step itself | Leave it. The `auth-worker` reaper removes `reserved` rows older than 15 minutes, and the `auth.auth` and users documents left behind (users through `DELETE /internal/users/{user_id}`). Login needs an `active` row, so a half-made account can't sign in. | As in the row above |

**Events:** none. Registration is a synchronous saga, so no other service needs to hear about it: a user has no data in the circles until they add a child.

**Logs:** `user.register id=<user_id> location=<location>` on success. Failures log `email_key=<key[:16]>`, never the email (proposal 6.3). Names and address are never logged.

### Response

**`201 Created`**

```json
{
  "status": "ok",
  "access_token": "<JWT>",
  "refresh_token": "<JWT>"
}
```

The tokens are in the body for the mobile app, which has no cookie jar. The web app uses the cookies:

| Cookie | Path | Max-Age | Flags |
|---|---|---|---|
| `access_token` | `/` | 1,800 s (30 min) | `HttpOnly`; `Secure`, `SameSite` and `Domain` from `COOKIE_SECURE`, `COOKIE_SAMESITE` and `COOKIE_DOMAIN` |
| `refresh_token` | `/api/v1/auth/` | 86,400 s (24 h) | Same |

The access token carries `sub`, `location`, `role` (`"parent"`), `iss`, `aud`, `iat`, `iat_ms`, `exp` and `type`. The refresh token adds `jti` and `family_id` (proposal 9.2). The client loads the profile with `GET /api/v1/users/me/profile`.

### Errors

| Status | `detail.code` | When |
|---|---|---|
| `403` | `registration_closed` | The email isn't on the allow-list |
| `403` | `country_not_supported` | `country_code` is in `BLOCKED_COUNTRIES` |
| `409` | `email_taken` | The email has an active account, or another registration for it is in progress |
| `422` | (FastAPI validation list) | A field is missing, too long or invalid; or the password fails the policy; or `country_code` is unknown |
| `429` | — | More than 5 requests a minute from this IP |
| `500` | `registration_failed` | The credentials couldn't be saved |
| `503` | `registration_unavailable` | The users service didn't respond; nothing was kept, so retry after `Retry-After` |

The `409` tells the caller that an account exists. That's accepted, as today, because registration is limited to allow-listed emails. The dummy bcrypt check stops the timing from revealing more than the status code already does.

### Differences from today

| Today | Proposal | Why |
|---|---|---|
| `full_name` (optional, defaults to `"Parent"`) | `first_name` (required), `middle_name`, `last_name` | Proposal 5.3 |
| No address fields | `address_line_one` / `_two` / `_three` (optional) | Proposal 5.3 |
| Allow-list and `email_index` keyed by the plaintext email | Keyed by `HMAC-SHA256(pepper, email)` | Proposal 6 |
| Email normalised by the `email-validator` library | `auth.emails.normalise()`: trim and lower-case only, the same function everywhere | Proposal 6.3 |
| One `users` document holds credentials and profile | `auth.auth` (credentials) plus users' profile, created through the saga | Proposal 5 |
| `email_index` has no status; an orphaned row is reclaimed if no `users` document exists | `reserved` → `active`, stale reservations reclaimed after 15 minutes, and a reaper for leftovers | Proposal 10.1 |
| A failed users insert returns `500` | A failed or unreachable users service returns `503` with `Retry-After` | The failure is temporary; a retry should work |
| Access token has no `role`; no `family_id`; no authz cache | `role` in the access token, `family_id` in the refresh token, `authz:{user_id}` written | Proposal 9.1–9.3 |
| Logs `sha256(email)[:16]` | Logs `key[:16]` (the HMAC) | Proposal 6.3 |
| Error `detail` is a plain string for some cases (`"Registration is not open."`) | Every case the client handles has a `code` | Clients can tell errors apart without matching text |

---

## POST /api/v1/auth/login

Signs in with email and password.

| | |
|---|---|
| **Service** | auth |
| **Routing** | Edge: `PURE_BYPASS_PATHS`, so it lands in the bootstrap region with no location check. ALB: rule 120 (`/api/v1/auth/*`). |
| **Access** | Public |
| **Rate limit** | 10 per minute per IP, as today. Also **5 failures per 15 minutes per email key and IP**: after that, attempts for that email from that IP are refused for 15 minutes (proposal 9.1). Counting per key *and* IP stops anyone from locking a known user out from elsewhere. Counters are in Valkey; if Valkey is down they fall back to per task (9.3). |
| **Success** | `200 OK` |
| **Today** | Same path and body; reads `email_index` then `users` |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | ✅ | ≤ 255; normalised with `auth.emails.normalise()`. An invalid address isn't a `422`: it just won't match, so the response doesn't reveal what's valid. |
| `password` | string | ✅ | ≤ 128 |

### Processing

1. `key = HMAC(pepper, normalised email)`. If the failure counter for this key and IP is at its limit, return `429 too_many_attempts` (before any lookup).
2. Read `email_index {_id: key}`. If there's no row, or it isn't `active`: run the dummy bcrypt check, count a failure, return `401 invalid_credentials`.
3. Read `auth.auth {_id: user_id, location}`. This can be one cross-region read, because login runs in the bootstrap region (9.1).
4. Verify the password with bcrypt (the dummy hash if the account is being deleted). On a mismatch, count a failure and return `401 invalid_credentials`.
5. **Only with the right password:** if `is_being_deleted`, return `401 invalid_credentials`; if `is_locked`, return `403 account_locked`. So the lock status isn't revealed to someone who doesn't know the password. Today it's checked first.
6. Reset the failure counter; sign in as in register step 8: tokens, a `sessions` row with a **new** `family_id`, and `authz:{user_id}` written.

Google-only accounts have an unusable random password, so password login fails for them with `401` like any wrong password.

### Response

`200 OK`, same body and cookies as [register](#post-apiv1authregister).

### Errors

| Status | `detail.code` | When |
|---|---|---|
| `401` | `invalid_credentials` | Unknown email, wrong password, or an account being deleted |
| `403` | `account_locked` | The account is locked by an admin |
| `422` | (validation list) | A field is missing or too long |
| `429` | `too_many_attempts` | IP limit, or 5 failures for this email key from this IP in 15 minutes |

**Differences from today:** the HMAC lookup; the per-key-and-IP failure limit is new; the password is checked before the lock; error codes; the access token gains `role` and the refresh token `family_id`.

---

## POST /api/v1/auth/google

Signs in with a Google ID token, creating the account on first use.

| | |
|---|---|
| **Service** | auth |
| **Routing** | Edge: `PURE_BYPASS_PATHS`. ALB: rule 120. |
| **Access** | Public |
| **Rate limit** | 5 per minute per IP, as today |
| **Success** | `200 OK` (both for an existing account and a new one) |
| **Today** | Same path and body |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `id_token` | string | ✅ | ≤ 4,096; a Google ID token for this app's client ID |
| `country_code` | string | Only for a new account | ISO 3166-1 alpha-2, as in register |

### Processing

1. Verify the ID token with Google's keys: signature, audience (`GOOGLE_CLIENT_ID`), issuer and expiry. It must carry an email with `email_verified = true`; otherwise `400 google_email_unverified`.
2. `key = HMAC(pepper, normalised email)`, then read `email_index`.
3. **Existing account** (an `active` row):
   - if `is_being_deleted`, return `401 account_unavailable`; if `is_locked`, return `403 account_locked`;
   - otherwise sign in as in login step 6.
   - This works whatever the account's `auth_provider`: a verified Google email proves ownership, so a password account can also sign in with Google. `auth_provider` keeps its original value.
4. **New account:**
   - allow-list check, then `country_code` required (`422 country_code_required`, so the app can show a country picker and retry), then the blocked-country check;
   - then the register saga from step 4, with `auth_provider: "google"` and a random unusable password hash;
   - the profile gets `first_name` = Google's `given_name` and `last_name` = `family_name`. If `given_name` is empty, `first_name` falls back to the email's local part. Control characters are stripped and each name cut to 100 characters (proposal 10.1).

### Response

`200 OK`, same body and cookies as register.

### Errors

| Status | `detail.code` | When |
|---|---|---|
| `400` | `google_token_invalid` | The ID token fails verification |
| `400` | `google_email_unverified` | No email, or Google says it isn't verified |
| `403` | `registration_closed` | New account, email not on the allow-list |
| `403` | `country_not_supported` | New account, blocked country |
| `403` | `account_locked` | Existing account is locked |
| `401` | `account_unavailable` | Existing account is being deleted, as for password login |
| `422` | `country_code_required` | New account without `country_code` |
| `429` | — | Rate limit |
| `503` | `registration_unavailable` | New account, and the users service didn't respond (as in register) |

**Differences from today:** names split into `first_name` / `last_name` instead of `full_name`; the saga and HMAC keys as in register; error codes; `503` instead of `500` when the profile can't be created.

---

## POST /api/v1/auth/refresh

Exchanges a refresh token for a new access and refresh token pair.

| | |
|---|---|
| **Service** | auth |
| **Routing** | Edge: `LOCATION_AWARE_PUBLIC_PATHS`, routed by the session's `location` as a hint. ALB: rule 120. |
| **Access** | The refresh token: the `refresh_token` cookie (web) or `Authorization: Bearer <refresh token>` (mobile) |
| **Rate limit** | 20 per minute per user, as today |
| **Success** | `200 OK` |
| **Today** | Same path. It deletes the old session on each refresh, with no family or reuse detection. |

### Request

No body. If an access token is also sent (cookie or header), its `sub` must match the refresh token's, as today.

### Processing

1. Verify the refresh token: signature, `iss`, `aud`, `exp`, `type = "refresh"`, `jti`, `family_id` and a valid `location`. Any failure: `401 invalid_token`, and the cookies are cleared.
2. Read `sessions {_id: jti, user_id, location}`.
   - **Not found:** `401 session_expired`, cookies cleared.
   - **Found and already rotated** (`rotated_at` is set):
     - **within 30 seconds of `rotated_at`:** a concurrent refresh, for example two tabs at once. Issue a new pair in the same family and continue.
     - **later:** the token was reused, so treat it as stolen. Delete every session in `family_id`, set `auth.auth.tokens_revoked_at = now` (which logs the user out everywhere, proposal 9.1) and update `authz:{user_id}`. Return `401 session_revoked` and clear the cookies.
3. Read `auth.auth`. If it's missing, `is_being_deleted` or `is_locked`, delete the session and return `401` / `403 account_locked`. If `tokens_revoked_at` (in milliseconds) `>=` the refresh token's `iat_ms`, return `401 session_revoked` (proposal 9.3).
4. **Rotate:**
   - insert the new session (new `jti`, same `family_id`);
   - mark the old one `{rotated_at: now, replaced_by: <new jti>}` rather than deleting it, so a reuse can be recognised. The TTL index still removes it at `expires_at`.
   - Then issue the new tokens. As today, the new row is written before the old one changes, so a crash mid-way leaves the old token usable.

### Response

`200 OK`, same body and cookies as register.

### Errors

| Status | `detail.code` | When |
|---|---|---|
| `401` | `missing_token` | No refresh token |
| `401` | `invalid_token` | Bad signature, wrong type, mismatched access token, or bad claims |
| `401` | `session_expired` | Session not found or past `expires_at` |
| `401` | `session_revoked` | Reuse detected, `tokens_revoked_at` after issue, the account is being deleted, or it changed (logout-all, lock, role, deletion) while the new session was written: that session is deleted again |
| `403` | `account_locked` | The account is locked |
| `429` | — | Rate limit |

Every `401` and `403` here also clears both cookies, as today.

---

## POST /api/v1/auth/logout

Ends the current session.

| | |
|---|---|
| **Service** | auth |
| **Routing** | Edge: `LOCATION_AWARE_PUBLIC_PATHS`. ALB: rule 120. |
| **Access** | Public; uses the refresh token if one is sent |
| **Rate limit** | 20 per minute per user, as today |
| **Success** | `204 No Content` |
| **Today** | Same |

### Processing

1. If a valid refresh token is sent (and a sent access token has the same `sub`), delete its `sessions` row. A mismatched access token returns `401 token_mismatch`, as today.
2. Clear both cookies. With no token, or an invalid one, logout still succeeds: nothing is left to end.

The access token stays valid until it expires (at most 30 minutes); the app discards it. To end every session at once, use [logout-all](#post-apiv1authlogout-all).

---

## POST /api/v1/auth/logout-all

Ends every session of the signed-in user, on every device. Proposal 9.3 relies on this ("the user can log out everywhere"), but 13.4 didn't list an endpoint for it; it's added there now.

| | |
|---|---|
| **Service** | auth |
| **Access** | Signed in (any role) |
| **Rate limit** | 3 per minute per user |
| **Success** | `204 No Content` |
| **Today** | None |
| **Used by** | A new "Sign out of all devices" button in account settings in both apps (proposal 16, step 7). Afterwards the app returns to the sign-in screen. |

### Processing

1. In one transaction: set `auth.auth.tokens_revoked_at = now` and delete every `sessions` row for the user.
2. Update `authz:{user_id}` with the new `revoked_at`, so every service rejects older access tokens at once. The change stream would do this too; doing it here makes it immediate in this region.
3. Clear both cookies.

---

## GET /api/v1/auth/me

Returns the signed-in user's account: identity, email and role. Names and preferences are in the users service ([GET /api/v1/users/{user_id}/profile](auth-users-split.md#134-full-api-list)).

| | |
|---|---|
| **Service** | auth |
| **Access** | Signed in |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Today** | Returns `id`, `email`, `full_name`, `role` |

### Response

```json
{
  "id": "6f1c2a9e-…",
  "email": "jane.doe@example.com",
  "role": "parent",
  "auth_provider": "password",
  "location": "ap-south-1",
  "created_at": "2026-10-24T09:30:00Z"
}
```

Read from `auth.auth` with `{_id: sub, location}`: one targeted read.

### Errors

`401` with no valid token, or one that's revoked; `403 account_locked` (proposal 9.3).

**Differences from today:** `full_name` moves to `GET /api/v1/users/me/profile`; `auth_provider`, `location` and `created_at` are added.

---

## DELETE /api/v1/auth/account

Deletes the signed-in user's account and all their data, through the deletion saga (proposal 10.3).

| | |
|---|---|
| **Service** | auth |
| **Access** | Signed in |
| **Rate limit** | 3 per minute per user, as today |
| **Success** | `202 Accepted` |
| **Today** | `DELETE /api/v1/user/me`, `204`; deletes seven collections directly, not jobs or S3 uploads |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `confirm_email` | string | ✅ | ≤ 255; must equal the account's email after normalisation. Same safeguard as today. |

### Processing

1. Normalise `confirm_email` and compare it with `auth.auth.email`. A mismatch returns `400 confirmation_mismatch`.
2. If the user is an admin **and isn't locked**, take one off the admin counter with the conditional decrement; if it's the **last active admin**, that fails and the call returns `409 last_admin` (proposal 10.3). A locked admin was already taken off when locked.
3. In one transaction, in the user's zone:
   - set `is_being_deleted = true` and `tokens_revoked_at = now`;
   - delete all sessions;
   - insert the outbox row `user.deletion_requested`.
4. Outside the transaction, upsert `deletions {_id: user_id, location, requested_at, expected: common.deletion.PARTICIPANTS, confirmed: []}`. It's unsharded, so it can't join a zone's transaction without making it cross-region (proposal section 14). If a crash skips it, the `auth-worker` creates it when the first `user.data_deleted` arrives.
5. Update `authz:{user_id}` to `deleting: true`, so every service rejects the user at once.
6. Clear the cookies and return `202`.

Then, asynchronously:
- each service deletes the user's data, local copies and S3 objects, and publishes `user.data_deleted`;
- `auth-worker` records each confirmation;
- when all have arrived, it deletes the `email_index` row, then `auth.auth`, then `authz:{user_id}`, then the `deletions` row.
- An alarm fires if a deletion is older than 24 hours.

### Response

`202 Accepted`:

```json
{ "status": "deleting" }
```

A second call can't happen: the tokens are already revoked, so it gets `401`. Logging in again also fails (`401`) while the deletion runs, and the email can be registered again only after the saga finishes.

### Errors

| Status | `detail.code` | When |
|---|---|---|
| `400` | `confirmation_mismatch` | `confirm_email` doesn't match |
| `401` | — | Not signed in, or tokens revoked |
| `409` | `last_admin` | The caller is the only active admin |
| `409` | `account_changed` | The account's role or lock changed while deleting it (try again); an admin taken off the counter is put back |
| `429` | — | Rate limit |

---

## GET /api/v1/auth/accounts

Lists accounts. For admins. To find one account by email, use [POST /api/v1/auth/accounts/search](#post-apiv1authaccountssearch), so the email never appears in a URL.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `accounts:list` (admins). Audited as a privileged action (proposal 11.3). |
| **Rate limit** | 60 per minute per user, as today's admin routes |
| **Success** | `200 OK` |
| **Today** | `GET /api/v1/admin/users` |

### Request

| Query | Type | Default | Rules |
|---|---|---|---|
| `role` | enum `parent` / `admin` | — | Filter |
| `locked` | bool | — | Filter |
| `skip` | int | 0 | ≥ 0 |
| `limit` | int | 20 | 1–100 |

### Response

```json
{
  "items": [
    {
      "id": "6f1c2a9e-…",
      "email": "jane.doe@example.com",
      "role": "parent",
      "auth_provider": "password",
      "location": "ap-south-1",
      "locked": false,
      "deleting": false,
      "created_at": "2026-10-24T09:30:00Z"
    }
  ],
  "total": 1,
  "skip": 0,
  "limit": 20
}
```

- Sorted by `created_at`, newest first.
- **No names:** they live in users. The admin screen fetches a page's names in one call with [GET /api/v1/users/profiles?ids=…](#get-apiv1usersprofiles) (permission `profiles:read:any`).
- Once the cluster is sharded, the list reads every zone. That's accepted for an admin screen; the email search stays two point reads.

### Errors

`401`; `403 forbidden` without the permission; `422` for bad query values.

---

## POST /api/v1/auth/accounts/search

Finds one account by email. For admins. It's a `POST` so the email travels in the body, not in a URL, where it would end up in CloudFront, ALB and browser logs.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `accounts:list`. Audited. |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Used by** | "Find user by email" on the admin screen, in both apps |
| **Today** | `GET /api/v1/admin/users/by-email/{email}` (email in the path) |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | ✅ | ≤ 255; normalised with `auth.emails.normalise()` |

### Processing

Normalise, HMAC, read `email_index`, then read `auth.auth`: two point reads. No write, so it's safe to repeat.

### Response

`200 OK` with one account, in the same shape as a [list](#get-apiv1authaccounts) item.

### Errors

`401`; `403 forbidden`; `404 account_not_found`; `422`.

---

## POST /api/v1/auth/accounts/{id}/lock

Locks an account: signs it out everywhere and blocks login. For admins.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `accounts:lock`. Audited. |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Today** | `PATCH /api/v1/admin/users/{user_id}/lock?location=…` |

### Request

| Part | Field | Required | Rules |
|---|---|---|---|
| Path | `id` | ✅ | The account's user id |
| Query | `location` | ✅ | From the account listing. As today, it targets the user's zone without reading every zone. |

### Processing

1. An admin locking themselves gets `400 cannot_lock_self`, as today. Locking an admin goes through the admin counter's conditional decrement, so locking the last active admin gets `409 last_admin`, even when two admins act at once (proposal 10.3).
2. Set `is_locked = true`, `tokens_revoked_at = now` and `updated_at`, and delete the account's sessions.
3. Update `authz:{id}` in this region at once. Every other region's `auth-worker` updates its own entry from the change stream, if it holds one (proposal 9.3).
4. Write the audit event.

### Response

```json
{ "id": "6f1c2a9e-…", "locked": true }
```

Locking an already locked account succeeds with the same body.

### Errors

`400 cannot_lock_self`; `401`; `403 forbidden`; `404 account_not_found`; `409 last_admin`; `409 account_deleting` (the account is being deleted); `409 account_changed` (it kept changing; try again).

---

## POST /api/v1/auth/accounts/{id}/unlock

Unlocks an account. For admins.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `accounts:lock`. Audited. |
| **Success** | `200 OK` |
| **Today** | `PATCH /api/v1/admin/users/{user_id}/unlock?location=…` |

### Request

Same path and `location` query as lock.

### Processing

1. Set `is_locked = false` and `updated_at`. If the account is an admin, increment the admin counter afterwards (it counts unlocked admins, proposal 10.3).
2. **Keep `tokens_revoked_at`.** Today's unlock sets it back to `null`, which makes tokens issued before the lock valid again if they haven't expired yet. Leaving it means the user simply signs in again.
3. Update `authz:{id}` and write the audit event.

### Response

```json
{ "id": "6f1c2a9e-…", "locked": false }
```

### Errors

`401`; `403 forbidden`; `404 account_not_found`.

---

## PATCH /api/v1/auth/accounts/{id}/role

Changes an account's role. For admins.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `accounts:role`. Audited; every role change also raises an alarm (proposal 11.3). |
| **Success** | `200 OK` |
| **Today** | None: admins are promoted by hand in mongosh |
| **Used by** | A new role control on the admin screen of both apps (proposal 16, step 7) |

### Request

Path `id`, query `location` as in lock, and this body:

| Field | Type | Required | Rules |
|---|---|---|---|
| `role` | enum `parent` / `admin` | ✅ | |

### Processing

1. Demoting an admin goes through the admin counter's conditional decrement (proposal 10.3), so demoting the last active admin gets `409 last_admin`, even when two admins act at once. An admin may demote themselves only if another admin remains. Demoting a locked admin doesn't touch the counter (they were taken off when locked). Promoting increments it, unless the account is locked.
2. Set `role`, set `tokens_revoked_at = now` (so no token still carries the old `role` claim) and delete the account's sessions.
3. Update `authz:{id}` and write the audit event. `user.role_changed` isn't published yet: no service consumes it (proposal 7.6).

### Response

```json
{ "id": "6f1c2a9e-…", "role": "admin" }
```

Setting the same role again succeeds and changes nothing.

### Errors

`401`; `403 forbidden`; `404 account_not_found`; `409 last_admin`; `409 account_deleting` (the account is being deleted); `409 account_changed` (it kept changing; try again); `422` for an unknown role.

The first admin of an environment isn't created here: it's created by the `backend/tools/promote-admin` command (proposal 11.4).

---

## GET /api/v1/auth/allowed-emails

Lists the registration allow-list. For admins.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `allowed_emails:read` |
| **Success** | `200 OK` |
| **Today** | `GET /api/v1/admin/allowed-emails` |

### Request

| Query | Type | Default | Rules |
|---|---|---|---|
| `skip` | int | 0 | ≥ 0 |
| `limit` | int | 20 | 1–100 |

### Response

```json
{
  "items": [
    {
      "key": "9b1f…e2",
      "email_hint": "j***@example.com",
      "added_by": "1a2b3c…",
      "created_at": "2026-10-24T09:30:00Z"
    }
  ],
  "total": 1,
  "skip": 0,
  "limit": 20
}
```

The plaintext email isn't stored, so it can't be listed. `email_hint` is enough to tell entries apart. To check one address, use [POST /api/v1/auth/allowed-emails/search](#post-apiv1authallowed-emailssearch).

---

## POST /api/v1/auth/allowed-emails/search

Checks whether one email is on the allow-list. For admins. A `POST`, so the email isn't in a URL.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `allowed_emails:read` |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Used by** | "Check email" on the admin screen, in both apps, and before removing an entry by email |
| **Today** | `GET /api/v1/admin/allowed-emails/{email}` (email in the path) |

**Request:** `{"email": "…"}`, ≤ 255 characters, normalised. **Processing:** compute the HMAC key and read `allowed_emails`: one point read. **Response:** the entry, in the same shape as a list item, including its `key` for [DELETE](#delete-apiv1authallowed-emailskey). **Errors:** `401`; `403 forbidden`; `404 not_allowed`; `422`.

---

## POST /api/v1/auth/allowed-emails

Adds an email to the allow-list. For admins.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `allowed_emails:write`. Audited. |
| **Success** | `201 Created` |
| **Today** | `POST /api/v1/admin/allowed-emails` |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | ✅ | ≤ 255, a valid address; normalised with `auth.emails.normalise()` |

### Processing

Insert `allowed_emails {_id: HMAC key, key_version, email_hint, added_by: <admin id>, created_at}`. The email itself is used only to compute the key and the hint, and isn't stored or logged.

### Response

`201 Created` with the entry, in the same shape as a list item.

### Errors

`401`; `403 forbidden`; `409 already_allowed`; `422 invalid_email`.

---

## DELETE /api/v1/auth/allowed-emails/{key}

Removes an email from the allow-list. For admins.

| | |
|---|---|
| **Service** | auth |
| **Access** | Permission `allowed_emails:write`. Audited. |
| **Success** | `204 No Content` |
| **Today** | `DELETE /api/v1/admin/allowed-emails/{email}` |

`key` is the entry's HMAC key, from the list or from [POST …/allowed-emails/search](#post-apiv1authallowed-emailssearch) (64 hex characters; anything else is `422`). The path takes the key, not the email, so no email ever appears in URLs or access logs.

Existing accounts aren't affected: the allow-list gates registration only. **Errors:** `401`; `403 forbidden`; `404 not_allowed`; `422`.

---

## GET /internal/authz/{user_id}

Returns a user's authorisation state, and refills the Valkey authz cache. Called by any service whose cache lookup missed (proposal 9.3).

| | |
|---|---|
| **Service** | auth |
| **Routing** | Cloud Map, `auth.{app}-{env}.internal:8001` (proposal 13.2). Never routed by the public ALB. |
| **Access** | A service token with `aud = "auth-internal"`, from any service |
| **Success** | `200 OK` |
| **Today** | None: every request reads `users` itself |

### Request

| Part | Field | Required | Rules |
|---|---|---|---|
| Path | `user_id` | ✅ | The token's `sub` |
| Query | `location` | ✅ | The token's `location`, for a targeted read |

### Processing

1. Read `auth.auth {_id, location}`: one indexed read.
2. Write `authz:{user_id}` to this region's Valkey (TTL 1 h) through the versioned write, so it can't overwrite a newer entry (proposal 9.3), unless Valkey is down. Callers then keep the answer in their own 30-second in-process cache (9.3).

### Response

```json
{ "ver": 42, "role": "parent", "locked": false, "deleting": false, "revoked_at_ms": 1792500000123 }
```

`revoked_at_ms` is a Unix time in **milliseconds**, or `null`; services compare it with the token's `iat_ms` (proposal 9.3).

### Errors

| Status | When | What the caller does |
|---|---|---|
| `401` | Missing or invalid service token | Fail closed: `503` to its own caller |
| `404` | No such account (deleted) | Rejects the request with `401` |
| `5xx` or no answer | auth is down | Fail closed: `503` (proposal 9.3) |

---

## GET /internal/auth/users/{user_id}/email

Returns a user's email, for a service that must contact them, such as a future notification sender. The users service doesn't store emails (proposal 5.3).

| | |
|---|---|
| **Service** | auth |
| **Routing** | Cloud Map, port 8001 |
| **Access** | A service token whose `sub` is on auth's allow-list for this endpoint. **No service is on it yet.** Each call is written to the audit log. |
| **Success** | `200 OK` |
| **Today** | None |

**Request:** path `user_id`, query `location`, as above.

**Response:**

```json
{ "email": "jane.doe@example.com" }
```

**Errors:** `401` invalid token; `403` caller not allowed; `404` no such account.

The caller must not store the email. It uses it for the one message and discards it.

---

## GET /api/v1/users/{user_id}/profile

Returns a user's profile: names and address.

| | |
|---|---|
| **Service** | users |
| **Routing** | ALB rule 110, `/api/v1/users/*` |
| **Access** | The user themself (`{user_id}` = their id, or `me`), or permission `profiles:read:any` (admins). Anyone else gets `404`, so ids can't be probed (proposal 11.2). Reads by an admin of someone else's profile are audited, and must pass `?location=` (the owner's, from the account listing). |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Today** | None: `full_name` comes from `GET /api/v1/auth/me` |
| **Used by** | The header and welcome screens (first name) and the new profile screen (proposal 16, step 7). The admin account list uses the [batch lookup](#get-apiv1usersprofiles) instead. |

### Response

```json
{
  "id": "6f1c2a9e-…",
  "first_name": "Jane",
  "middle_name": null,
  "last_name": "Doe",
  "address_line_one": null,
  "address_line_two": null,
  "address_line_three": null,
  "location": "ap-south-1",
  "created_at": "2026-10-24T09:30:00Z",
  "updated_at": "2026-10-24T09:30:00Z"
}
```

No `email` (auth holds it: `GET /api/v1/auth/me`) and no `full_name`: clients join the name parts themselves (proposal 5.3).

### Errors

`401`; `404 profile_not_found` (no such user, or not allowed to see it).

---

## GET /api/v1/users/profiles

Returns the names for a page of accounts in one call, for the admin account list. Without it, a page of 20 accounts would need 20 profile calls.

| | |
|---|---|
| **Service** | users |
| **Routing** | ALB rule 110, `/api/v1/users/*` |
| **Access** | Permission `profiles:read:any` (admins). Audited, with the ids requested. |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Used by** | The account list on the admin screen, in both apps, once per page after `GET /api/v1/auth/accounts` |
| **Today** | None: `full_name` comes with `GET /api/v1/admin/users` |

### Request

| Query | Type | Required | Rules |
|---|---|---|---|
| `ids` | comma-separated user ids | ✅ | 1–100 UUIDv4s; anything else is `422`. Ids aren't personal data, so they can be in the URL. |

### Processing

One query, `{_id: {$in: ids}}`. Once the cluster is sharded it reads every zone, which is accepted for an admin screen. Address fields are **not** returned: the list doesn't need them, and fewer copies of personal data travel.

### Response

```json
{
  "items": [
    { "id": "6f1c2a9e-…", "first_name": "Jane", "middle_name": null, "last_name": "Doe" }
  ]
}
```

Ids with no profile are left out, not reported as errors.

### Errors

`401`; `403 forbidden`; `422`.

---

## PATCH /api/v1/users/{user_id}/profile

Updates names and address.

| | |
|---|---|
| **Service** | users |
| **Access** | The user themself, or permission `profiles:write:any` (admins; audited, with the changed field **names**). Anyone else gets `404`. |
| **Rate limit** | 30 per minute per user |
| **Success** | `200 OK` with the updated profile |
| **Today** | None: there's no way to edit `full_name` today |
| **Used by** | A new profile screen in account settings in both apps (proposal 16, step 7). Admins have no edit screen; `profiles:write:any` is for admin tools. |

### Request

Any subset of these fields; each one sent is replaced, and `null` clears an optional one.

| Field | Type | Rules |
|---|---|---|
| `first_name` | string | 1–100 characters after trimming; can't be `null` |
| `middle_name`, `last_name` | string \| null | ≤ 100 |
| `address_line_one`, `address_line_two`, `address_line_three` | string \| null | ≤ 200; never logged |

An empty body or an unknown field is `422`.

### Processing

1. Update `users.users`, increment `version`, set `updated_at`.
2. **No event is published yet.** `user.profile_updated` is reserved for connect, which doesn't exist (proposal 7.6). No other service holds names or the address.

### Errors

`401`; `404 profile_not_found`; `422`.

---

## GET /api/v1/users/{user_id}/preferences

Returns app preferences.

| | |
|---|---|
| **Service** | users |
| **Access** | The user themself (`me`), or `profiles:read:any` (with `?location=`, the owner's). Others get `404`. |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Today** | `GET /api/v1/user/preferences` |

### Response

```json
{ "tts_enabled": true }
```

`tts_enabled` defaults to `true`, as today. `last_visited_path` and today's `dark_mode` are gone (proposal 5.3): neither app reads them.

---

## PATCH /api/v1/users/{user_id}/preferences

Updates app preferences.

| | |
|---|---|
| **Service** | users |
| **Access** | The user themself, or `profiles:write:any` (with `?location=`, the owner's). Others get `404`. |
| **Rate limit** | 30 per minute per user, as today |
| **Success** | `200 OK` with all preferences |
| **Today** | `PATCH /api/v1/user/preferences` |

### Request

| Field | Type | Rules |
|---|---|---|
| `tts_enabled` | bool | ✅ |

Unknown fields (including `last_visited_path` and `dark_mode`) are `422`. No event is published: no other service uses preferences.

---

## PUT /internal/users/{user_id}

Creates or replaces a profile. Called only by auth, in the registration saga (proposal 10.1).

| | |
|---|---|
| **Service** | users |
| **Routing** | Cloud Map, `users.{app}-{env}.internal:8001` |
| **Access** | A service token with `aud = "users-internal"` and `sub = "auth"`. Any other caller gets `403`. |
| **Success** | `201 Created` for a new profile, `200 OK` when it already existed |
| **Today** | None |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `first_name` | string | ✅ | 1–100 |
| `middle_name`, `last_name` | string | — | ≤ 100 |
| `location` | string | ✅ | The account's location; immutable afterwards |
| `address_line_one` … `_three` | string | — | ≤ 200 |

### Processing

An upsert on `{_id: user_id, location}`, setting `preferences` to the defaults on insert. A retry with the same body changes nothing, so the saga can retry safely. A different `location` for an existing profile is `409 location_mismatch`: location never changes.

---

## DELETE /internal/users/{user_id}

Deletes a profile. Called only by auth, to undo registration step 6 when a later step fails, and by the `auth-worker` reaper for leftovers (proposal 10.1).

| | |
|---|---|
| **Service** | users |
| **Routing** | Cloud Map, port 8001 |
| **Access** | A service token with `sub = "auth"` |
| **Success** | `204 No Content`, also when there was no profile |
| **Today** | None |

Query `location` is required. **This isn't account deletion:** that's the event-driven saga, where users deletes the profile on `user.deletion_requested` and publishes `user.data_deleted` (proposal 10.3).

---

## GET /api/v1/children

Lists the signed-in parent's children, with their journey progress, for the Home page.

| | |
|---|---|
| **Service** | children |
| **Routing** | ALB rule 100, `/api/v1/children` |
| **Access** | A parent sees their own children. An admin with `children:read:any` must pass `?user_id=` (audited). |
| **Used by** | Home in both apps. The admin `?user_id=` read is **for admin tools only for now**: no app screen shows another family's children. |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Today** | Same path; sort parameter `-created_date` |

### Request

| Query | Type | Default | Rules |
|---|---|---|---|
| `sort` | enum `created_at`, `-created_at`, `name`, `-name` | `-created_at` | |
| `limit` | int | 50 | 1–200 |
| `user_id` | string | — | Admins only; anyone else sending it gets `403` |
| `location` | string | With `user_id` | The owner's location, from the account listing, so the read stays in the owner's zone |

### Processing

One query: `{location, user_id, is_deleted: false}`, using the `{location, user_id, is_deleted}` index (proposal 12.2).

### Response

`200 OK`, an array of children in the [GET /api/v1/children/{id}](#get-apiv1childrenid) shape.

---

## POST /api/v1/children

Adds a child.

| | |
|---|---|
| **Service** | children |
| **Access** | Parents only; admins get `403`, as today |
| **Rate limit** | 20 per minute per user, as today |
| **Success** | `201 Created` |
| **Today** | Same path. Unknown fields are stored (`extra = "allow"`), and `age` accepts strings like `"12 years"`. |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | ✅ | 1–255 after trimming |
| `age` | int | — | 0–25 |
| `gender` | string | — | ≤ 50 |
| `school` | string | — | ≤ 300 |
| `avatar_id` | string | — | ≤ 100, an emoji avatar id |

**Unknown fields are `422`.** Onboarding answers, personality and progress can't be set here: they belong to other services. A photo can't be set on create either; upload it afterwards with [avatar/presign](#post-apiv1childrenidavatarpresign).

### Processing

1. Refuse if the parent already has 10 children that aren't deleted (`422 child_limit`), as today.
2. Insert the child with `_id` (new UUIDv4), the parent's `user_id` and `location`, all `progress` flags `false`, and `version: 1`. If `name`, `age` and `gender` are all present, set `progress.profile = true` (proposal 12.1).
3. In the same transaction, publish one `child.changed` with the full snapshot, including `progress` (proposal 7.4).

### Response

`201 Created` with the child, as in [GET /api/v1/children/{id}](#get-apiv1childrenid).

### Errors

`401`; `403 parents_only`; `422` (validation, or `child_limit`).

---

## GET /api/v1/children/{id}

Returns one child.

| | |
|---|---|
| **Service** | children |
| **Access** | The child's parent, or `children:read:any` (audited; admin tools only for now, as in the list; the admin passes `?location=`, the owner's). Anyone else gets `404`. |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Today** | Same path; also returns the onboarding answers, personality, jobs lock and the old progress flags |

### Response

```json
{
  "id": "c0ffee00-…",
  "name": "Aarav",
  "age": 9,
  "gender": "boy",
  "school": "Green Valley School",
  "avatar_id": null,
  "avatar_url": "https://uploads.example.com/uploads/ap-south-1/c0ffee00-…/….jpg?X-Amz-…",
  "progress": {
    "profile": true, "conversation": true, "discover": false,
    "grow": false, "transform": false, "release": false, "connect": false
  },
  "created_at": "2026-10-24T09:30:00Z",
  "updated_at": "2026-10-24T09:45:00Z"
}
```

- `avatar_url` is a presigned GET for `avatar_key`, valid for `UPLOADS_URL_TTL_SECONDS` (default 1 hour), as today. It's `null` when the child has an emoji avatar or none.
- The circles' data isn't here: each circle page calls its own service (proposal 12.2).
- `created_date` is renamed to `created_at`.

### Errors

`401`; `404 child_not_found` (no such child, deleted, or not this user's).

---

## PATCH /api/v1/children/{id}

Updates a child's profile fields.

| | |
|---|---|
| **Service** | children |
| **Access** | The child's parent only; admins get `403` |
| **Rate limit** | 30 per minute per user, as today |
| **Success** | `200 OK` with the updated child |
| **Today** | Same path. It also accepts the onboarding and personality fields and `visited_tabs`, and sets `conversational_onboarding_completed` as a side effect. |

### Request

Any subset of these fields; `null` clears an optional one.

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1–255; can't be `null` |
| `age` | int \| null | 0–25 |
| `gender` | string \| null | ≤ 50 |
| `school` | string \| null | ≤ 300 |
| `avatar_id` | string \| null | ≤ 100. Setting it clears `avatar_key`. |
| `avatar_key` | string \| null | The key returned by avatar/presign. Setting it clears `avatar_id`. |

Unknown fields are `422`.

### Processing

1. **Checking `avatar_key`:**
   - it must start with this child's **avatar** prefix, `uploads/{location}/{child_id}/avatar/` (`422 invalid_avatar_key`). Plan photos live under `…/ninety-day-plan/`, so a plan photo can't be set as the avatar, and replacing the avatar can never delete transform's object;
   - `HeadObject` must find it, with an allowed image type and at most **5 MB** (`422 avatar_not_uploaded` or `avatar_too_large`). A presigned PUT can't limit size, so this check is where the limit is enforced.
2. **Update:** apply the changes and increment `version`. If `name`, `age` and `gender` are now all present for the first time, set `progress.profile = true`.
3. **Event, in the same transaction:** one `child.changed` with the full snapshot, if `name`, `age`, `gender` or `progress` changed (proposal 7.4). Transform clears the child's Life Pathway milestones when `age` or `gender` differs from its copy, as today's `_LIFE_PATHWAY_INPUTS` does. A `school` or avatar change alone publishes nothing: no other service holds them.

A replaced or cleared photo's old object is deleted from S3 after the update commits.

### Errors

`401`; `403 parents_only`; `404 child_not_found`; `409 child_changed` (changed by another request each of 3 tries; try again); `422`.

---

## DELETE /api/v1/children/{id}

Deletes a child. Hidden at once, kept for 30 days, then purged.

| | |
|---|---|
| **Service** | children |
| **Access** | The child's parent only |
| **Rate limit** | 10 per minute per user, as today |
| **Success** | `204 No Content` |
| **Today** | Same path; soft delete, but no purge job exists (production-readiness PRIV-02) |

### Processing

1. **Soft delete:** set `is_deleted = true`, `deleted_at` and `updated_at`, increment `version`, and publish `child.changed` (with `is_deleted: true`). Each circle marks its `child_access` copy deleted, so the child disappears everywhere and its pages return `404`. Circle data is kept.
2. **Purge, after 30 days:** the `children-worker` purge job hard-deletes the child and its avatar object, then publishes `child.deleted`. Each circle then deletes its data and S3 objects for that child (proposal 10.2).
3. **Account deletion** doesn't wait for the 30 days: `user.deletion_requested` deletes everything at once (10.3).

There's no restore endpoint. Within the 30 days, support can restore a child by clearing `is_deleted` (and publishing `child.changed`).

### Errors

`401`; `403 parents_only`; `404 child_not_found` (already deleted, or not this user's).

---

## POST /api/v1/children/{id}/avatar/presign

Returns a URL for uploading a child's photo straight to S3.

| | |
|---|---|
| **Service** | children |
| **Routing** | ALB rule 100: the path matches no circle prefix |
| **Access** | The child's parent only |
| **Rate limit** | 20 per minute per user, as today |
| **Success** | `200 OK` |
| **Today** | Same path; returns `avatar_url`, which the client sends back in `PATCH` |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `content_type` | string | ✅ | `image/jpeg`, `image/png`, `image/webp` or `image/gif`, as today |

### Response

```json
{
  "upload_url": "https://<bucket>.s3.<region>.amazonaws.com/uploads/…?X-Amz-…",
  "avatar_key": "uploads/ap-south-1/c0ffee00-…/avatar/9f8e….jpg",
  "avatar_url": "https://…?X-Amz-…"
}
```

The flow:
1. **Upload:** the client PUTs the file to `upload_url` within **5 minutes**, with the same `Content-Type`.
2. **Save:** it then sends `PATCH /api/v1/children/{id}` with `{"avatar_key": …}`.
3. **Preview:** `avatar_url` is a short-lived GET URL, so the photo can be shown at once.

The key is created with `build_upload_key` under `uploads/{location}/{child_id}/avatar/`. Today avatars sit directly under the child's prefix, which also contains the plan photos; the `avatar/` sub-prefix keeps each service's objects, and its IAM access, apart.

### Errors

`401`; `403 parents_only`; `404 child_not_found`; `415 unsupported_image_type`; `502 upload_url_failed` (S3 error); `503 uploads_not_configured`.

---

## GET /internal/children/{id}

Returns a child's `child_access` fields. Circles call it for read-through when their local copy is missing (proposal 7.5).

| | |
|---|---|
| **Service** | children |
| **Routing** | Cloud Map, `children.{app}-{env}.internal:8001` |
| **Access** | A service token with `aud = "children-internal"`, from any circle service |
| **Success** | `200 OK` |
| **Today** | None |

**Request:** path `id`, query `location`.

**Response:**

```json
{
  "child_id": "c0ffee00-…",
  "user_id": "6f1c2a9e-…",
  "location": "ap-south-1",
  "name": "Aarav",
  "age": 9,
  "gender": "boy",
  "is_deleted": false,
  "progress": { "profile": true, "conversation": true, "discover": false, "grow": false, "transform": false, "release": false, "connect": false },
  "version": 7
}
```

It includes soft-deleted children (`is_deleted: true`), so the caller can store that too. The caller checks `user_id` against the request's user itself.

**Errors:** `401` invalid token; `404` no such child (purged or never existed), which the caller turns into `404 child_not_found`.

---

## GET /api/v1/children/{id}/onboarding

Returns the child's onboarding answers, once the conversation is finished.

| | |
|---|---|
| **Service** | onboarding |
| **Routing** | ALB rule 10, `/api/v1/children/*/onboarding*` |
| **Access** | Circle rules (conventions). Unlocked once `progress.profile` is set; if the local copy says otherwise, onboarding asks children (`GET /internal/children/{id}`) before refusing. |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Used by** | The conversational onboarding screen in both apps, on opening, to know whether the chat is already done |
| **Today** | The trait fields on `GET /api/v1/children/{id}` |

### Response

```json
{
  "status": "completed",
  "child_name": "Aarav",
  "answers": {
    "strengths": ["curious", "kind"],
    "hobbies": ["drawing"],
    "thinking_pattern": "…",
    "communication_style": "…",
    "energy_level": "…",
    "social_behaviour": "…",
    "emotional_behaviour": "…"
  },
  "completed_at": "2026-10-24T09:50:00Z"
}
```

- **Before the chat is finished,** the response is `{"status": "not_started", "child_name": "Aarav", "answers": {}, "completed_at": null}`, not `404`. The server stores nothing until the end; while the chat is in progress, the app keeps its place, as today.
- **The child's name** for the heading is `child_name`, from the same database (`child_access`), with no second call (proposal 12.2).
- **An admin** with `children:read:any` passes the owner's `?location=` (`422 location_required` without it); the read is audited, and there's no unlock check.

### Errors

Circle errors (conventions): `404 child_not_found`; `403 circle_locked` (the profile isn't complete, and children confirms it); `503 children_unavailable` with `Retry-After` when children can't be asked. `422 location_required` for an admin without `?location=`.

---

## PUT /api/v1/children/{id}/onboarding

Saves the conversation's seven answers, once, at the end of the chat. The app keeps the answers while the parent goes through the chat, then sends them all in one call.

| | |
|---|---|
| **Service** | onboarding |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | 10 per minute per user |
| **Success** | `201 Created` the first time, `200 OK` when answers are changed later; both with the response of GET |
| **Used by** | The conversational onboarding screen, once, when the seventh answer is given |
| **Today** | The answers are sent in one `PATCH /api/v1/children/{id}` at the end, together with `onboarding_phase` and `onboarding_completed` |

### Request

All seven answers are required:

| Field | Type | Rules |
|---|---|---|
| `strengths` | string[] | 1–20 items, each 1–200 characters |
| `hobbies` | string[] | 1–20 items, each 1–200 characters |
| `thinking_pattern` | string | 1–500 |
| `communication_style` | string | 1–500 |
| `energy_level` | string | 1–500 |
| `social_behaviour` | string | 1–500 |
| `emotional_behaviour` | string | 1–500 |

A missing field, `null`, an unknown field or a value of the wrong type (no coercion) is `422`. Surrounding whitespace is trimmed, so a blank answer is `422` too. The question wording stays in the apps; the server stores only the answers (proposal 12.1).

### Processing

1. **First save:** create the `conversations` document with the seven answers and `completed_at`, and `version: 1`. In the same transaction, publish `onboarding.conversation_completed` with the seven answers. Then:
   - children sets `progress.conversation`;
   - discover starts generating the personality on its own (proposal 12.1), so the app doesn't call discover. It goes on to the Discover page, which shows "generating…".
2. **A later save** (the same seven fields, changed): replace the answers, increment `version` and publish `onboarding.answers_updated`. Grow, transform and release update their copies; the personality isn't regenerated (proposal 12.1). Sending identical answers changes nothing and publishes nothing.

3. **Races:** each save is decided against the conversation as it read it. Two first saves at once make one conversation (the second becomes a change to it), and a save that keeps losing is `409 conversation_changed`. A child or account deleted meanwhile (a tombstone) is `404`.

### Errors

Circle errors (conventions, as in GET); `409 conversation_changed`; `422`.

**Differences from today:** a dedicated endpoint, still one call at the end of the chat; completion is decided by the server when it receives all seven answers, not by the client sending `onboarding_completed: true`; `onboarding_phase` and `current_phase` are gone (proposal 12.1).

---

## GET /internal/onboarding/children/{id}/status

Confirm-before-deny for discover (proposal 12.4).

| | |
|---|---|
| **Service** | onboarding |
| **Routing** | Cloud Map, `onboarding.{app}-{env}.internal:8001` |
| **Access** | A service token with `aud = "onboarding-internal"`. Callers: **discover** (confirm-before-deny) |
| **Success** | `200 OK` |

Query `location` is required. The response is `{"completed": true}`: `completed` is `true` once the conversation is completed. A child with no conversation returns `{"completed": false}`.

---

## GET /internal/onboarding/children/{id}/answers

Read-through for the `onboarding_inputs` copies in discover, grow, transform and release (proposal 7.5).

| | |
|---|---|
| **Service** | onboarding |
| **Routing** | Cloud Map, port 8001 |
| **Access** | A service token with `aud = "onboarding-internal"`. Callers: **discover, grow, transform, release** (read-through) |
| **Success** | `200 OK` |

Query `location` is required. The response has the `onboarding_inputs` fields (proposal 4.1): `child_id`, `user_id`, `location`, the seven answers and `version`. It returns `404` until the conversation is completed, because the copies exist only after `onboarding.conversation_completed`.

---

## GET /api/v1/children/{id}/personality

Returns the child's AI personality for the Discover page.

| | |
|---|---|
| **Service** | discover |
| **Routing** | ALB rule 20, `/api/v1/children/*/personality*` |
| **Access** | Circle rules. Unlocked once the conversation is completed; confirm-before-deny asks onboarding. |
| **Rate limit** | 60 per minute per user |
| **Success** | `200 OK` |
| **Used by** | Discover (Personality Journey and Personality Profile) in both apps |
| **Today** | `personality.view_model` on `GET /api/v1/children/{id}`, built in the browser by `adaptAiPersonalityToViewModel` |

### Response

```json
{
  "status": "ready",
  "view_model": { "profile": { "name": "Aarav" }, "...": "…" },
  "job_id": null,
  "finalised_at": "2026-10-24T09:52:00Z",
  "viewed_at": null
}
```

| `status` | Meaning | What the page shows |
|---|---|---|
| `not_started` | No generation yet. Usually only for a moment: discover starts one as soon as `onboarding.conversation_completed` arrives, and the page may open first. | Calls `POST …/generation`, which returns the automatic job if it has started meanwhile |
| `generating` | A job is running; `job_id` is set | "Generating…", polling the job |
| `ready` | `view_model` is set | The personality |
| `failed` | The last job failed | A retry button (`POST …/generation`) |

- **`view_model`** is built and validated **by the server** from the LLM output, replacing the browser's `adaptAiPersonalityToViewModel`. Its shape is the one the Discover pages render today. The raw `analysis` is never returned.
- **Generated once:** the personality comes from the answers at the end of the conversation. Later answer changes don't regenerate it (proposal 12.1).
- **`viewed_at`** is set once the parent has passed the reveal splash ([POST …/personality/viewed](#post-apiv1childrenidpersonalityviewed)). Until then Discover isn't done, and Grow stays locked.
- **`job_id`** is set only while `generating`; `view_model` only when `ready`.
- **`view_model`** is `{type, scores, profile}`, as `adaptAiPersonalityToViewModel` built it: the port is checked against that code's output on a set of fixtures (`backend/discover/tests/fixtures`). As today, `profile.famous_people` comes from the archetype's table, not from the LLM's `role_models`, and has no images (the apps draw the avatars).
- **An admin** with `children:read:any` passes the owner's `?location=` (`422 location_required` without it); audited, no unlock check.

### Errors

Circle errors (conventions): `404 child_not_found`; `403 circle_locked` (the conversation isn't completed, and onboarding confirms it); `503 children_unavailable` or `onboarding_unavailable` with `Retry-After` when an owner can't be asked.

---

## POST /api/v1/children/{id}/personality/generation

Starts the personality generation when there's none. Discover starts it on its own when the conversation completes, so this endpoint is for a **retry after `failed`**, and for the page opening while the status is still `not_started` (common: the app opens Discover right after the onboarding `PUT`).

| | |
|---|---|
| **Service** | discover |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | Generation rules (conventions) |
| **Success** | `202 Accepted` with `{"job_id", "status": "pending"}`, or `200 OK` with the running job |
| **Used by** | Discover: the retry button after a failure, and on opening the page when `status` is `not_started` (as `PersonalityJourney` does today when no job is running) |
| **Today** | `POST /api/v1/jobs` with `type: "generate_personality_analysis"`, a client-built prompt and a `write_back` target |

### Request

No body. `kind` is always `personality`.

### Processing

1. If the personality is `ready`, return `409 already_generated`: there's no regeneration (proposal 12.1).
   - **Starting is atomic:** both this endpoint and the automatic start run **one transaction** (same database, same zone) with two writes: the upsert on `{_id: child_id, location, status: {$in: ["not_started", "failed"]}}`, setting `status: "generating"` and a new `active_job_id`, and the insert of that job. Either both happen or neither does, so a personality can't be left `generating` with no job. No document yet means the upsert creates it. A **duplicate-key error** means the document exists with another status: the caller lost the race, reads the document and returns its `active_job_id` (`200`), or `409` if it's `ready`. Two jobs can never start for one child.
2. **The worker** (job type `generate_personality_analysis`):
   - builds the prompt from `onboarding_inputs` and `child_access` (name, age, gender);
   - calls the LLM, and checks the answer against the expected schema;
   - builds `view_model`, stores it with `analysis`, and sets `status: "ready"`;
   - in the same transaction, publishes `discover.personality_finalised` with the trait summary and strengths, so grow and transform update their copies. **Discover isn't done yet:** that waits for the parent to pass the reveal splash ([POST …/personality/viewed](#post-apiv1childrenidpersonalityviewed)).
   - On final failure, it sets `status: "failed"`.

- **Answers not copied yet:** the start reads them through from onboarding (`GET /internal/onboarding/children/{id}/answers`) first, so the job has its inputs; onboarding not having them is `503 onboarding_unavailable`.
- **The hourly LLM limit** is counted only when a new job starts, not when the running one is returned.
- **The automatic start** comes from `onboarding.conversation_completed`, whose payload carries the child's `user_id` (an optional field, added for this). It starts nothing when the personality is already `generating` or `ready`.

### Errors

Circle errors (as in GET); `409 already_generated`; `429 llm_limit` (with `Retry-After`); `503 generation_unavailable` (the job couldn't be stored); `404 child_not_found` for a child or account being deleted.

**Differences from today:** no prompt or `write_back` from the client.

---

## GET /api/v1/children/{id}/personality/generation/{job_id}

**Service:** discover (ALB rule 20). Returns a personality job's status. Follows the generation rules (conventions); rate limit 60 per minute per user. Used by Discover while `status` is `generating`. **Today:** `GET /api/v1/jobs/{job_id}`.

---

## POST /api/v1/children/{id}/personality/viewed

Records that the parent has passed the Discover reveal splash. That's what makes Discover done and unlocks Grow (proposal 12.4).

| | |
|---|---|
| **Service** | discover |
| **Routing** | ALB rule 20, `/api/v1/children/*/personality*` |
| **Access** | The child's parent only; unlocked as in GET personality |
| **Rate limit** | 30 per minute per user |
| **Success** | `200 OK` with the personality, as in GET |
| **Used by** | The reveal splash in Personality Journey, in both apps (`handleDiscoverSplashReady`), when the parent goes on to the Personality Profile |
| **Today** | `POST /api/v1/children/{id}/progress/discover_completed`, from the same splash |

### Request

No body.

### Processing

1. If the personality's `status` isn't `ready`, return `409 personality_not_ready`. The parent can't mark Discover done without a personality, which today's flag allows.
2. **The first time:** set `viewed_at` and increment `version`, and in the same transaction publish `discover.completed`. Children then sets `progress.discover`, which unlocks Grow.
3. **Again later:** nothing changes and nothing is published.

### Errors

Circle errors; `409 personality_not_ready`.

---

## GET /internal/discover/children/{id}/status

Confirm-before-deny for grow (proposal 12.4). Cloud Map, port 8001, service token `aud = "discover-internal"` (caller: **grow**), query `location`. Returns `{"completed": true}`: `completed` is `true` once the personality is ready **and** the parent has passed the reveal (`viewed_at` set).

---

## GET /internal/discover/children/{id}/summary

Read-through for the `personality_inputs` copies in grow and transform (proposal 7.5). Cloud Map, port 8001, service token `aud = "discover-internal"` (callers: **grow, transform**), query `location`. Returns the `personality_inputs` fields (proposal 4.1), `traits` and `strengths`, with `version`; or `404` until a personality is finalised. `traits` is `{dominant_style, personality_category, traits, description}` and `strengths` the profile's strength bullets, the same as `discover.personality_finalised`'s payload; the response also has `child_id`, `user_id` and `location`.

---

## GET /api/v1/children/{id}/growth-areas

Returns all of the child's growth areas, with their questions, answers and recommendations.

| | |
|---|---|
| **Service** | grow |
| **Routing** | ALB rule 30, `/api/v1/children/*/growth-areas*` |
| **Access** | Circle rules. Unlocked once Discover is done; confirm-before-deny asks discover. |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Used by** | Growth Areas in both apps. The Life Pathway, Transform and Release pages no longer call it: they read their own copies (proposal 12.2). |
| **Today** | `GET /api/v1/user/completed-growth-areas?child_id=…`, also called by Transform and Release pages |

### Response

```json
{
  "areas": [
    {
      "area_id": "self_care",
      "area_name": "Self care",
      "status": "completed",
      "step": null,
      "parent_questions": { "...": "…" },
      "child_rounds": { "...": "…" },
      "answers": { "q1": "Often", "q2": "Sometimes" },
      "child_activity": { "selections": ["…"], "results": { "summary": "…", "strengths": [], "suggested_activities": [] } },
      "recommendations": ["…"],
      "ai_three_month_recommendations": [{ "...": "…" }],
      "feedback": null,
      "generating": [],
      "completed_at": "2026-10-24T10:20:00Z",
      "updated_at": "2026-10-24T10:20:00Z"
    }
  ]
}
```

- Areas come back in the order they were started.
- `generating` lists the kinds with a job running for that area, so the page knows what to poll.
- **The generated parts are stored normalised,** by today's normalisers run on the server: `parent_questions` is `{"questions": [{"id": "self_care_gq1", "question", "hint"}, …]}` (five), `child_rounds` is `{"rounds": [{"a": {"id": "self_care_gr1a", "text", "star", "tag", "icon"}, "b": {…}}, …]}` (six; `icon` is a key such as `rocket`, which the apps draw), and `ai_three_month_recommendations` is `[{"title", "detail"}]`. The apps' own normalisers give the same result again, so they keep working as they are.
- **An admin** with `children:read:any` passes the owner's `?location=` (`422 location_required` without it); audited, no unlock check.
- It's one query (proposal 12.2). There's no pagination: a child has a handful of areas, each at most 64 KB.

---

## PUT /api/v1/children/{id}/growth-areas/{area_id}

Saves one growth area: the parent's progress through its wizard, and its completion.

| | |
|---|---|
| **Service** | grow |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` with the area, as in GET |
| **Used by** | Growth Areas in both apps, at each wizard step |
| **Today** | `POST /api/v1/user/completed-growth-areas?child_id=…`, an upsert keyed by `area_id` in the body |

### Request

`area_id` (path): `^[a-z0-9_-]{1,50}$`, as today's ids (`self_care`, `life_ambition`, …). It must not start with another circle's path word (`onboarding`, `personality`, `growth-areas`, `transform`, `observations`, `connect`), so the ALB's mid-path patterns can't send it to the wrong service (proposal 13.1). Body:

| Field | Type | Required | Rules |
|---|---|---|---|
| `area_name` | string | ✅ | 1–100 |
| `status` | enum `in_progress` / `completed` | ✅ | `completed` can't go back to `in_progress` (`422 area_completed`) |
| `step` | string | — | ≤ 100; the wizard step, while `in_progress` |
| `answers` | map of question id → string | ✅ | ≤ 100 keys; each value ≤ 1,000. Keys must be ids from the area's `parent_questions`. |
| `child_activity` | object | — | `selections` ≤ 50 items; `results.summary` ≤ 2,000, `results.strengths` ≤ 20, `results.suggested_activities` ≤ 20 |
| `recommendations` | string[] | — | ≤ 50 |
| `feedback` | string | — | ≤ 2,000 |

- The generated fields are **not** accepted: `parent_questions`, `child_rounds` and `ai_three_month_recommendations` are written by grow's jobs only (`422`). So are today's dropped wizard fields (proposal 12.1).
- The whole area must be ≤ 64 KB, as today.

### Processing

1. **Save:** upsert `{location, _id: "{child_id}:{area_id}"}` (one document per area, proposal section 14) and increment `version`.
2. **Completing an area** (`status` becomes `completed`), in the same transaction:
   - set `completed_at` and clear `step`;
   - publish `grow.area_completed` with `area_id`, `area_name`, the answers, the child-activity results, `recommendations` and `ai_three_month_recommendations`;
   - if it's the child's first completed area, also publish `grow.completed`. Children then sets `progress.grow`, which unlocks Transform.
3. **Editing a completed area** publishes `grow.area_updated`. Transform then clears that area's Life Pathway milestones, which were built from the old answers.

4. **Races:** a save is decided against the area as it read it; two first saves at once make one area, and a save that keeps losing is `409 area_changed`. A child or account deleted meanwhile is `404`.
5. **Unchanged saves** (every field the same) change nothing and publish nothing.

### Errors

Circle errors (`403 circle_locked` once discover confirms Discover isn't done; `503 …_unavailable` when an owner can't be asked); `409 area_changed`; `422` (validation, `unknown_question`, a generated field sent, `area_completed`, `area_too_large`, `invalid_area_id`).

---

## POST /api/v1/children/{id}/growth-areas/{area_id}/generation

Generates one of an area's AI parts.

| | |
|---|---|
| **Service** | grow |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | Generation rules (conventions) |
| **Success** | `202 Accepted` with `{"job_id", "status": "pending"}`, or `200 OK` with the running job |
| **Used by** | Growth Areas (questions, activity rounds, recommendations), in both apps |
| **Today** | `POST /api/v1/jobs` with one of three types, a client-built prompt and a `write_back` target |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `kind` | enum | ✅ | One of the three below |
| `area_name` | string | Only for `parent_questions` on a new area | 1–100; ignored otherwise |

| `kind` | Today's job type | Generated once? | Needs | Writes |
|---|---|---|---|---|
| `parent_questions` | `generate_growth_parent_questions` | Yes, per area (`409 already_generated` after) | Discover done | `parent_questions` |
| `child_rounds` | `generate_growth_child_rounds` | Yes, per area | Discover done | `child_rounds` |
| `recommendations` | `generate_recommendations` | No; a new job replaces the result | The area's answers saved | `ai_three_month_recommendations` (no `pending_recommendations` staging) |

### Processing

1. **Create the job.** For `parent_questions` on an area that doesn't exist yet, first create the area document with `status: "in_progress"`, the path's `area_id` and the body's `area_name`.
2. **The worker:**
   - builds the prompt from the area document and grow's local copies: `child_access` (name, age, gender), `onboarding_inputs` and `personality_inputs`;
   - calls the LLM, and checks the answer against the kind's schema;
   - writes the result to the area's field (as in the table above).
   - **For `recommendations` on a completed area,** it also publishes `grow.area_updated`, because transform's Life Pathway prompt uses `ai_three_month_recommendations` first, as today's `useLifePathwayArea` does. The question sets publish nothing: no other service uses them.

3. **Before the job:** the copies its prompt uses are read through if missing (onboarding's answers, discover's summary), and the hourly LLM limit is counted for a new job only. Each kind has its own lock, so different kinds can run at once for one area.
4. **What's stored** goes through today's normalisers (word caps, ids assigned by the server, icons checked against the keys); an answer they reject is retried, then the job fails and the area keeps what it had. A job never changes the area's `status`.

### Errors

Circle errors; `404 area_not_found` (any kind but `parent_questions`, for an area that doesn't exist); `409 already_generated`; `409 needs_answers`; `422 unknown_area` (generation is for the six areas the apps show) or `invalid_area_id`; `429 llm_limit`; `503 generation_unavailable`.

---

## GET /api/v1/children/{id}/growth-areas/{area_id}/generation/{job_id}

**Service:** grow (ALB rule 30). Returns a grow job's status. Follows the generation rules (conventions), including `kind`; rate limit 60 per minute per user. **Today:** `GET /api/v1/jobs/{job_id}`.

---

## GET /internal/grow/children/{id}/status

Confirm-before-deny for transform (proposal 12.4). Cloud Map, `grow.{app}-{env}.internal:8001`, service token `aud = "grow-internal"` (caller: **transform**), query `location`. Returns `{"completed": true}`: `completed` is `true` once any growth area is completed.

---

## GET /internal/grow/children/{id}/areas

Read-through for the `growth_inputs` copies in transform and release (proposal 7.5). Cloud Map, port 8001, service token `aud = "grow-internal"` (callers: **transform, release**), query `location`. Returns the completed areas in the `growth_inputs` shape (proposal 4.1): `area_id`, `area_name`, `answers`, `child_activity_results`, `recommendations`, `ai_three_month_recommendations`, each with its `version`. It's an empty list until an area is completed. The response is `{"areas": [...]}`; each also has `child_id`, `user_id` and `location`, and `child_activity_results` is the area's `child_activity.results`. The `grow.area_completed` and `grow.area_updated` payloads carry the same fields plus `user_id`.

---

## Not in the grow API

Two endpoints that an earlier draft of proposal 13.4 planned are left out, because neither app would call them:
- **`DELETE …/growth-areas`** (today's `DELETE /api/v1/user/completed-growth-areas`): the client method `completedGrowthAreas.clear` exists in both apps but is never called. "Start over" deletes the whole child instead.
- **`GET …/growth-areas/{area_id}`**: every page loads the full list, which is one query.

---

## GET /api/v1/children/{id}/transform

Returns everything the Transform circle shows: the Life Pathway (milestones per completed growth area) and the 90-day plan with its tracker.

| | |
|---|---|
| **Service** | transform |
| **Routing** | ALB rule 40, `/api/v1/children/*/transform*` |
| **Access** | Circle rules (conventions). Unlocked once Grow is done (a growth area completed); confirm-before-deny asks grow. |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Used by** | The Life Pathway page (`/LifePathway/:childId`) and the 90-day plan dashboard in both apps |
| **Today** | `GET /api/v1/user/ninety-day-plan?child_id=…` for the plan, plus `GET /api/v1/user/completed-growth-areas` for the milestones |

### Response

```json
{
  "areas": [
    {
      "area_id": "self_care",
      "area_name": "Self care",
      "life_pathway_milestones": { "...": "…" },
      "life_pathway_generating": false
    }
  ],
  "ask": "Help him handle frustration calmly",
  "plan": { "...": "…" },
  "track_steps": { "...": "…" },
  "applied": { "tip-1": true },
  "act_inputs": {}, "act_counts": {},
  "track_done": {}, "track_inputs": {}, "track_sittings": {},
  "feedback": {},
  "event_name": "School play",
  "event_date": "2027-01-20",
  "event_set": true,
  "photos": { "act:week-1": [{ "key": "uploads/ap-south-1/c0ffee00-…/ninety-day-plan/….jpg", "url": "https://…?X-Amz-…" }] },
  "generating": [],
  "completed_at": null
}
```

- `areas` lists the completed growth areas from transform's `growth_inputs` copy, with each area's Life Pathway milestones (stored in transform, below). It's one read, plus the copy, in the same database (proposal 12.2).
- `photos` gives each photo's stored S3 `key` and a short-lived GET `url`. The client needs the keys to add or remove one photo without dropping the others (PATCH below).
- `generating` lists the plan-level kinds with a job running (`plan`, `event_tracker`); each area's `life_pathway_generating` says whether its milestones are being generated.
- **`life_pathway_milestones`** is stored normalised by today's `normalizeLifePathwayArea`, run on the server: an object keyed by slot (`y1`, `y2`, `y3`, `y5`, `y8`, `y10`: years after the child's age), with only the usable milestones (`title`, `guided`, `power`, `drift`). The apps' own normaliser reads it back the same, and fills a missing slot from its fallback copy, as today.
- Areas come in the order their copies were last updated; a plan with no document yet answers with empty maps and `event_set: false`.
- **An admin** with `children:read:any` passes the owner's `?location=` (`422 location_required` without it); audited, no unlock check.

---

## PATCH /api/v1/children/{id}/transform

Saves the parent's work on the 90-day plan: goal, tips applied, activities, tracker progress, the Day-90 event and photos.

| | |
|---|---|
| **Service** | transform |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` with the same body as GET |
| **Used by** | The 90-day plan screens in both apps (`useNinetyDayPlan`) |
| **Today** | `PATCH /api/v1/user/ninety-day-plan?child_id=…`, same fields |

### Request

Any subset; each field sent replaces the stored one. Map keys match `^[a-zA-Z0-9:_-]{1,100}$`.

| Field | Type | Rules |
|---|---|---|
| `ask` | string | ≤ 2,000 |
| `applied` | map → bool | |
| `act_inputs` | map → string | |
| `act_counts` | map → int | |
| `track_done` | map → bool | |
| `track_inputs` | map → string | |
| `track_sittings` | map → bool | |
| `feedback` | map → object | |
| `event_name` | string | ≤ 200 |
| `event_date` | date (`YYYY-MM-DD`) | Today any string ≤ 32 |
| `event_set` | bool | |
| `photos` | map of field key → string[] | S3 **keys**. Each field key sent replaces that field's list, so to add a photo the client sends the existing keys (from GET) plus the new one from [photos/presign](#post-apiv1childrenidtransformphotospresign); field keys not sent are left alone |
| `clear_track_steps` | bool | `true` clears `track_steps`, as today, when the event is retargeted |

`plan`, `track_steps` and the Life Pathway can't be set here: jobs write them. The body must be ≤ 64 KB, as today.

### Processing

1. **Photos:** each key must be under the child's plan-photo prefix (`uploads/{location}/{child_id}/ninety-day-plan/`, as today), and `HeadObject` must find an allowed image of at most **5 MB**. Otherwise `422`.
2. **Save:** upsert the plan document and increment `version`. Removed photo keys are deleted from S3 after the commit.
3. **Completion:** if `plan` exists and `event_set` is now `true` with an `event_date`, and the plan wasn't complete yet:
   - set `completed_at`;
   - publish `transform.completed` in the same transaction. Children sets `progress.transform`, which unlocks Release (proposal 12.4).
   - Clearing the event later doesn't undo it.

4. **Races:** a save is decided against the plan as it read it, version-conditional; two first saves at once make one plan, and one that keeps losing is `409 plan_changed`. A child or account deleted meanwhile is `404`.
5. **`event_date`** is stored as a date and returned as `YYYY-MM-DD`; `null` clears it.

### Errors

Circle errors (`403 circle_locked` once grow confirms no area is completed; `503 …_unavailable` when an owner can't be asked); `409 plan_changed`; `422` (validation, a generated field sent, a bad map key, `invalid_photo_key`, `photo_not_uploaded`, `photo_too_large`, `plan_too_large`); `503 uploads_not_configured` for photos without an uploads bucket.

---

## POST /api/v1/children/{id}/transform/generation

Generates one of Transform's AI parts.

| | |
|---|---|
| **Service** | transform |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | Generation rules (conventions) |
| **Success** | `202 Accepted` with `{"job_id", "status": "pending"}`, or `200 OK` with the running job |
| **Used by** | The Life Pathway page (milestones per area) and the "Start {name}'s 90 days" flow (`StartJourneyModal`), in both apps |
| **Today** | `POST /api/v1/jobs` with `generate_life_pathway`, `generate_ninety_day_plan` or `generate_event_tracker` |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `kind` | enum | ✅ | `life_pathway`, `plan` or `event_tracker` |
| `area_id` | string | For `life_pathway` | A completed area in transform's `growth_inputs` |

| `kind` | Today's job type | Needs | Writes |
|---|---|---|---|
| `life_pathway` | `generate_life_pathway` | The area completed in grow | `life_pathway.<area_id>` on the plan document (proposal 12.1), returned as that area's `life_pathway_milestones` in GET |
| `plan` | `generate_ninety_day_plan` | Transform unlocked | `plan` |
| `event_tracker` | `generate_event_tracker` | `plan` exists and `event_set` with `event_date` | `track_steps` |

### Processing

The worker:
1. builds the prompt from the plan document and transform's copies: `child_access`, `onboarding_inputs` (strengths), `personality_inputs` and `growth_inputs` (the areas' answers and recommendations);
2. calls the LLM and checks the answer against the kind's schema;
3. writes the field.
   - A finished `plan` can complete Transform, if the event is already set (see PATCH).
   - **Life Pathway milestones are cleared,** so the page offers to generate them again, when:
     - the child's `age` or `gender` changes (`child.changed`, as today's `_LIFE_PATHWAY_INPUTS`);
     - or that area's answers change (`grow.area_updated`).

- **Before the job:** a `life_pathway` start reads grow's completed areas through if the area isn't in the copy yet; `plan` and `life_pathway` read the personality through from discover if needed. The hourly LLM limit is counted for a new job only. Each kind has its own lock, and the Life Pathway one per area.
- **The `plan`** needs the parent's `ask` (`409 needs_ask`): the prompt is built around it. **The tracker** is built around the event and the same `ask` (today the app derives a label from the `ask` by keyword; the words themselves are used instead).
- **What's stored:** the Life Pathway through today's normaliser (above); the plan and the tracker as the LLM wrote them once they fit their schemas (`ninetyDayPlanSchema`, `ninetyDayTrackerSchema`). An answer that doesn't is retried, then the job fails.

### Errors

Circle errors; `409 needs_completed_area` (the area isn't completed in grow, or isn't this child's) / `needs_ask` / `needs_plan` / `needs_event`; `422 area_id_required`; `429 llm_limit`; `503 generation_unavailable`.

---

## GET /api/v1/children/{id}/transform/generation/{job_id}

**Service:** transform (ALB rule 40). Returns a transform job's status. Follows the generation rules (conventions), including `kind`; rate limit 60 per minute per user. **Today:** `GET /api/v1/jobs/{job_id}`.

---

## POST /api/v1/children/{id}/transform/photos/presign

Returns a URL for uploading a 90-day-plan photo straight to S3.

| | |
|---|---|
| **Service** | transform |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | 20 per minute per user, as today |
| **Success** | `200 OK` |
| **Used by** | Photo capture in the 90-day plan, in both apps |
| **Today** | `POST /api/v1/user/ninety-day-plan/photo-presign?child_id=…` |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `field_key` | string | ✅ | `^[a-zA-Z0-9:_-]{1,100}$`; the plan item the photo belongs to |
| `content_type` | string | ✅ | `image/jpeg`, `image/png`, `image/webp` or `image/gif` |

### Response

```json
{
  "upload_url": "https://<bucket>.s3.<region>.amazonaws.com/uploads/…?X-Amz-…",
  "photo_key": "uploads/ap-south-1/c0ffee00-…/ninety-day-plan/….jpg",
  "photo_url": "https://…?X-Amz-…"
}
```

The flow:
1. **Upload:** the client PUTs the file to `upload_url` within **5 minutes**.
2. **Save:** it adds `photo_key` to `photos[field_key]` with `PATCH …/transform`, where the 5 MB limit is checked.
3. **Preview:** `photo_url` is a short-lived GET URL, so the photo can be shown at once.

### Errors

Circle errors; `415 unsupported_image_type`; `502 upload_url_failed`; `503 uploads_not_configured`.

---

## GET /internal/transform/children/{id}/status

Confirm-before-deny for release (proposal 12.4). Cloud Map, `transform.{app}-{env}.internal:8001`, service token `aud = "transform-internal"` (caller: **release**), query `location`. Returns `{"completed": true}`: `completed` is `true` once `completed_at` is set (plan generated and Day-90 event set).

---

## GET /api/v1/children/{id}/observations

Returns the child's observation patterns and what the parent is watching, for the Release circle.

| | |
|---|---|
| **Service** | release |
| **Routing** | ALB rule 50, `/api/v1/children/*/observations*` |
| **Access** | Circle rules. Unlocked once Transform is done; confirm-before-deny asks transform. |
| **Rate limit** | 60 per minute per user, as today |
| **Success** | `200 OK` |
| **Used by** | The Observations page (`/Observations/:childId`) in both apps |
| **Today** | `GET /api/v1/user/observations?child_id=…` |

### Response

```json
{
  "status": "ready",
  "source": "llm",
  "items": [ { "id": "obs-1", "title": "…", "icon": "…", "...": "…" } ],
  "watching": ["obs-1"],
  "span": "2 weeks",
  "started_at": "2026-10-24T11:00:00Z",
  "job_id": null,
  "completed_at": "2026-10-24T11:00:00Z"
}
```

- `status` is `not_started`, `generating`, `ready` or `failed`, as for the personality.
- `items` has at most 8 patterns, already validated by the server (icon and source enums). Today's `pending_observations` staging is gone. In practice it holds the six the page shows: the server runs today's `normalizeObservations` (a card needs a note and a source; icons from the registry, `note` as the fallback; a "Chose … over …" note only if it matches a line the prompt was given) and `selectObservations` (every offered evidence block gets a card before any gets a second). Each item is `{id, title, summary, notes, icon, sources}`; `id` is the title's slug, as today.
- `job_id` is set only while `generating`. With no document yet the answer is `not_started` with empty `items` and `watching`.
- **An admin** with `children:read:any` passes the owner's `?location=` (`422 location_required` without it); audited, no unlock check.

---

## PATCH /api/v1/children/{id}/observations

Saves which patterns the parent watches and for how long ("Start tracking").

| | |
|---|---|
| **Service** | release |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | 20 per minute per user, as today |
| **Success** | `200 OK` with the same body as GET |
| **Used by** | "Start tracking" on the Observations page, in both apps |
| **Today** | `PATCH /api/v1/user/observations?child_id=…` with `watching`, `span` and a client-made `started_at`; the client also PATCHes `items` to promote generated patterns |

### Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `watching` | string[] | ✅ | ≤ 8 ids, each one of the current `items` |
| `span` | string | ✅ | ≤ 50, e.g. `"2 weeks"` |

`items` and `source` can't be set (jobs write them), and `started_at` is set by the server.

### Processing

1. Check every id in `watching` is in `items` (`422 unknown_pattern`).
2. Save `watching` and `span`, set `started_at = now`, and increment `version`.
3. **The first time `watching` is non-empty:** set `completed_at` and publish `release.completed` in the same transaction. Children sets `progress.release`, which unlocks Connect (proposal 12.4). Un-watching everything later doesn't undo it.

4. **Races:** decided against the document as read, version-conditional; two first saves make one document, and one that keeps losing is `409 observations_changed`. Duplicate ids in `watching` count once.

### Errors

Circle errors; `409 observations_changed`; `422` (validation, `unknown_pattern`, `items`, `source` or `started_at` sent).

---

## POST /api/v1/children/{id}/observations/generation

Generates the observation patterns.

| | |
|---|---|
| **Service** | release |
| **Access** | The child's parent only; unlocked as in GET |
| **Rate limit** | Generation rules (conventions) |
| **Success** | `202 Accepted` with `{"job_id", "status": "pending"}`, or `200 OK` with the running job |
| **Used by** | The Observations page, when it opens with no patterns, and its refresh action, in both apps |
| **Today** | `POST /api/v1/jobs` with `generate_observations`, a client-built prompt and `write_back` to `pending_observations` |

### Request

No body. `kind` is always `observations`.

Starting is atomic, as for the personality: one transaction with the upsert on `{_id: child_id, location, status: {$in: ["not_started", "failed", "ready"]}}` that sets `status: "generating"`, and the job insert. A duplicate-key error means a job is already running, and its `job_id` is returned.

### Processing

The worker:
1. builds the prompt from release's copies:
   - `child_access`: name, age, gender;
   - `onboarding_inputs`: the questionnaire answers;
   - `growth_inputs`: the growth areas' answers and child-activity results.
2. calls the LLM and checks the answer against the schema: at most 8 items, and only known icons and sources;
3. replaces `items`, sets `source: "llm"` and `status: "ready"`, and clears `watching`, as today's promote step does: a tick against an older set of cards has no meaning against a new one.
   - `completed_at` stays: Release remains done.

- **The evidence** comes from release's copies. Each completed area's `growth_inputs` copy carries `reflections` (the questions with the parent's answers) and `child_choices` (the picks as `Chose “X” over “Y”` lines); grow sends both in `grow.area_completed` / `grow.area_updated` (optional fields, added for this). Before the job, missing copies are read through from onboarding and grow, and with nothing to read back the start is `409 needs_evidence`.

### Errors

Circle errors; `409 needs_evidence`; `429 llm_limit`; `503 generation_unavailable`.

---

## GET /api/v1/children/{id}/observations/generation/{job_id}

**Service:** release (ALB rule 50). Returns a release job's status. Follows the generation rules (conventions); rate limit 60 per minute per user. **Today:** `GET /api/v1/jobs/{job_id}`.

---

## GET /internal/release/children/{id}/status

Confirm-before-deny for connect (proposal 12.4). Cloud Map, `release.{app}-{env}.internal:8001`, service token `aud = "release-internal"` (caller: **children**, for the Connect visit until connect exists; then connect), query `location`. Returns `{"completed": true}`: `completed` is `true` once `completed_at` is set (a pattern watched).

---

## POST /api/v1/children/{id}/connect/visit

Records that the parent has opened the Connect circle.

| | |
|---|---|
| **Service** | **children, until the connect service exists** (see below) |
| **Routing** | Today: ALB rule 100 (`/api/v1/children/*`), because there's no connect rule yet. Once connect is built: rule 60 (`/api/v1/children/*/connect*`). |
| **Access** | The child's parent only. Unlocked once Release is done: children checks its own `progress.release`, and asks release (`GET /internal/release/children/{id}/status`) before refusing. |
| **Rate limit** | 30 per minute per user |
| **Success** | `200 OK` with `{"progress": {…}}` |
| **Used by** | The Connect page (`Connect.tsx`) in both apps, on opening |
| **Today** | `POST /api/v1/children/{id}/progress/connect_visited` |

### Processing

1. Refuse with `403 circle_locked` if Release isn't done. When the child's `progress.release` isn't set yet, release is asked; a `404` from it counts as not done, and an unreachable or odd answer is `503 release_unavailable` with `Retry-After: 2`.
2. Set `progress.connect = true` (one-way) and increment `version`. If release had to confirm, `progress.release` is set in the same write, so Home agrees before `release.completed` arrives (that event then changes nothing). If it changed, publish `child.changed` (the full snapshot) in the same transaction. A repeat visit returns the progress unchanged, with no event.

**Connect isn't a service yet.** The page has no data of its own today, so there's nothing for a connect service to own. Until it's built:
- children serves this one endpoint, and sets the flag directly;
- no `connect.visited` event is needed, because the owner of progress is the one recording the visit;
- `connect` isn't in `common.deletion.PARTICIPANTS`, and no `connect` database, queue or ECS service exists.

When Connect gets data of its own, the connect service takes over this path, through ALB rule 60, and publishes `connect.visited`, which children consumes (proposal 12.4).

### Errors

`401`; `403 parents_only`; `403 circle_locked`; `404 child_not_found`; `429`; `503 release_unavailable`.

---

## POST /api/v1/speech/transcriptions

Turns a voice recording into text, for the voice input shared by several circles.

| | |
|---|---|
| **Service** | shared |
| **Routing** | ALB rule 130, `/api/v1/speech/*` |
| **Access** | Signed in, parents only (admins get `403`), as today |
| **Rate limit** | 10 per minute per user, as today |
| **Success** | `200 OK` |
| **Used by** | The voice-input button in both apps |
| **Today** | `POST /api/v1/audio/transcribe` |

### Request

`multipart/form-data` with one file field, `audio`:
- ≤ **10 MB**, as today;
- type `webm`, `mp3`, `wav`, `m4a`, `ogg` or `mp4`.

### Processing

1. Send the audio to OpenAI's transcription API (`whisper-1`, language `en`), as today, with `OPENAI_API_KEY` from shared's own secret (proposal 15.1).
2. Return the text. Nothing is stored: shared has no database, and the audio isn't kept or logged.

The type comes from the upload's last extension, after control characters are stripped (`webm` without one). OpenAI gets a fixed name, `recording.<ext>`, and that type's MIME, never the parent's filename or `Content-Type`. A failed call logs the error's type only.

### Response

```json
{ "transcript": "He gets upset when his tower falls over" }
```

### Errors

`401`; `403 parents_only`; `413 audio_too_large`; `415 unsupported_audio_type`; `429`; `502 transcription_unavailable`; `503 transcription_not_configured`.

---

## GET /api/v1/downloads/apk

Returns a short-lived link to the latest Android APK.

| | |
|---|---|
| **Service** | shared |
| **Routing** | ALB rule 130, `/api/v1/downloads/*` |
| **Access** | Signed in, **parents only** (admins get `403`), as today: the route requires `CurrentParent`, and the edge also rejects it without a token. |
| **Rate limit** | 10 per minute per user |
| **Success** | `200 OK` |
| **Used by** | The "Download the Android app" button on Home in the web app (`api.downloads.getApkUrl`) |
| **Today** | Same path and response |

### Processing

List the APKs under `app-assets/applications/android/` in the assets bucket (`us-east-1`), pick the newest key, and presign a GET for 300 seconds with `Content-Disposition: attachment; filename="superpower-android.apk"`.

### Response

```json
{ "url": "https://…?X-Amz-…", "filename": "superpower-android.apk", "expires_in": 300 }
```

### Errors

`401`; `403 parents_only`; `404 apk_not_available` (no build yet); `429`; `503 downloads_not_configured` (no assets bucket); `503 downloads_unavailable` (the bucket can't be listed).

---

## GET /api/health

Returns the running build, for smoke tests and support.

| | |
|---|---|
| **Service** | shared |
| **Routing** | Edge: `PURE_BYPASS_PATHS`. ALB: rule 140. |
| **Access** | Public |
| **Rate limit** | 30 per minute per IP, as today |
| **Success** | `200 OK` |
| **Today** | Same path, served by the backend through the catch-all rule |

### Response

```json
{ "status": "ok", "commit": "a1b2c3d", "branch": "main", "committed_at": "2026-10-23T18:00:00Z", "tag": "v1.4.0" }
```

Values are `"unknown"` when the image has no build metadata, as today; `tag` is `null` when the build has none.

It reports **shared's** build only. Each service's own health is its target group's `GET /health` on port 8000, which isn't routed through the ALB.
