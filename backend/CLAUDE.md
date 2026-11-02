# backend — Coding Standards

FastAPI services on MongoDB (PyMongo's async client) and Valkey, talking through events (SNS +
SQS, Moto locally) and signed internal calls. These are the standards to follow when writing or
editing code in this directory; see `.claude/skills/standards-review/SKILL.md` for the
on-demand audit that checks a file against this same list. The design behind them is
`docs/auth-users-split.md` (section numbers below refer to it).

## Layout

- One package per service: `auth`, `users`, `children`, `onboarding`, `discover`, `grow`,
  `transform`, `release`, `shared` (`connect` is planned, not built). `tools/services.py` finds
  them from the tree (`--json`, `--paths PREFIX`, `--check`), so CI, `check.sh` and the import
  contracts keep no list: a new service is picked up by adding its directory.
- Each service is `backend/<svc>/` with:
  - `app/main.py` — two ASGI apps: `app` (public routes, behind the ALB) and `internal_app`
    (`/internal/*`, reached only through Cloud Map). `python -m common.serve <svc>` serves them
    on 8000 and 8001 in one process (13.2), so an internal route can't be reached on the public
    port;
  - `app/runtime.py` — the service's settings (a `common.settings_base.ServiceSettings`
    subclass) and a `Runtime` dataclass holding its clients (Mongo, Valkey, AWS, the internal
    client, the authorizer, rate limits);
  - `app/store.py` — its collections: names, `$jsonSchema` validators, indexes, and the
    `ensure_*` functions that create them;
  - `worker.py` — `python -m <svc>.worker`: the outbox relay, the event consumer and any
    periodic jobs (every service but `shared`);
  - `requirements.txt` — its own pins, with exactly one `buddy-common[extras]==X.Y.Z` line;
  - `tests/`.
- `common/` is the shared package (`buddy-common`), installed into each image as a wheel built
  from this tree (`backend/Dockerfile`, `scripts/install-backend-service.sh`), never from PyPI.
  See `common/README.md` for what belongs there.
- `backend/Dockerfile` builds every service's image: `--build-arg SERVICE=<svc>` is required. A
  worker runs its service's image.
- `backend/openapi/<svc>.json` is each HTTP service's committed spec
  (`python tools/export-openapi.py --service <svc> > openapi/<svc>.json`); CI fails when it's
  stale, and the apps' TypeScript clients are generated from it
  (`node scripts/sync-api-clients.mjs`).
- The dev venv (`requirements-dev.txt`, the union of every service's pins, plus
  `requirements-test.txt`/`-lint.txt`/`-security.txt`) is for tests and tools; the services run
  in Docker Compose locally (`docs/getting-started.md`).

## Boundaries

- **`common` never imports a service; services never import each other.** Enforced by
  import-linter, with contracts generated from the tree (`python tools/import_contracts.py`).
  Anything one service needs from another goes through an event or an internal call.
- **`common` holds only code that must behave the same in every service** (token and authz
  checks, the permission table, the event envelope and outbox, internal calls, telemetry,
  logging). Code used by one service lives in that service; code used by a few is an extra
  (`[generation]`, `[uploads]`).
- **`common` changes are backward-compatible.** `__version__` in `common/__init__.py` follows
  semantic versioning and each service pins the version it was built against. A breaking change
  is a new function next to the old one until every service has moved.
- **Each service owns its own database** (named after it; `shared` has none). Never read
  another service's collections: a service keeps its own copy of what it needs (`child_access`
  and the `*_inputs` collections in `common/models.py`), fed by events, or asks the owner through
  an internal call.

## Dependency injection & settings

- Declare dependencies with `Annotated[Type, Depends(...)]` module-level aliases (e.g.
  `Ready = Annotated[Runtime, Depends(runtime_ready)]`,
  `SignedIn = Annotated[Caller, Depends(signed_in())]`), not the default-argument style.
- Settings come from the environment through the service's `ServiceSettings` subclass, parsed
  once when the `Runtime` is built (`Runtime.from_env`), never per request.
- In stg and prod, unsafe settings stop the service at startup (`UnsafeSettingsError`). A
  setting that mustn't reach real users gets a check in the subclass's `unsafe_settings`
  (extend `super().unsafe_settings()`), not a warning.
- The `Runtime` is built in `lifespan` only when `MONGODB_URI` is set; without it the service
  serves `/health` and every other route answers 503, so the image still starts unconfigured.
  Both apps share one `Runtime` per process and the last one to stop closes it (`aclose`): any
  long-lived client you add must be closed there.

## Access policy (deny by default, 11.2)

- Routes are registered on a `common.routers.PolicyRouter`, which refuses at import time a
  route without an access policy: `public()`, `signed_in()`, `require("<permission>")` or
  `require_self_or("<permission>")`. Each service's tests also run
  `assert_every_route_has_a_policy(app)`, which catches routes added straight onto the app.
- Routes never name a role: they ask for a permission, and `common/permissions.py` says which
  roles hold it. A privileged access or a denial is written to the audit trail by the
  permission check (`common/audit.py`); only field names are recorded, never values.
- Internal routes accept only the callers they list with `allow_callers(...)`, verified from
  the caller's service token (`common/internal_client.py`).
- A parent's queries filter by their own `{location, user_id}`, so someone else's data is
  simply not found (404, not 403).

## API contracts & errors

- Every endpoint declares its response model (`response_model=...` or a typed return) so the
  response is filtered and the committed spec is accurate.
- Errors are `HTTPException(status_code, detail={"code": "<snake_case>", "msg": "..."})`,
  through the service's `error(...)`/`_error(...)` helper. The apps read `detail.code`
  (`ApiError.code`), so a code is part of the contract: don't rename one casually.
- Request models reject unknown fields (`ConfigDict(extra="forbid")`) and bound every string,
  list and number (`Field(max_length=..., ge=..., le=...)`).
- Request bodies are capped before the app reads them (`common/body_limit.py`, 1 MiB unless the
  service's `app.main` sets `MAX_BODY_BYTES`).
- A 422 never repeats what was sent: `common.serve` replaces FastAPI's validation handler with
  `common/validation.py`, which keeps each error's `type`, `loc` and `msg` and drops `input`
  and `ctx` (passwords and children's details would otherwise come back in the body).
- **When the same resource is exposed through more than one endpoint (e.g. a list with a
  projection alongside a get-by-id), the projection must include every field any consumer of
  the list relies on** — a field missing from a projection fails with no error anywhere, just
  quietly blank data downstream.

## Events (section 7)

- Every write another service copies publishes its event **in the same transaction**, through
  the outbox (`common.events.add_to_outbox`); the worker's relay publishes it to the service's
  own SNS topic. Never publish straight to SNS from a route.
- Who produces and consumes each event is `common/events/catalogue.json`; each payload has a
  schema in `common/events/schemas/<event>.vN.json`. A new event or subscriber starts there;
  `scripts/local-aws-setup.py` and the topology (`common/events/topology.py`) follow from it.
- Every handler must be safe to run twice and in any order (7.4): use the version-checked
  upsert or a one-way flag (`common/events/store.py`), or `dedupe=True` (the inbox) when it
  can't be. Check tombstones so a late event can't recreate a deleted child or user.
- A service that holds user data takes part in account deletion (`common/deletion.py`): it
  deletes on `user.deletion_requested`, writes a `user:` tombstone and confirms with
  `user.data_deleted`.

## MongoDB & indexes

- Documents use plain string `_id`s from `str(uuid.uuid4())`. Never introduce an `ObjectId`.
- Each collection is created by an `ensure_*` function in `app/store.py` (shared shapes in
  `common/models.py` and `common/events/store.py`), called from `Runtime.prepare()` on startup:
  its `$jsonSchema` validator (`ensure_validated_collection`) and all its indexes live there, not
  ad hoc in a route. Comment *why* an index is shaped the way it is.
- `prepare()` passes those functions to `common.index_builds.prepare_database`. It creates the
  collections and validators at once, and builds the indexes in the background, once per release
  (`GIT_SHA`; DB-03). Locally and in tests there's no release, so they're built at once.
  Create indexes only with `create_index` on a collection the `ensure_*` function was given
  (that's what is recorded), never in a route or with `create_indexes` directly.
- Sharded collections carry `location` and lead their indexes with the zone-sharding key
  `{location: 1, _id: 1}`; `tools/atlas_zone_ranges.py` prints the zone commands per service
  database. Scoping fields (`user_id`, `location`) are set server-side, never taken from the
  client, and don't change after create.
- Build `$set`/`$unset` payloads only from a Pydantic model's own declared fields
  (`model_dump(exclude_unset=True)`); never merge a client dict into a Mongo operator payload or
  filter.

## Rate limits (Valkey)

- Per-route limits are dependencies built on `common.limiter.RateLimits` (`per_ip(...)` for
  public routes, `per_user(...)` for signed-in ones), declared in the route's
  `dependencies=[...]` so an over-limit request is refused before the route's own database
  work. Buckets are per route template, method and identity.
- While Valkey is unreachable (or `REDIS_URL` is unset) the limits are counted per task and
  Valkey is retried after 30 s; the authz check falls back to asking auth, with a short local
  cache, and fails closed (503) if auth can't answer either.
- The per-user hourly LLM limit is shared by every circle (`common/generation/llm_limit.py`).
- New Valkey keys follow the existing convention — scoped, colon-separated, prefixed by
  purpose — with an explicit TTL.

## Async correctness

- Every blocking call inside `async def` is offloaded with `asyncio.to_thread(...)`: bcrypt
  (`auth/app/tokens.py`), boto3 calls (`common/uploads.py`, `common/events/`,
  `common/metrics.py`), the Gemini SDK (`common/generation/llm.py`). Keep that one idiom for any
  new blocking SDK call.

## Logging & observability

- Log via `logging.getLogger(__name__)`, never `print()`. `common.serve` and each worker call
  `common.telemetry.setup_observability`, which sets up JSON logs (`common/logging.py`) with
  `service`, `trace_id`/`span_id` and `request_id` on every line, and OpenTelemetry tracing.
- Log ids, never people: personal keys in `extra={...}` are dropped and emails in messages are
  masked, but don't rely on that — never log names, emails, prompts or LLM answers.
- Put queryable facts in `extra={...}` fields rather than in the message text.

## Tests

- Each service's tests are in `<svc>/tests/` and run on their own:
  `pytest <svc>/tests --cov=<svc> --cov-branch --cov-fail-under=99`; `common` and `tools` run
  together with a 99% gate on `common`. Keep coverage there, with assertions on behaviour
  (stored documents, events in the outbox, responses, audit events), not just executed lines.
  Flag missing coverage on critical paths (auth, limits, deletion, data integrity) as a finding.
- Test helpers live in `<svc>/tests/<svc>_testkit.py` (exposed by `conftest.py`) and test modules
  are named after the service or its parts, so modules from different services never clash in
  one run.
- Drive routes through `httpx.AsyncClient(transport=httpx.ASGITransport(app=...))` against
  `main.app` and `main.internal_app`, with a test `Runtime` attached by `main.configure(...)`,
  rather than calling route functions directly. Fake only at the external boundary: Moto's
  `mock_aws` for AWS, keys generated per run for tokens, fakes of other services' internal APIs,
  a fake LLM provider.
- Tests needing real MongoDB/Valkey are marked `@pytest.mark.live_service` and run against
  `MONGODB_TEST_URI` (never `MONGODB_URI`) and `REDIS_URL`; they skip without them, and
  `REQUIRE_LIVE_SERVICES=1` (CI) turns a skip into a failure. Never point `MONGODB_TEST_URI` at
  a real cluster: tests create and drop throwaway databases.
- Don't `importlib.reload` a module that defines an exception class other code catches: it mints
  a new class and breaks every `except` elsewhere.
