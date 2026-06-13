# Getting Started

## Quick start (Docker)

```bash
cp .env.example .env
# Edit `.env`: set JWT_SECRET, at least one LLM key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY),
# and Google IDs if you use Sign in with Google.

docker compose up --build
```

This starts three services: Redis, the FastAPI backend, and the Nginx-served frontend. MongoDB is **not** bundled — set `MONGODB_URI` in `.env` to a local MongoDB instance or an Atlas connection string before starting.

After changing `VITE_GOOGLE_CLIENT_ID` or `VITE_API_URL`, rebuild the frontend image so Vite embeds them (`docker compose build frontend` or `docker compose up --build`).

All supported variables are documented in `.env.example` (JWT lifetimes, CORS, MongoDB, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_API_URL`, `APP_ENV`, cookie settings).

- API: `http://localhost:8000` (e.g. `GET /health`)
- UI: `http://localhost:5173`
- OpenAPI: `http://localhost:8000/docs`

There are no schema migrations — MongoDB collections and indexes are created automatically by the backend on startup.

## Local development (without Docker)

Requires **Python 3.12** and **Node.js 22** (versions used by the Docker images).

- Start a local MongoDB instance (or use Atlas) and set `MONGODB_URI` in `backend/.env` — see `backend/.env.example`.
- Backend:
  ```bash
  cd backend
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET
  uvicorn app.main:app --reload
  ```
- Frontend:
  ```bash
  cd frontend
  cp .env.example .env   # set BACKEND_BUCKET_NAME to your local assets bucket to load activity-game images via Vite proxy
  npm install && npm run dev
  ```

## Connecting to MongoDB

MongoDB is external — the app connects via `MONGODB_URI`. The database name is controlled by `MONGODB_DB_NAME` (code default: `buddy_app`; `.env.example` sets `buddy360-local` for local dev). Use whatever name you set, or leave it at the default.

**Local dev:** start a local mongod and set `MONGODB_URI=mongodb://localhost:27017` in `.env`.

**Atlas:** set `MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority`.

**Connect with mongosh:**

```bash
mongosh "$MONGODB_URI" --eval "use $(grep MONGODB_DB_NAME .env | cut -d= -f2)"
# or explicitly:
mongosh "$MONGODB_URI" --eval "use buddy360-local"
```

GUI tools (MongoDB Compass, Studio 3T) work too — paste the URI directly.

**Collections:**

| Collection | Contents |
|---|---|
| `users` | User accounts (`_id`, `email`, `full_name`, `role`, `location`) |
| `sessions` | Refresh token sessions (`user_id`, `expires_at`, `location`) |
| `email_index` | Global email → user_id lookup (unsharded uniqueness guard) |
| `goals` | Parent concern and AI-generated goals plan |
| `growth_areas` | Completed growth areas with activity results |
| `children` | Children profiles |

**Useful queries (mongosh):**

```js
use buddy360-local   // or whatever MONGODB_DB_NAME is set to

// All registered users
db.users.find({}, { email: 1, full_name: 1, role: 1, location: 1 }).sort({ _id: -1 })

// Active sessions (not yet expired)
db.sessions.find({ expires_at: { $gt: new Date() } }, { user_id: 1, expires_at: 1 })

// Goals for a specific user
db.goals.find({ user_id: "<user_id>" })

// Children for a specific user
db.children.find({ user_id: "<user_id>" }).sort({ created_at: -1 })

// Completed growth areas for a user
db.growth_areas.find({ user_id: "<user_id>" }).sort({ created_at: -1 })
```

## Google Sign-In (optional)

Use the **same** OAuth 2.0 **Web client ID** for both `GOOGLE_CLIENT_ID` (backend verifies the ID token) and `VITE_GOOGLE_CLIENT_ID` (frontend loads the Google button). The value looks like `123456789-xxxx.apps.googleusercontent.com`.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a **project**.
2. Go to **APIs & Services → OAuth consent screen**. Configure the app (type, name, support email). In testing mode, add **Test users** for accounts that will sign in.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
4. Application type: **Web application**.
5. Under **Authorized JavaScript origins**, add the origins where your UI is served, for example:
   - `http://localhost:5173` and `http://127.0.0.1:5173` (default Docker Compose UI port)
   - your production origin when you deploy
6. Create the client and copy the **Client ID** (you do not need the client secret for the ID-token flow used here).
7. In `.env`, set:

   ```env
   GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
   VITE_GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
   ```

8. Rebuild the frontend so `VITE_GOOGLE_CLIENT_ID` is baked into the bundle (`docker compose up --build` or `docker compose build frontend`).

If these are left empty, email/password login still works; the login page hides Google until `VITE_GOOGLE_CLIENT_ID` is set at build time and the backend returns an error if Google is used without `GOOGLE_CLIENT_ID`.
