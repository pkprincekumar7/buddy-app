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
- `POST /user/ninety-day-plan/photo-presign` — presigned S3 PUT URL for an achievement/tracker photo; client uploads directly to S3, then PATCHes `/user/ninety-day-plan` with the returned `photo_url` recorded against `field_key` in the `photos` map (rate-limited: 20/min per user)

## Children (`/api/v1/children/...`)

- `GET /children?sort=&limit=` — list children (`sort`: `created_date` / `-created_date` / `name` / `-name`, default `-created_date`; `limit`: 1–200, default 50; rate-limited: 60/min per user)
- `POST /children` — create a child profile; max 10 children per user (rate-limited: 20/min per user)
- `GET /children/{child_id}` — get a single child by ID (rate-limited: 60/min per user)
- `PATCH /children/{child_id}` — update a child profile (rate-limited: 30/min per user)
- `DELETE /children/{child_id}` — soft-delete a child profile: hidden immediately, retained 30 days for recovery, then purged by a scheduled hard-delete job (returns 204 No Content; rate-limited: 10/min per user)
- `POST /children/{child_id}/progress/{flag}` — mark a Personality Journey progression flag done; one-way (false→true), one flag per call, gated on the previous step in the chain already being true. Valid flags: `onboarding_profile_completed`, `discover_completed`, `transform_visited`, `release_visited`, `connect_visited` (`grow_completed`/`conversational_onboarding_completed` are derived, not settable here) — this is the only way to set these fields; `PATCH /children/{child_id}` silently ignores them (rate-limited: 30/min per user)
- `POST /children/{child_id}/avatar/presign` — presigned S3 PUT URL for a child avatar photo; client uploads directly to S3, then PATCHes the child with the returned `avatar_url` (rate-limited: 20/min per user)

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
