# Superpower — Frontend

React 19 + TypeScript + Vite frontend for the Superpower platform.

## Prerequisites

- Node.js 22
- npm 10+
- The local stack running from the repo root, in manual mode (`docker compose up -d --build`: Atlas and a real bucket) or test mode (`docker compose --env-file .env --env-file .env.test up -d --build`: the `mongo` container and Moto), see [docs/getting-started.md](../docs/getting-started.md#manual-and-test-modes): the API is served by the gateway on port 8088

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
| `VITE_API_URL`          | No       | API base URL — leave empty to use the Vite dev-server proxy (`/api → localhost:8088`, the gateway) |

> `ASSETS_BUCKET_NAME` (the local assets bucket, public for `app-assets/*`; see `local/aws-manual`) makes the dev server and the container's nginx proxy `/app-assets/*` to it. It's read by the proxy only (not a `VITE_` variable), so it's never exposed to the client.

## Development

```bash
npm run dev        # start Vite dev server (http://localhost:5173)
npm run typecheck  # run tsc type-checking (zero errors required)
npm run lint       # run ESLint (zero errors required)
npm run build      # production build → dist/
```

The dev server proxies `/api` requests to the gateway on `http://localhost:8088` automatically when `VITE_API_URL` is not set (`API_PROXY_TARGET` points it elsewhere). Start the stack first.

## Tests

Neither kind needs the backend, a database, an account or the LLM, and neither writes anything real. The plan, conventions and pitfalls: [docs/web-ui-test-plan.md](../docs/web-ui-test-plan.md). Every command to run them (watching, slowing down, picking tests, debugging, the mobile app's): [TESTING.md](TESTING.md).

```bash
npm test                    # component and logic tests (Vitest + Testing Library, jsdom): seconds
npm run test:watch          # the same, re-run on every save
npm run test:e2e            # browser tests (Playwright): the real app in Chrome at phone width
npm run test:e2e -- --ui    # the same, in Playwright's UI: watch, step through, rewind
npm run test:e2e:coverage   # with coverage of src/ → coverage/index.html
```

- **Component tests** sit next to their code as `*.test.ts(x)` under `src/`. Use them for what one component shows and does with some data; jsdom has no layout.
- **Browser tests** live in `e2e/`. Playwright starts its own Vite server (port 5288) and answers every `/api/v1` call from `e2e/fixtures.ts`, typed by the generated API clients. A test starts from a scenario (`api.use('childMidway')`; the default is `everythingDone`, see `e2e/data/scenarios.ts`) and changes only what it needs (`api.set('GET /children/{id}/kids', { body })`, `api.fail(...)`). A request with no stub fails the test, naming the route; other hosts are blocked. `e2e/FLOWS.md` lists every flow and its tests.
- The tests use Playwright's own Chromium when it's installed (once, **from `frontend/`** so it matches the project's Playwright: `npx playwright install chromium`), as CI does; without it they fall back to the installed Google Chrome, which stalled with several workers on macOS. On a failure, `test-results/` has a screenshot and a trace (`npx playwright show-trace <trace.zip>`).
- One file or one test: `npm run test:e2e -- e2e/smoke.spec.ts`, `npm run test:e2e -- -g "KID-08"`, `npm test -- -t "Connect"`. Watch it in a window: `--headed --workers=1`. A run you start pauses 800 ms before each step; `SLOWMO=300` sets another pause, `SLOWMO=0` none. CI and `npm run test:e2e:ci` (what `check.yml` and `check.sh` run) never pause. `VIEWPORT=1280x800` (or `VIEWPORT=full` with `--headed`) shows the flow tests at another size than a phone's; some expect the phone layout.

## Tech stack

- **React 18** + **TypeScript 5** (strict mode)
- **Vite 6** (build + dev server)
- **Tailwind CSS 3** + **shadcn/ui**
- **TanStack Query 5** (server state)
- **React Hook Form 7** + **Zod 3** (form validation)
- **React Router 6** (client-side routing)
- **ESLint 9** flat config + **Prettier 3**
- **Husky** + **lint-staged** (pre-commit hooks)
