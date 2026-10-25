# API Overview

All routes are prefixed `/api/v1`. Auth endpoints use rate limiting (slowapi).

## Auth (`/api/v1/auth/...`)

- `POST /auth/register` — create account, returns token pair (rate-limited: 5/min per IP)
- `POST /auth/login` — email/password login, returns token pair (rate-limited: 10/min per IP)
- `POST /auth/google` — Google ID-token login/register, returns token pair (rate-limited: 5/min per IP)
- `POST /auth/refresh` — issue a new token pair using only the refresh token cookie (access token cookie is optional — included as a defence-in-depth subject check when present; rate-limited: 20/min per user)
- `POST /auth/logout` — revoke the current session (deletes the refresh token; returns 204 No Content; rate-limited: 20/min per user)
- `GET /auth/me` — return current user (`id`, `email`, `full_name`, `role`; rate-limited: 60/min per user)
- `DELETE /user/me` *(path: `/api/v1/user/me`)* — permanently delete the authenticated user's account (returns 204 No Content; rate-limited: 3/min per user)

Protected routes read the `access_token` from an HTTP-only cookie set at login. There is no `Authorization` header — auth is cookie-based throughout.

## User state (`/api/v1/user/...`)

- `GET/PATCH /user/preferences` — user preferences (`tts_enabled`, `dark_mode`, `last_visited_path`; rate-limited: 60/min GET, 30/min PATCH per user)
- `GET/POST/DELETE /user/completed-growth-areas?child_id=` — log completed growth areas with child activity results; GET supports `limit` (1–200, default 50) and `offset` (default 0); DELETE clears all for the child and returns 204 No Content (rate-limited: 60/min GET+POST, 10/min DELETE per user)
- `GET/PATCH /user/observations?child_id=` — LLM-generated observations document for a child (plus parent-entered fields); returns an empty document rather than 404 if the child doesn't exist (query is scoped by `user_id` so no data leaks); PATCH requires `transform_visited` on the child (rate-limited: 60/min GET, 20/min PATCH per user)
- `GET/PATCH /user/ninety-day-plan?child_id=` — 90-day plan + event tracker document for a child (LLM-generated `plan`/`track_steps` plus parent/child-entered progress fields); same empty-document/`transform_visited` behaviour as observations (rate-limited: 60/min per user)
- `POST /user/ninety-day-plan/photo-presign` — presigned S3 PUT URL for an achievement/tracker photo; client uploads directly to S3, then PATCHes `/user/ninety-day-plan` with the returned `photo_url` recorded against `field_key` in the `photos` map. Photos are stored as S3 keys and returned as short-lived S3 presigned GET URLs; PATCH accepts a key or one of our own URLs under this child's `ninety-day-plan/` prefix, anything else is 422 (rate-limited: 20/min per user)

## Children (`/api/v1/children/...`)

- `GET /children?sort=&limit=` — list children (`sort`: `created_date` / `-created_date` / `name` / `-name`, default `-created_date`; `limit`: 1–200, default 50; rate-limited: 60/min per user)
- `POST /children` — create a child profile; max 10 children per user (rate-limited: 20/min per user)
- `GET /children/{child_id}` — get a single child by ID (rate-limited: 60/min per user)
- `PATCH /children/{child_id}` — update a child profile (rate-limited: 30/min per user)
- `DELETE /children/{child_id}` — soft-delete a child profile: hidden immediately, retained 30 days for recovery, then purged by a scheduled hard-delete job (returns 204 No Content; rate-limited: 10/min per user)
- `POST /children/{child_id}/progress/{flag}` — mark a Personality Journey progression flag done; one-way (false→true), one flag per call, gated on the previous step in the chain already being true. Valid flags: `onboarding_profile_completed`, `discover_completed`, `transform_visited`, `release_visited`, `connect_visited` (`grow_completed`/`conversational_onboarding_completed` are derived, not settable here) — this is the only way to set these fields; `PATCH /children/{child_id}` silently ignores them (rate-limited: 30/min per user)
- `POST /children/{child_id}/avatar/presign` — presigned S3 PUT URL for a child avatar photo; client uploads directly to S3, then PATCHes the child with the returned `avatar_url` (rate-limited: 20/min per user). `avatar_url` is stored as the S3 key and returned as a short-lived S3 presigned GET URL; PATCH accepts a key or one of our own URLs for this child, anything else is 422, and `POST /children` rejects it

## Jobs (`/api/v1/jobs/...`) — async LLM job pipeline

- `POST /jobs` — enqueue an LLM job; returns `job_id` immediately (201), a background worker processes it asynchronously. Max 2 in-flight jobs per (child, job type). `type` is one of: `generate_recommendations`, `generate_activity`, `generate_personality_analysis`, `generate_life_pathway`, `generate_growth_parent_questions`, `generate_growth_child_rounds`, `generate_observations`, `generate_ninety_day_plan`, `generate_event_tracker` — each gated server-side on the relevant Personality Journey progression flag already being true (403 otherwise; rate-limited: 30/min per user)
- `GET /jobs/{job_id}` — poll job status: `pending` → `processing` → `result_ready` → `completed` (or `failed`). Re-fetch the domain resource (e.g. `/user/observations`, `/user/ninety-day-plan`) once `status == "completed"` — never trust a job-carried payload directly (rate-limited: 60/min per user)

## Admin (`/api/v1/admin/...`) — admin role required, all rate-limited 60/min

- `GET /admin/allowed-emails?skip=&limit=` — paginated registration allowlist (`limit`: 1–100, default 20)
- `POST /admin/allowed-emails` — add an email to the allowlist (409 if already present)
- `GET /admin/allowed-emails/{email}` — fetch a single allowlist record
- `DELETE /admin/allowed-emails/{email}` — remove an email from the allowlist (returns 204 No Content)
- `GET /admin/users?skip=&limit=` — paginated list of registered users, newest first (`limit`: 1–100, default 20)
- `GET /admin/users/by-email/{email}` — look up a registered user by email
- `PATCH /admin/users/{user_id}/lock?location=` — lock a user account: revokes all tokens and blocks login; cannot lock your own account (`location` is the user's location shard, as returned by `/admin/users`)
- `PATCH /admin/users/{user_id}/unlock?location=` — unlock a previously locked account

## LLM (`/api/v1/llm/...`)

- `POST /llm/invoke` — send a prompt to an LLM; optionally pass `response_json_schema` for structured JSON output and `provider` (`"openai"` | `"anthropic"` | `"gemini"`) to pin a specific model. Without `provider`, the server auto-selects the first configured key in priority order: OpenAI → Anthropic → Gemini. Returns 503 if no provider is configured (rate-limited: 30/min per user, plus a Redis-based sliding-window LLM rate limiter).
- `GET /llm/providers` — returns which providers have a key configured and which would be auto-selected (rate-limited: 60/min per user).

## Audio (`/api/v1/audio/...`)

- `POST /audio/transcribe` — transcribe an uploaded audio file (multipart upload) via OpenAI Whisper. Max file size: 10 MB. Requires `OPENAI_API_KEY` (rate-limited: 10/min per user).

## Downloads (`/api/v1/downloads/...`)

- `GET /downloads/apk` — returns a pre-signed S3 URL for the APK download (5-minute validity; rate-limited: 10/min per user).

## Health

- `GET /health` — returns `{"status": "ok"}` (no auth, no rate limit)
- `GET /api/health` — returns `{"status": "ok", "commit": "<git-sha>", "branch": "<branch>", "committed_at": "<iso-timestamp>", "tag": "<tag>|null"}` — git metadata is baked into the image at build time via Docker build args (CI sets real values; local/scan builds return `"unknown"`; no auth; rate-limited: 30/min per IP)

## users service (`backend/users/`, build plan 3.1)

The first service of the split, built but **not yet routed in any environment**: today's backend still serves `/api/v1/user/...` above. Full reference: [auth-users-split-api.md](auth-users-split-api.md). Tokens come from the `access_token` cookie or `Authorization: Bearer`.

- `GET/PATCH /users/{user_id}/profile` — names and address (`{user_id}` is your id or `me`). An admin needs `profiles:read:any` / `profiles:write:any` and the owner's `?location=` (422 `location_required` without it). Anyone else gets the same `404 profile_not_found` as a missing profile. PATCH replaces each field sent and `null` clears an optional one; admin changes are audited with the field names only (rate-limited: 60/min GET, 30/min PATCH per user).
- `GET/PATCH /users/{user_id}/preferences` — `{"tts_enabled": bool}`, default `true`; `dark_mode` and `last_visited_path` are gone, so sending them is 422 (same access and limits).
- `GET /users/profiles?ids=` — names (no address) for 1–100 accounts, for the admin list; admins only, audited per id (60/min per user).
- Internal, port 8001, auth's service token only: `PUT /internal/users/{user_id}` (create or replace; 201 / 200; `409 location_mismatch`, `409 profile_deleted`) and `DELETE /internal/users/{user_id}?location=` (204).
- The worker (`python -m users.worker`) deletes the profile on `user.deletion_requested` and confirms with `user.data_deleted`.

## auth service (`backend/auth/`, build plan 3.2)

Built but **not yet routed in any environment**; today's backend still serves `/api/v1/auth/...` above. Full reference: [auth-users-split-api.md](auth-users-split-api.md). Errors the apps tell apart carry `detail.code`.

- `POST /auth/register` — allow-listed emails only (`403 registration_closed`); `first_name` (required), `middle_name`, `last_name`, `country_code`, optional address lines; no `full_name`. Runs the registration saga: reserve the email's HMAC key, save credentials, create the users profile, activate. `409 email_taken`, `503 registration_unavailable` (users unreachable; retry), `201` with tokens and cookies (rate-limited: 5/min per IP).
- `POST /auth/login` — `401 invalid_credentials` for any wrong email or password; the lock (`403 account_locked`) is revealed only with the right password. 5 failures in 15 minutes for one email from one IP block that pair (`429 too_many_attempts`) (10/min per IP).
- `POST /auth/google` — signs in an existing account whatever its provider, or creates one (allow-list, `country_code` required: `422 country_code_required`) (5/min per IP).
- `POST /auth/refresh` — rotates the refresh token within its family; a rotated token reused within 30 s gets a pair too, later it revokes the family and logs the account out everywhere (`401 session_revoked`). Every refusal clears both cookies (20/min per user).
- `POST /auth/logout` (204, always, unless the tokens belong to different users) and `POST /auth/logout-all` (204, every session, and every older access token) (20/min, 3/min per user).
- `GET /auth/me` — `id`, `email`, `role`, `auth_provider`, `location`, `created_at`; names are in the users service (60/min per user).
- Access tokens now carry `role` and `iat_ms`; refresh tokens `family_id`. Every sign-in writes the account's `authz:{user_id}` entry to Valkey through the versioned write.
- Local: `cd backend && python -m auth.seed` adds `LOCAL_ALLOWED_EMAIL` (from `.env`) to the local allow-list.
- Admin (each needs its permission; audited; 60/min per user): `GET /auth/accounts` (filters `role`, `locked`; `skip` / `limit`), `POST /auth/accounts/search` (email in the body), `POST /auth/accounts/{id}/lock` and `/unlock` and `PATCH /auth/accounts/{id}/role` (each with the account's `?location=`; never the last active admin: `409 last_admin`; never an account being deleted: `409 account_deleting`), and the allow-list: `GET /auth/allowed-emails`, `POST /auth/allowed-emails/search`, `POST /auth/allowed-emails`, `DELETE /auth/allowed-emails/{key}` (its HMAC key, never an email). Lock and role change sign the account out everywhere; unlock keeps the old tokens invalid.
- `DELETE /auth/account` — body `{"confirm_email"}` (must match; `400 confirmation_mismatch`); `202 {"status": "deleting"}`: signed out everywhere at once, and the data is deleted as each service confirms (`DELETION_PARTICIPANTS`: `users` and `children` so far; `409 account_changed` if the role or lock changed meanwhile). The email is free again when the saga finishes (3/min per user).
- Internal: `GET /internal/auth/users/{user_id}/email?location=` — for a service that must contact a user; no service is allowed yet (403), and every read is audited.
- Internal, port 8001: `GET /internal/authz/{user_id}` — the account's authz entry for the other services' cache misses (callers: every service that verifies tokens); it refills Valkey. The worker (`python -m auth.worker`) keeps each region's cached entries current from a change stream on `auth.auth`, and reaps registrations abandoned for 15 minutes.

## children service (`backend/children/`, build plan 4.1)

Built but **not yet routed in any environment**; today's backend still serves `/api/v1/children/...` above. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children` — your live children with their `progress`, in one query (`sort`: `created_at`, `-created_at` (default), `name`, `-name`; `limit` 1–200). An admin passes the parent's `?user_id=` and `?location=` (audited) (60/min per user).
- `POST /children` — parents only; `name`, `age` (0–25), `gender`, `school`, `avatar_id`; unknown fields are 422; at most 10 children (`422 child_limit`) (20/min).
- `GET / PATCH / DELETE /children/{id}` — someone else's child is `404 child_not_found`. PATCH replaces the fields sent (`null` clears), and `avatar_id` / `avatar_key` exclude each other; it's checked against the version it read and retried, `409 child_changed` if it keeps losing. DELETE hides the child at once (204); the purge follows after 30 days (60 / 30 / 10 per min).
- `POST /children/{id}/avatar/presign` — `{content_type}` → `{upload_url, avatar_key, avatar_url}`. PUT the photo within 5 minutes, then PATCH the child with `avatar_key`: it must be this child's `…/avatar/` key, an allowed image, at most 5 MB (20/min).
- `progress.profile` is set by the service once name, age and gender are all present. `created_date` is now `created_at`, and the onboarding answers, personality and phase fields are gone (they belong to the circles).
- Internal, port 8001: `GET /internal/children/{id}?location=` — a child's access fields, deleted or not, for the circles' read-through.
- The worker (`python -m children.worker`) sets each progress flag from its circle's completion event (in any order), purges children deleted more than 30 days ago (`child.deleted`), and deletes all of a user's children on account deletion.

