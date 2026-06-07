# buddy-app — Frontend

React 18 + TypeScript + Vite frontend for the buddy-app platform.

## Prerequisites

- Node.js 22
- npm 10+
- The [FastAPI backend](../backend/README.md) running on port 8000 (required for API calls)

## Setup

```bash
# Install dependencies
npm install

# Copy environment file and fill in your values
cp .env.example .env.local
```

**Environment variables** (see `.env.example` for the full list):

| Variable                | Required | Description                                                                                   |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Yes      | Google OAuth client ID for Sign-In                                                            |
| `VITE_API_URL`          | No       | Backend API base URL — leave empty to use the Vite dev-server proxy (`/api → localhost:8000`) |

> `BACKEND_BUCKET_NAME` is a Docker build arg only — it is never exposed to the client and should **not** go in `.env.local`.

## Development

```bash
npm run dev        # start Vite dev server (http://localhost:5173)
npm run typecheck  # run tsc type-checking (zero errors required)
npm run lint       # run ESLint (zero errors required)
npm run build      # production build → dist/
```

The dev server proxies `/api` requests to `http://localhost:8000` automatically when `VITE_API_URL` is not set. Start the backend first.

## Tech stack

- **React 18** + **TypeScript 5** (strict mode)
- **Vite 6** (build + dev server)
- **Tailwind CSS 3** + **shadcn/ui**
- **TanStack Query 5** (server state)
- **React Hook Form 7** + **Zod 3** (form validation)
- **React Router 6** (client-side routing)
- **ESLint 9** flat config + **Prettier 3**
- **Husky** + **lint-staged** (pre-commit hooks)
