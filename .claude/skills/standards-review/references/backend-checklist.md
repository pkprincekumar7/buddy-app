# Backend checklist (FastAPI / MongoDB / Redis)

1. **Dependency injection style** — dependencies declared as `Annotated[Type, Depends(...)]`
   (via the module-level aliases in `app/deps.py`), not `param: Type = Depends(...)`.
2. **Router-level shared deps** — if every route in a router needs the same dependency (most
   commonly auth), it's declared once via `APIRouter(dependencies=[...])`, not repeated per
   endpoint.
3. **No duplicated cross-cutting logic** — token extraction, validation, etc. factored into one
   shared helper/dependency, not copy-pasted across endpoints.
4. **Cached settings** — `Settings` loaded via an `@lru_cache`-wrapped `get_settings()`, never
   re-instantiated per request.
5. **Resource lifecycle** — long-lived clients (LLM SDK clients, DB pools) created at startup are
   closed in the `lifespan` shutdown phase.
6. **Response models** — every endpoint declares `response_model=...`.
7. **OpenAPI security schemes** — auth-protected routes use FastAPI security utilities
   (`APIKeyCookie`, `HTTPBearer`, etc.) so the requirement is visible in the OpenAPI schema.
8. **List/detail response-shape parity** — when a resource is exposed through both a list
   endpoint (often with a field projection) and a get-by-id endpoint, the projection includes
   every field *any* real consumer of the list endpoint relies on, not just the fields its
   original caller needed. Check every place in the frontend that calls the list variant and
   confirm every field it reads is actually in the projection — a missing field fails silently,
   with no error anywhere, just quietly-wrong data downstream. (This exact bug happened in
   `app/routers/children.py`'s `_LIST_PROJECTION` — `gender`/`avatar_id`/`avatar_url` were
   missing, silently blanking the Onboarding page's prefill on one navigation path only.)
9. **Module size / single responsibility** — router/module files split by concern once they
   cover multiple unrelated things.
10. **Test coverage** — flag missing tests on critical paths (auth, limits, data-integrity
    logic) as a real finding, even knowing it may not be actioned immediately. `pytest`/
    `pytest-asyncio`/`httpx` are installed (`requirements-test.txt`) but zero test files exist
    yet — when tests are added, they should drive routes via `httpx.AsyncClient`/`TestClient` and
    override dependencies with `app.dependency_overrides[...]`, not monkeypatch internals.
11. **Consistent error handling** — no parallel error-formatting path bypassing the global
    handler in `main.py`; cross-module errors that don't need FastAPI use a plain exception class
    (like `LLMConfigError`), converted to `HTTPException` only at the router boundary; the
    3-layer catch pattern (`llm.py`/`jobs.py`/`audio.py`) isn't copy-pasted into a 4th router
    without factoring it out.
12. **Mongo id/index/schema discipline** — no `ObjectId`/`PyObjectId` introduced (string UUIDs
    only — `grep -rn "ObjectId" app/` should stay empty); new indexes added to `init_indexes()` in
    `database.py`, not ad hoc; new raw-dict Mongo writes go through a Pydantic model or get a
    defensive read-side check.
13. **Rate-limit correctness** — flag any new `@limiter`/`@user_limiter` usage relied on as a real
    cross-pod limit (it isn't — `grep -n "storage_uri" app/limiter.py` is currently empty, so
    these are in-memory/per-process only); genuine multi-instance quotas use a Redis-backed check
    like `llm_rate_limiter.py`; new Redis keys follow the `purpose:id` naming convention with an
    explicit TTL.
14. **Blocking-call offload** — every blocking SDK/client call inside `async def` is offloaded via
    `asyncio.to_thread` (not a new `run_in_executor` variant).
15. **Logging correctness** — module logger used, never `print()`; any new log line relied on for
    prod debugging is checked against the fact that `main.py` has no `logging.basicConfig`/
    `dictConfig` (unlike `worker.py`); prefer structured (JSON) log output over more plain-text
    lines given the ECS/CloudWatch deployment target; request-id correlation isn't currently
    bound into logs (`X-Request-Id` is response-header only).
16. **Mongo query injection safety** — no endpoint merges a raw client `dict[str, Any]` into a
    Mongo filter/update without the allow-list + `$`-key-rejection + depth/key-cap pattern from
    `WriteBackConfig` (`app/schemas/jobs.py`); scoping fields (`user_id`, `location`) are
    server-overwritten post-merge.
