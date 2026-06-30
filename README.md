# Buddy360

A child development app for parents. Stack: **React 18 (Vite)**, **FastAPI**, **MongoDB** (Motor async driver), optional LLM providers (**OpenAI**, **Anthropic**, **Gemini**) and **OpenAI Whisper** for audio transcription. Run everything with **Docker Compose** or the backend/frontend dev servers.

Frontend UI library: **Tailwind CSS v3** + **shadcn/ui** (Radix UI primitives), **React Query**, **Framer Motion v11**, **React Router v6**, **Recharts**, **Stripe**, **Three.js**, **React Leaflet**, **jsPDF** + **html2canvas**, **@hello-pangea/dnd**, **next-themes**, **Sonner**.

## Documentation

| Topic | File |
|---|---|
| Quick start, local dev, MongoDB, Google Sign-In | [docs/getting-started.md](docs/getting-started.md) |
| S3 static assets — setup, upload, local dev config | [docs/static-assets.md](docs/static-assets.md) |
| Pre-commit hooks, check.sh, ruff/mypy config | [docs/code-quality.md](docs/code-quality.md) |
| API routes reference | [docs/api.md](docs/api.md) |
| Frontend pages and routing | [docs/frontend.md](docs/frontend.md) |
| GitHub Actions workflows, AWS OIDC, secrets | [docs/ci-cd.md](docs/ci-cd.md) |
| Running tests and coverage | [docs/tests.md](docs/tests.md) |
| Infrastructure architecture, AWS cost estimates | [docs/infra-architecture-v1.md](docs/infra-architecture-v1.md) |
| Per-service AWS cost breakdown and hourly rates | [docs/aws-cost-estimate.md](docs/aws-cost-estimate.md) |
| AWS resource inventory (all Terraform-managed resources) | [docs/aws-resources.md](docs/aws-resources.md) |

## Product notes

- **LLM providers**: do not commit keys. Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Auto-selection priority: OpenAI → Anthropic → Gemini. Model defaults: `gpt-5.4-mini`, `claude-sonnet-4-6`, `gemini-3-flash` (override via `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`). Without any key, `POST /llm/invoke` returns `503`. Audio transcription still requires `OPENAI_API_KEY` (OpenAI Whisper).
- **Rate limiting**: `POST /auth/register` and Google auth are capped at 5 requests/minute per IP; login at 10/minute. LLM calls are also rate-limited per-user (sliding window, default 200 calls/hour) via Redis — set `REDIS_URL` to a Redis instance; without it the rate limiter falls back to an in-process counter that breaks under multiple containers.
- **Session management**: the access token has a 30-minute lifetime; the refresh token lasts 24 hours. `AuthContext` schedules a proactive silent refresh 60 seconds before the access token would expire. If the silent refresh returns 401 (refresh token expired or revoked), the app dispatches a `buddy360:auth-expired` custom event and the user is logged out. Network hiccups retry after 30 seconds.
