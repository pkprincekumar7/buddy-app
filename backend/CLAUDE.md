# backend — Coding Standards

FastAPI + MongoDB (Motor) + Redis backend. These are the standards to follow when writing or
editing code in this directory. They were distilled from an explicit best-practices review of
this codebase; see `.claude/skills/standards-review/SKILL.md` for the on-demand audit that
checks a file against this same list.

## Dependency injection

- Declare dependencies with `Annotated[Type, Depends(...)]` (module-level type aliases in
  `app/deps.py`, e.g. `CurrentParent`, `Db`, `SettingsDep`), not the classic
  `param: Type = Depends(...)` default-argument style.
- When every route in a router needs the same dependency (most commonly auth), declare it once
  at the router level — `APIRouter(dependencies=[Depends(get_current_parent)])` — instead of
  repeating it on every endpoint's own dependency list.
- Don't duplicate cross-cutting logic (e.g. extracting/validating a token) across multiple
  endpoints or dependencies — factor it into one shared helper or dependency and reuse it.

## Settings & resource lifecycle

- Load `Settings` through a cached dependency (`@lru_cache`-wrapped `get_settings()`), never
  re-instantiated or re-parsed per request.
- Any long-lived client created at startup (LLM provider SDK clients, DB pools, etc.) must be
  closed in the `lifespan` shutdown phase — don't let connections leak past process exit.

## API contracts

- Every endpoint should declare `response_model=...` so FastAPI validates/filters the response
  shape and the generated OpenAPI docs are accurate.
- Auth-protected routes should use FastAPI's security utilities (`APIKeyCookie`, `HTTPBearer`,
  etc.) so the requirement is visible in the OpenAPI schema, not only enforced by a dependency
  that Swagger/OpenAPI can't see.
- **When the same resource is exposed through more than one endpoint (e.g. a list endpoint with
  a field projection alongside a get-by-id endpoint returning the full document), the projection
  must include every field *any* consumer of the list endpoint actually relies on** — not just
  the fields its original caller needed. A frontend page reusing the list endpoint as a
  lightweight stand-in for a full fetch is a real, recurring pattern here (see
  `app/routers/children.py`'s `_LIST_PROJECTION` and its comment) — a field silently missing
  from the projection fails with no error anywhere, just quietly-blank data downstream.

## Structure

- Once a router/module file grows large and starts covering multiple unrelated concerns, split
  it by concern into separate files (mirrors the `auth.py` / `admin.py` split already done here).

## Tests

- Flag missing test coverage on critical paths (auth, payment/limits, data-integrity logic) as a
  real finding even when it isn't actioned immediately — don't silently skip mentioning it.
- `pytest`, `pytest-asyncio`, and `httpx` are already declared in `requirements-test.txt`, but no
  test file exists anywhere in `backend/` yet — the tooling is installed and unused, the same gap
  as the frontend's test setup. When adding tests, drive routes through `httpx.AsyncClient` (or
  FastAPI's `TestClient`) against the app instance rather than calling router functions directly,
  and override dependencies with `app.dependency_overrides[...]` (e.g. swap `Db`/`CurrentParent`
  for a fake) instead of monkeypatching internals — this is the idiomatic FastAPI testing pattern
  and plays correctly with the `Annotated[Type, Depends(...)]` style already used throughout
  `app/deps.py`.

## Error handling

- A global exception handler stack already exists in `app/main.py`: `RequestValidationError` →
  422 `{"detail": exc.errors()}`, `HTTPException` → default Starlette handling, catch-all
  `Exception` → logged via `log.exception` and a generic 500 `{"detail": "Internal server error"}`.
  Every endpoint gets this consistent response shape for free — don't build a parallel
  error-formatting path in a router.
- Prefer a dedicated exception class over threading error state through return values when the
  error needs to cross a module boundary that doesn't import FastAPI — e.g. `LLMConfigError` in
  `app/services/llm_service.py` is deliberately *not* an `HTTPException` subclass so `worker.py`
  can catch it too without an HTTP dependency. Convert to `HTTPException` only at the router
  boundary.
- The three-layer catch pattern in `app/routers/llm.py` (catch the specific domain error → catch
  known transient errors like `json.JSONDecodeError`/`ValueError` → re-raise `HTTPException`
  unchanged → broad `except Exception` fallback to a generic 502) is duplicated near-verbatim in
  `jobs.py` and `audio.py`. If a fourth router needs the same shape, factor it into a shared
  decorator/helper instead of copy-pasting again.

## MongoDB & indexes

- Documents use plain string `_id`s generated with `str(uuid.uuid4())` at the application layer
  (see `app/routers/auth.py`, `children.py`, `jobs.py`, `users.py`). Never introduce a
  `PyObjectId`/`ObjectId`-based id type — there is no `ObjectId` usage anywhere in this codebase
  and it should stay that way for consistency.
- All index creation lives in `init_indexes()` in `app/database.py`, called once from `lifespan`.
  Add new indexes there, not ad hoc in a router or migration script, so the full set stays
  discoverable in one place. Follow the existing precedent of commenting *why* an index is shaped
  the way it is (e.g. the `location`-leading compound index needed for Atlas Global Cluster
  sharding, or a TTL index scoped with `partialFilterExpression` to terminal-state jobs only).
- There is no MongoDB-side schema validation (`$jsonSchema`) — Pydantic models are the only schema
  check, and only at the API boundary. Code that writes raw dicts directly (e.g. `worker.py`)
  bypasses that check entirely. If you add a new raw-dict write path, either validate it through a
  Pydantic model before writing or add a defensive read-side check like the
  `try/except (ValidationError, KeyError, TypeError)` pattern in `app/routers/users.py`.

## Rate limiting (Redis)

- The per-route `slowapi` limiters (`limiter`/`user_limiter` in `app/limiter.py`) have no
  `storage_uri` configured, so they fall back to slowapi's default in-memory store — these limits
  are per-process only and are **not** shared across replicas/pods. Don't assume
  `@user_limiter.limit(...)` enforces a real global rate limit in a multi-instance deployment; for
  anything that must hold correctly across pods (quotas, abuse limits with real consequences), use
  a Redis-backed check like `app/llm_rate_limiter.py`'s sliding-window Lua script instead.
- When adding a new Redis-backed rate limit or lock, follow the existing key-naming convention
  (`f"llm_rate:{user_id}"`, `"session_cleanup:lock"`) — scoped, colon-separated, prefixed by
  purpose — and set a TTL matching the window/lock lifetime explicitly rather than relying on
  default persistence.

## Async correctness

- Any blocking call inside an `async def` route/dependency must be offloaded — this codebase
  already does it consistently for bcrypt (`app/auth_utils.py`), the Gemini SDK's sync
  `generate_content` call (`app/services/llm_service.py`), boto3 S3 calls (`downloads.py`,
  `children.py`), CloudWatch (`worker.py`), and sync `redis-py` calls in the session-cleanup task
  (`app/main.py`). Keep following this pattern for any new blocking SDK/client call.
- Standardize on `asyncio.to_thread(...)` for these offloads. `run_in_executor(None, ...)` is used
  in a couple of places (`children.py`, `main.py`) for the identical purpose — functionally
  equivalent, but pick one idiom going forward rather than adding a third variant.

## Logging & observability

- Every module logs via `log = logging.getLogger(__name__)` — never `print()`. Keep using this
  pattern for new modules.
- `app/main.py` never calls `logging.basicConfig`/`dictConfig`, unlike `worker.py` which does.
  Since the API is started via plain `uvicorn app.main:app` with no `--log-config`, `log.info`/
  `log.debug` calls in the API server may be silently dropped in production depending on uvicorn's
  root-logger interaction. If you rely on a new log line for debugging or ops, verify it actually
  emits under the real startup command — don't assume parity with `worker.py`'s logging.
- The `X-Request-Id` header (generated/validated in `app/main.py`) is echoed back in responses but
  never bound into the logging context — no log line currently contains it. Don't assume request
  IDs are searchable in logs; if you need log-to-request correlation, bind the id via
  `contextvars`/a logging filter (e.g. `asgi-correlation-id`) rather than relying on the existing
  header alone.
- Log lines are currently plain text, not structured. Since the backend runs on ECS/CloudWatch
  (see root `CLAUDE.md`'s infra layout), prefer structured (JSON) log output — e.g. via
  `structlog` or a `logging.Formatter` emitting JSON — over adding more plain-text `log.info(...)`
  calls, so fields (request id, user id, status code) are queryable in CloudWatch Logs Insights
  instead of needing regex extraction from a text blob.

## Input validation / Mongo query safety

- Never build a Mongo update/filter dict from a raw client-supplied `dict[str, Any]` without
  validation. The one place this pattern is genuinely needed — `WriteBackConfig.filter` in
  `app/schemas/jobs.py` — has a recursive validator rejecting any `$`-prefixed key, plus caps on
  key count and nesting depth (`_FILTER_MAX_KEYS`, `_FILTER_MAX_DEPTH`), a writable-collection
  allow-list, a field-name allow-list per job type, and a safe dot-path regex for field names. Use
  this as the template for any future endpoint that lets a client influence a Mongo query shape
  rather than a fixed field value.
- For fixed-shape updates, keep building `$set`/`$unset` payloads only from a Pydantic model's own
  declared fields (`patch.model_dump(exclude_unset=True)` as in `app/routers/children.py`) — never
  merge a client dict directly into a Mongo operator payload.
- Server-controlled fields that scope a write (e.g. `user_id`, `location`) should be overwritten
  server-side after merging client input, and re-validated at the point of execution if that
  execution happens in a different process (see `app/routers/jobs.py` setting them post-merge, and
  `worker.py` re-checking their presence before the actual update) — don't trust a single
  validation layer for the highest-risk input surface.
