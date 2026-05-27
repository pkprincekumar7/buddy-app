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
