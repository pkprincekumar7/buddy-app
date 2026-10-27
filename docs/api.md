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
- `DELETE /auth/account` — body `{"confirm_email"}` (must match; `400 confirmation_mismatch`); `202 {"status": "deleting"}`: signed out everywhere at once, and the data is deleted as each service confirms (`DELETION_PARTICIPANTS`: all seven services that hold user data; `409 account_changed` if the role or lock changed meanwhile). The email is free again when the saga finishes (3/min per user).
- Internal: `GET /internal/auth/users/{user_id}/email?location=` — for a service that must contact a user; no service is allowed yet (403), and every read is audited.
- Internal, port 8001: `GET /internal/authz/{user_id}` — the account's authz entry for the other services' cache misses (callers: every service that verifies tokens); it refills Valkey. The worker (`python -m auth.worker`) keeps each region's cached entries current from a change stream on `auth.auth`, and reaps registrations abandoned for 15 minutes.

## children service (`backend/children/`, build plan 4.1)

Built but **not yet routed in any environment**; today's backend still serves `/api/v1/children/...` above. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children` — your live children with their `progress`, in one query (`sort`: `created_at`, `-created_at` (default), `name`, `-name`; `limit` 1–200). An admin passes the parent's `?user_id=` and `?location=` (audited) (60/min per user).
- `POST /children` — parents only; `name`, `age` (0–25), `gender`, `school`, `avatar_id`; unknown fields are 422; at most 10 children (`422 child_limit`) (20/min).
- `GET / PATCH / DELETE /children/{id}` — someone else's child is `404 child_not_found`. PATCH replaces the fields sent (`null` clears), and `avatar_id` / `avatar_key` exclude each other; it's checked against the version it read and retried, `409 child_changed` if it keeps losing. DELETE hides the child at once (204); the purge follows after 30 days (60 / 30 / 10 per min).
- `POST /children/{id}/avatar/presign` — `{content_type}` → `{upload_url, avatar_key, avatar_url}`. PUT the photo within 5 minutes, then PATCH the child with `avatar_key`: it must be this child's `…/avatar/` key, an allowed image, at most 5 MB (20/min).
- `POST /children/{id}/connect/visit` — no body → `{progress}`; parents only (build plan 5.7). Sets `progress.connect` once (a repeat changes nothing). Locked until Release is done (`403 circle_locked`): if the child's own `progress.release` isn't set, release is asked first, and its yes sets both flags; `503 release_unavailable` with `Retry-After` when it can't be asked (30/min).
- `progress.profile` is set by the service once name, age and gender are all present. `created_date` is now `created_at`, and the onboarding answers, personality and phase fields are gone (they belong to the circles).
- Internal, port 8001: `GET /internal/children/{id}?location=` — a child's access fields, deleted or not, for the circles' read-through.
- The worker (`python -m children.worker`) sets each progress flag from its circle's completion event (in any order), purges children deleted more than 30 days ago (`child.deleted`), and deletes all of a user's children on account deletion.

## onboarding service (`backend/onboarding/`, build plan 5.1)

Built but **not yet routed in any environment**; today the answers are trait fields on `PATCH /api/v1/children/{id}`. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children/{id}/onboarding` — `{status, child_name, answers, completed_at}`: `not_started` with `answers: {}` until the chat is finished, then `completed`. An admin passes the owner's `?location=` (audited) (60/min per user).
- `PUT /children/{id}/onboarding` — the child's parent sends all seven answers once, at the end of the chat: `strengths` and `hobbies` (1–20 items of 1–200 characters), `thinking_pattern`, `communication_style`, `energy_level`, `social_behaviour`, `emotional_behaviour` (1–500 characters each). Missing, `null` or unknown fields are 422. `201` the first time (publishes `onboarding.conversation_completed`), `200` after (publishes `onboarding.answers_updated` only when an answer changed) (10/min).
- **Access:** someone else's, a deleted or an unknown child is `404 child_not_found`; until the child's profile is complete it's `403 circle_locked`, after asking children first; children unreachable is `503 children_unavailable` with `Retry-After`. Two saves racing resolve to one conversation; `409 conversation_changed` if a save keeps losing.
- Internal, port 8001: `GET /internal/onboarding/children/{id}/status?location=` (`{completed}`, for discover) and `GET /internal/onboarding/children/{id}/answers?location=` (the answers with `user_id` and `version`, `404` until completed; for discover, grow, transform and release).
- The worker (`python -m onboarding.worker`) relays the events, keeps the `child_access` copy from `child.changed`, deletes a purged child's conversation (`child.deleted`) and every conversation of a deleted account (`user.deletion_requested`, confirmed with `user.data_deleted`).

## discover service (`backend/discover/`, build plan 5.2)

Built but **not yet routed in any environment**; today the personality is `personality.view_model` on the child, built in the browser. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children/{id}/personality` — `{status, view_model, job_id, finalised_at, viewed_at}`; `status` is `not_started`, `generating` (with `job_id`), `ready` (with the server-built `view_model`, the shape the Discover pages render) or `failed`. An admin passes the owner's `?location=` (audited) (60/min per user).
- `POST /children/{id}/personality/generation` — no body. Starts the personality when there's none: `202 {job_id, status: "pending"}`, or `200` with the job already running; `409 already_generated` once ready (no regeneration); `429 llm_limit` past the hourly LLM limit; `503 generation_unavailable` if the job can't be stored (10/min). Usually not needed: discover starts it on its own when the conversation completes.
- `GET /children/{id}/personality/generation/{job_id}` — `{job_id, kind: "personality", status, error, created_at, completed_at}`; another child's job is `404 job_not_found` (60/min).
- `POST /children/{id}/personality/viewed` — the parent passed the reveal splash: Discover is done (publishes `discover.completed` once). `409 personality_not_ready` until `ready` (30/min).
- **Access:** as onboarding's, but unlocked once the conversation is completed (`403 circle_locked` after asking onboarding first); `503 children_unavailable` / `onboarding_unavailable` with `Retry-After` when an owner can't be asked.
- Internal, port 8001: `GET /internal/discover/children/{id}/status?location=` (`{completed}`: ready and the reveal passed; for grow) and `GET /internal/discover/children/{id}/summary?location=` (`traits`, `strengths`, `version`, `404` until ready; for grow and transform).
- The worker (`python -m discover.worker`, the only discover runtime with LLM keys) starts the personality on `onboarding.conversation_completed`, runs the jobs (prompt from its own copies, the answer checked against the schema, then `ready` with `discover.personality_finalised`), keeps the copies, and deletes on `child.deleted` and `user.deletion_requested`.

## grow service (`backend/grow/`, build plan 5.3)

Built but **not yet routed in any environment**; today's growth areas are `/api/v1/user/completed-growth-areas` above. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children/{id}/growth-areas` — `{areas: [...]}`, in the order they were started: each with `status`, `step`, the generated `parent_questions` (`{questions: [{id, question, hint}]}`) and `child_rounds` (`{rounds: [{a, b}]}`, icons as keys), `answers`, `child_activity`, `recommendations`, `ai_three_month_recommendations` (`[{title, detail}]`), `feedback`, `generating` (the kinds running) and the dates. An admin passes the owner's `?location=` (audited) (60/min per user).
- `PUT /children/{id}/growth-areas/{area_id}` — `area_name`, `status` (`in_progress` / `completed`), `step`, `answers` (keys must be the area's question ids: `422 unknown_question`), `child_activity`, `recommendations`, `feedback`. Generated fields and unknown fields are 422; `completed` can't go back (`422 area_completed`); at most 64 KB (`422 area_too_large`); `area_id` is today's (`self_care`, …) and never starts with another circle's path (`422 invalid_area_id`). Completing publishes `grow.area_completed` (and `grow.completed` for the child's first); editing a completed area, `grow.area_updated`; an identical save changes nothing (60/min).
- `POST /children/{id}/growth-areas/{area_id}/generation` — `{kind, area_name?}`, `kind` one of `parent_questions` (creates the area), `child_rounds`, `recommendations`: `202 {job_id, status}` or `200` with the job running; `409 already_generated` (the question sets are made once), `409 needs_answers`, `404 area_not_found`, `422 unknown_area` (generation is for the six areas the apps show), `429 llm_limit` (10/min). `GET …/generation/{job_id}` polls it (`kind`, `status`, `error`).
- **Access:** unlocked once Discover is done (`403 circle_locked` after asking discover first); `503 …_unavailable` with `Retry-After` when an owner can't be asked.
- Internal, port 8001: `GET /internal/grow/children/{id}/status?location=` (`{completed}`: any area completed; for transform) and `GET /internal/grow/children/{id}/areas?location=` (`{areas: [...]}`, the completed areas in `growth_inputs`' shape; for transform and release).
- The worker (`python -m grow.worker`, the only grow runtime with LLM keys) runs the three kinds of job (prompt from the area and grow's copies, the answer through today's normalisers), keeps the copies (`child_access`, `onboarding_inputs`, `personality_inputs`), and deletes on `child.deleted` and `user.deletion_requested`.

## transform service (`backend/transform/`, build plan 5.4)

Built but **not yet routed in any environment**; today's plan is `/api/v1/user/ninety-day-plan` above, and the milestones sit on the growth areas. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children/{id}/transform` — `areas` (each completed growth area with its `life_pathway_milestones`, keyed `y1`…`y10`, and `life_pathway_generating`), and the plan: `ask`, `plan`, `track_steps`, the parent's maps (`applied`, `act_inputs`, `act_counts`, `track_done`, `track_inputs`, `track_sittings`, `feedback`), `event_name`, `event_date` (`YYYY-MM-DD`), `event_set`, `photos` (`{field_key: [{key, url}]}`), `generating` (`plan`, `event_tracker`) and `completed_at`. An admin passes the owner's `?location=` (audited) (60/min per user).
- `PATCH /children/{id}/transform` — any subset of the parent's fields; each sent replaces the stored one, and each `photos` field key sent replaces that field's keys (S3 keys under the child's `…/ninety-day-plan/`, uploaded, an allowed image, ≤ 5 MB: `422 invalid_photo_key` / `photo_not_uploaded` / `photo_too_large`); `clear_track_steps` clears the tracker. `plan`, `track_steps` and the Life Pathway are 422; at most 64 KB (`422 plan_too_large`). Setting the Day-90 event (with a date) once the plan exists, or the plan arriving after it, completes Transform once (`transform.completed`) (60/min).
- `POST /children/{id}/transform/generation` — `{kind, area_id?}`: `life_pathway` (for a completed growth area: `409 needs_completed_area`), `plan` (`409 needs_ask`), `event_tracker` (`409 needs_plan` / `needs_event`); `202` or `200` with the job running; `429 llm_limit` (10/min). `GET …/generation/{job_id}` polls it.
- `POST /children/{id}/transform/photos/presign` — `{field_key, content_type}` → `{upload_url, photo_key, photo_url}`; PUT within 5 minutes, then PATCH the key into `photos` (`415`, `502`, `503 uploads_not_configured`) (20/min).
- **Access:** unlocked once a growth area is completed (`403 circle_locked` after asking grow first); `503 …_unavailable` with `Retry-After` when an owner can't be asked.
- Internal, port 8001: `GET /internal/transform/children/{id}/status?location=` (`{completed}`; for release).
- The worker (`python -m transform.worker`, the only transform runtime with LLM keys) runs the three kinds of job, keeps the copies (`child_access`, `onboarding_inputs`, `personality_inputs`, `growth_inputs`), clears the Life Pathway on an age or gender change and an area's milestones on `grow.area_updated`, and deletes (with the photos) on `child.deleted` and `user.deletion_requested`.

## release service (`backend/release/`, build plan 5.5)

Built but **not yet routed in any environment**; today's observations are `/api/v1/user/observations` above. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `GET /children/{id}/observations` — `{status, source, items, watching, span, started_at, job_id, completed_at}`; `items` are at most six patterns `{id, title, summary, notes, icon, sources}`, normalised and selected by the server as today's page did. An admin passes the owner's `?location=` (audited) (60/min per user).
- `PATCH /children/{id}/observations` — "Start tracking": `{watching, span}` only (ids of the current items: `422 unknown_pattern`; ≤ 8; `span` ≤ 50); `started_at` is set by the server. The first time something is watched, Release is done (`release.completed`); un-watching later doesn't undo it (20/min).
- `POST /children/{id}/observations/generation` — no body; `202` or `200` with the job running; a new set replaces the last and clears `watching` (Release stays done); `409 needs_evidence` with nothing to read back yet; `429 llm_limit` (10/min). `GET …/generation/{job_id}` polls it.
- **Access:** unlocked once Transform is done (`403 circle_locked` after asking transform first); `503 …_unavailable` with `Retry-After` when an owner can't be asked.
- Internal, port 8001: `GET /internal/release/children/{id}/status?location=` (`{completed}`; for children's Connect visit).
- The worker (`python -m release.worker`, the only release runtime with LLM keys) runs the job (the evidence from its copies of the questionnaire, the areas' reflections and the child's picks), keeps the copies, and deletes on `child.deleted` and `user.deletion_requested`.

## shared service (`backend/shared/`, build plan 5.6)

Built but **not yet routed in any environment**; today's equivalents are `/api/v1/audio/transcribe`, `/api/v1/downloads/apk` and `/api/health` above. No database and no worker. Full reference: [auth-users-split-api.md](auth-users-split-api.md).

- `POST /speech/transcriptions` — `multipart/form-data` field `audio` (≤ 10 MB; webm, mp3, wav, m4a, ogg or mp4) → `{transcript}`; parents only. Nothing is stored or logged. `413 audio_too_large`, `415 unsupported_audio_type`, `502 transcription_unavailable`, `503 transcription_not_configured` (10/min per user).
- `GET /downloads/apk` — `{url, filename, expires_in: 300}` for the newest APK; parents only. `404 apk_not_available`, `503 downloads_not_configured` / `downloads_unavailable` (10/min per user).
- `GET /api/health` — public, `{status, commit, branch, committed_at, tag}` for shared's build (30/min per IP).

