# Backend checklist (FastAPI / MongoDB / Valkey)

1. **Dependency injection style** — dependencies declared as `Annotated[Type, Depends(...)]`
   module-level aliases (e.g. `Ready = Annotated[Runtime, Depends(runtime_ready)]`,
   `SignedIn = Annotated[Caller, Depends(signed_in())]`, in the service's `app/main.py` or
   `app/deps.py`), not `param: Type = Depends(...)`.
2. **Access policy on every route** — routes are registered on a `common.routers.PolicyRouter`
   with an explicit policy (`public()`, `signed_in()`, `require("<permission>")`,
   `require_self_or("<permission>")`); routes ask for a permission, never a role
   (`common/permissions.py`). The service's tests run `assert_every_route_has_a_policy(app)`.
   Internal routes list their callers with `allow_callers(...)`.
3. **No duplicated cross-cutting logic** — token checks, authz, internal calls, the outbox and
   rate limits come from `common/` (`authz.py`, `internal_client.py`, `events/`, `limiter.py`),
   not re-implemented in a service. Code used by one service stays in that service; `common`
   never imports a service and services never import each other (import-linter,
   `tools/import_contracts.py`). A write another service copies publishes its event in the same
   transaction through the outbox (`common.events.add_to_outbox`), never straight to SNS from a
   route; new events start in `common/events/catalogue.json` with a schema in
   `common/events/schemas/`, and handlers are safe to run twice and in any order.
4. **Settings parsed once** — the service's `ServiceSettings` subclass (`app/runtime.py`, based
   on `common/settings_base.py`) is read when the `Runtime` is built (`Runtime.from_env`), never
   per request.
5. **Resource lifecycle** — long-lived clients (Mongo, Valkey, AWS, the internal client, LLM SDK
   clients) live on the `Runtime`, built in `lifespan`, and are closed in its `aclose()`; both
   apps share one `Runtime` per process.
6. **Response models** — every endpoint that returns a body declares `response_model=...` or a
   typed return (`status_code=204` / `response_class=` routes with no JSON body are exempt), so
   the committed `backend/openapi/<service>.json` is accurate. Request models use
   `ConfigDict(extra="forbid")` and bound every string, list and number.
7. **OpenAPI security schemes** — auth-protected routes use FastAPI security utilities
   (`APIKeyCookie`, `HTTPBearer`, via `common/authz.py`) so the requirement is visible in the
   OpenAPI schema.
8. **List/detail response-shape parity** — when a resource is exposed through both a list
   endpoint (often with a field projection) and a get-by-id endpoint, the projection includes
   every field *any* real consumer of the list endpoint relies on, not just the fields its
   original caller needed. Check every place in both apps that calls the list variant and
   confirm every field it reads is actually in the projection — a missing field fails silently,
   with no error anywhere, just quietly-wrong data downstream. (This exact bug once happened in
   the children list: `gender`/`avatar_id`/`avatar_url` were missing from its projection,
   silently blanking the Onboarding page's prefill on one navigation path only.)
9. **Module size / single responsibility** — a service's `app/` modules are split by concern
   (routes in `main.py`, access in `access.py`, storage in `store.py`, generation in
   `generation.py`, …) once a module covers multiple unrelated things.
10. **Test coverage** — flag missing tests on critical paths (auth, limits, deletion,
    data-integrity logic) as a real finding, even knowing it may not be actioned immediately.
    Each service's tests are in `<service>/tests/` with a 99% line + branch gate per service
    (`common` and `tools` run together, gated on `common`); assertions check behaviour (stored
    documents, outbox events, responses, audit events), not just executed lines. Helpers live in
    `<service>/tests/<service>_testkit.py`. `live_service` tests (real Mongo/Valkey) are skipped
    locally but must pass in CI. Tests drive routes via
    `httpx.AsyncClient(transport=httpx.ASGITransport(app=...))` against `main.app` /
    `main.internal_app` with a test `Runtime` attached by `main.configure(...)`, and fake only at
    the external boundary (Moto `mock_aws`, other services' internal APIs, a fake LLM provider),
    not monkeypatched internals (see the Tests section of `backend/CLAUDE.md`).
11. **Consistent error handling** — errors are
    `HTTPException(status_code, detail={"code": "<snake_case>", "msg": "..."})` through the
    service's `error(...)`/`_error(...)` helper; the apps read `detail.code`, so a code is part of
    the contract and isn't renamed casually. Cross-module errors that don't need FastAPI use a
    plain exception class, converted to `HTTPException` only at the route boundary.
12. **Mongo id/index/schema discipline** — no `ObjectId` introduced (string UUIDs only); each
    collection's `$jsonSchema` validator and indexes live in its `ensure_*` function in the
    service's `app/store.py` (`ensure_validated_collection`), not ad hoc; sharded collections
    lead their indexes with `{location: 1, _id: 1}`. A service never reads another service's
    database: it keeps its own event-fed copy or makes an internal call.
13. **Rate-limit correctness** — per-route limits are `common.limiter.RateLimits` dependencies
    (`per_ip(...)` for public routes, `per_user(...)` for signed-in ones) declared in the route's
    own `dependencies=[...]`, so an over-limit request is refused before the route's database
    work. They're counted in Valkey, falling back to per-task counting while Valkey is
    unreachable; flag it only if that fallback is removed. The hourly LLM limit is shared by
    every circle (`common/generation/llm_limit.py`). New Valkey keys follow the scoped,
    colon-separated, purpose-prefixed convention with an explicit TTL.
14. **Blocking-call offload** — every blocking SDK/client call inside `async def` is offloaded via
    `asyncio.to_thread` (bcrypt, boto3, the Gemini SDK), not a new `run_in_executor` variant.
15. **Logging correctness** — module logger (`logging.getLogger(__name__)`), never `print()`.
    `common.serve` and each worker call `common.telemetry.setup_observability`, which sets up JSON
    logs (`common/logging.py`) with `service`, `trace_id`/`span_id` and `request_id`; queryable
    facts go in `extra={...}`. Never log names, emails, prompts or LLM answers.
16. **Mongo query injection safety** — no endpoint merges a raw client `dict[str, Any]` into a
    Mongo filter or operator payload: `$set`/`$unset` payloads come only from a Pydantic model's
    declared fields (`model_dump(exclude_unset=True)`); scoping fields (`user_id`, `location`) are
    set server-side, never taken from the client, and don't change after create.
