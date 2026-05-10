# buddy-app — Claude Code Instructions

## Working directory

Always make changes directly in this repository (`/Users/VKum985/Documents/Study/Extra/Application_Code/buddy-app`).
Do **not** use git worktree isolation (`isolation: "worktree"`) — edits must land here, not in a throwaway worktree.

## Project structure

- `frontend/` — React app (Vite, pages auto-routed via `src/pages.config.js`)
- `backend/` — FastAPI app with SQLAlchemy ORM
- `backend/alembic/` — database migrations (run `alembic upgrade head` before startup)

## Active pages (new onboarding flow)

`Onboarding → LifePathway → GoalsDashboard` plus `Home`, `Login`, `Register`.
