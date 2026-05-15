# buddy-app — Claude Code Instructions

## Working directory

Always make changes directly in this repository (`/Users/VKum985/Documents/Study/Extra/Application_Code/buddy-app`).
Do **not** use git worktree isolation (`isolation: "worktree"`) — edits must land here, not in a throwaway worktree.

## Project structure

- `frontend/` — React app (Vite, pages auto-routed via `src/pages.config.js`)
- `backend/` — FastAPI app with MongoDB (Motor async driver) + Redis (rate limiting)
- `infra-live-backend/` — Terraform for AWS backend (ECS, ALB, ECR, ElastiCache)
- `infra-live-frontend/` — Terraform for S3 frontend hosting
- `infra-live-edge/` — Terraform for CloudFront + WAF + DNS

## Backend

- **Database**: MongoDB Atlas (Motor async driver, no ORM). No Alembic — indexes are created at startup via `init_indexes()` in `app/database.py`.
- **Collections**: `users`, `sessions`, `email_index`, `onboarding`, `goals`, `recommendations`, `growth_areas`, `children`, `missions`
- **Routers** (`app/routers/`): `auth`, `users`, `children`, `llm`, `audio` — all mounted at `/api/v1`
- **Rate limiting**: `slowapi` + Redis

## Active pages (new onboarding flow)

Registered in `pages.config.js` (entry point: `Onboarding`):
- `Onboarding → LifePathway → GoalsDashboard`
- `Home`

Additional page files exist but are not registered in `pages.config.js`: `Login`, `Register`.
