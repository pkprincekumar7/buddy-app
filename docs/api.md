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
- `GET/PATCH /user/goals?child_id=` — parent concern and AI-generated goals plan for a specific child (rate-limited: 60/min GET, 20/min PATCH per user)
- `GET/POST/DELETE /user/completed-growth-areas?child_id=` — log completed growth areas with child activity results; GET supports `limit` (1–200, default 50) and `offset` (default 0); DELETE clears all for the child and returns 204 No Content (rate-limited: 60/min GET+POST, 10/min DELETE per user)

## Children (`/api/v1/children/...`)

- `GET /children?sort=&limit=` — list children (`sort`: `created_date` / `-created_date` / `name` / `-name`, default `-created_date`; `limit`: 1–200, default 50; rate-limited: 60/min per user)
- `POST /children` — create a child profile; max 10 children per user (rate-limited: 20/min per user)
- `GET /children/{child_id}` — get a single child by ID (rate-limited: 60/min per user)
- `PATCH /children/{child_id}` — update a child profile (rate-limited: 30/min per user)
- `DELETE /children/{child_id}` — delete a child profile (returns 204 No Content; rate-limited: 10/min per user)

## LLM (`/api/v1/llm/...`)

- `POST /llm/invoke` — send a prompt to an LLM; optionally pass `response_json_schema` for structured JSON output and `provider` (`"openai"` | `"anthropic"` | `"gemini"`) to pin a specific model. Without `provider`, the server auto-selects the first configured key in priority order: OpenAI → Anthropic → Gemini. Returns 503 if no provider is configured (rate-limited: 30/min per user, plus a Redis-based sliding-window LLM rate limiter).
- `GET /llm/providers` — returns which providers have a key configured and which would be auto-selected (rate-limited: 60/min per user).

## Audio (`/api/v1/audio/...`)

- `POST /audio/transcribe` — transcribe an uploaded audio file (multipart upload) via OpenAI Whisper. Max file size: 10 MB. Requires `OPENAI_API_KEY` (rate-limited: 10/min per user).

## Downloads (`/api/v1/downloads/...`)

- `GET /downloads/apk` — returns a pre-signed S3 URL for the APK download (5-minute validity; rate-limited: 10/min per user).

## Health

- `GET /health` — returns `{"status": "ok"}` (no auth, no rate limit)
- `GET /api/health` — returns `{"status": "ok", "commit": "<git-sha>", "branch": "<branch>", "committed_at": "<iso-timestamp>", "tag": "<tag>|null"}` — git metadata is baked into the image at build time via Docker build args (CI sets real values; local/scan builds return `"unknown"`; no auth, no rate limit)
