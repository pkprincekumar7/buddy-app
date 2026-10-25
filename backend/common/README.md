# common

The protocol layer shared by every backend service. Design: [docs/auth-users-split.md](../../docs/auth-users-split.md), sections 2 and 16; build steps: [docs/auth-users-split-build-plan.md](../../docs/auth-users-split-build-plan.md), Phase 1.

## What belongs here

Only code that **must behave the same in every service**, where separate copies would drift into security holes or broken events:
- token and authz checks, and the permission table;
- the event envelope, outbox, versions, tombstones and topic check;
- the internal-call client and service tokens;
- telemetry, logging and metrics conventions.
- how a service runs: `python -m common.serve <service>` serves `app` on 8000 and `internal_app` on 8001.

Code used by one service lives in that service. Code used by a few is an optional extra: `[generation]` (discover, grow, transform, release) and `[uploads]` (children, transform).

## Rules

- **Versioned:** `__version__` in `__init__.py`, semantic versioning. Each service pins a compatible range in its own requirements.
- **Backward-compatible changes only.** A breaking change is a new function next to the old one, until every service has moved; then a major version bump.
- **No circle rules:** anything about one circle belongs in that circle.
- **Never imports service code:** enforced by import-linter, with contracts generated from the services in the tree (`backend/tools/import_contracts.py`).
- **One owner, full test coverage:** a bug here affects every service.

## Install

```bash
pip install ./common                # the core
pip install './common[generation]'  # with an extra
```

From `backend/`, tests and tools also import it straight from the source tree (`pythonpath = ["."]`).
