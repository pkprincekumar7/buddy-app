# Global Routing — Operational Setup

This document covers the two infrastructure gaps that must be addressed before a multi-region production deployment of buddy-app.

---

## Gap 2 — Database Migrations at Container Startup (entrypoint.sh)

### Why this is needed

The app reads `DATABASE_URL` (regional DB) and `ROUTER_DB_URL` (global router DB) from environment variables at runtime. SQLAlchemy picks them up automatically. The gap is Alembic: `alembic upgrade head` only migrates one database per invocation, and by default it uses `DATABASE_URL`. The router DB needs its own migration run before the server starts.

### Environment variable injection

In ECS / Kubernetes, secrets are injected as environment variables before the container process starts:

**ECS task definition (excerpt):**
```json
"environment": [
  { "name": "DATABASE_URL",  "value": "postgresql+psycopg://user:pass@eu-cluster.rds.amazonaws.com/buddy" },
  { "name": "ROUTER_DB_URL", "value": "postgresql+psycopg://user:pass@global-router.rds.amazonaws.com/buddy_router" },
  { "name": "REGIONAL_DB_URLS", "value": "{\"eu\":\"postgresql+psycopg://...\",\"us\":\"postgresql+psycopg://...\"}" },
  { "name": "JWT_SECRET",    "value": "..." }
],
"secrets": [
  { "name": "DATABASE_URL",  "valueFrom": "arn:aws:secretsmanager:eu-west-1:123:secret:buddy/eu/db-url" },
  { "name": "ROUTER_DB_URL", "valueFrom": "arn:aws:secretsmanager:eu-west-1:123:secret:buddy/router-db-url" }
]
```

**Kubernetes (excerpt):**
```yaml
envFrom:
  - secretRef:
      name: buddy-app-secrets
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: buddy-regional-db
        key: url
  - name: ROUTER_DB_URL
    valueFrom:
      secretKeyRef:
        name: buddy-router-db
        key: url
```

When the container starts, both variables are already present in the process environment. The app's pydantic-settings model (`Settings`) reads them with zero extra configuration.

### Implemented approach — Dockerfile CMD

The current `backend/Dockerfile` uses an inline `CMD` rather than a separate
`entrypoint.sh` script. The CMD already contains all required migration guards:

```dockerfile
CMD ["sh", "-c", \
  "([ -n \"$REGIONAL_DB_SKIP_MIGRATION\" ] || alembic upgrade head) && \
   ([ -z \"$ROUTER_DB_URL\" ] || [ -n \"$ROUTER_DB_URL_SKIP_MIGRATION\" ] || alembic -x db=router upgrade head) && \
   uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

Set `REGIONAL_DB_SKIP_MIGRATION=true` and `ROUTER_DB_URL_SKIP_MIGRATION=true` in
secondary-region ECS task definitions to prevent Alembic from attempting DDL
writes against read-only Aurora Global Database replicas.

### Alternative: entrypoint.sh

If you prefer a separate script (e.g. for readability or to add pre-flight checks),
create `backend/entrypoint.sh` (make it executable: `chmod +x entrypoint.sh`) and
update the Dockerfile to use it:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Step 1 — regional DB migration (skip on Aurora secondary replicas)
if [ -z "${REGIONAL_DB_SKIP_MIGRATION:-}" ]; then
  echo "[entrypoint] Running regional DB migrations (DATABASE_URL)..."
  alembic upgrade head
else
  echo "[entrypoint] Skipping regional DB migrations (REGIONAL_DB_SKIP_MIGRATION set)."
fi

# Step 2 — router DB migration (skip when no dedicated router DB, or on secondary replicas)
if [ -n "${ROUTER_DB_URL:-}" ] && [ -z "${ROUTER_DB_URL_SKIP_MIGRATION:-}" ]; then
  echo "[entrypoint] Running router DB migrations (ROUTER_DB_URL)..."
  DATABASE_URL="$ROUTER_DB_URL" alembic upgrade head
fi

echo "[entrypoint] Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Key points:
- `set -euo pipefail` — the container exits non-zero if any migration fails, triggering an ECS / K8s restart rather than starting a server against a broken schema.
- `REGIONAL_DB_SKIP_MIGRATION` blocks the regional migration on Aurora secondary replicas (read-only — DDL writes would crash-loop the container).
- `ROUTER_DB_URL_SKIP_MIGRATION` blocks the router migration on secondary replicas for the same reason.
- The router migration is also skipped when `ROUTER_DB_URL` is not set, so local dev (`docker compose up`) works with no changes.
- `exec` replaces the shell process with uvicorn so signals (SIGTERM) are forwarded correctly.

**Dockerfile change (if using the script approach):**

```dockerfile
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
WORKDIR /app/backend
ENTRYPOINT ["/app/entrypoint.sh"]
```

### Full startup flow

```
ECS/K8s injects env vars (DATABASE_URL, ROUTER_DB_URL, skip flags, etc.)
        ↓
Container starts → CMD (or entrypoint.sh) runs
        ↓
[ -z "$REGIONAL_DB_SKIP_MIGRATION" ]?
  YES → alembic upgrade head      # migrates regional DB (users, refresh_tokens, …)
  NO  → skip (Aurora secondary replica — read-only)
        ↓
[ -n "$ROUTER_DB_URL" ] && [ -z "$ROUTER_DB_URL_SKIP_MIGRATION" ]?
  YES → DATABASE_URL=$ROUTER_DB_URL alembic upgrade head   # migrates router DB
  NO  → skip (no dedicated router DB, or Aurora secondary)
        ↓
uvicorn app.main:app starts    # all applicable DBs are schema-current; app is ready
```

### Local development

No changes needed. `docker-compose.yml` already sets `DATABASE_URL` to the local Postgres instance. `ROUTER_DB_URL` is absent, so the second migration step is skipped and the app falls through to single-instance mode.

---

## Gap 3 — Global Content DB with PostgreSQL Logical Replication

### What belongs in the Content DB

The Content DB holds catalogue data that:
- Has no personal data / residency constraints (it can live anywhere)
- Is written by admins or automated pipelines, rarely or never by end-users
- Must be available with sub-millisecond latency to every regional cluster

Tables in scope (current schema):

| Table | Reason |
|---|---|
| `growth_area_definitions` | Static catalogue — pillars, descriptions |
| `mission_templates` | Template library per growth area |
| `personality_catalogue` | Personality type definitions |

Tables **not** in scope (stay in each regional DB):

| Table | Reason |
|---|---|
| `users` | PII / residency |
| `children` | PII / residency |
| `growth_missions` | User-generated, linked to `users` |
| `user_recommendations_progress` | User-generated |
| `refresh_tokens` | Session data, per-user |
| `user_regions` | Router DB only |

### Architecture

```
Content DB (single, e.g. eu-west-1)
  └── Publication: buddy_content_pub
        ├── growth_area_definitions
        ├── mission_templates
        └── personality_catalogue
              ↓ WAL streaming (sub-second lag)
   ┌──────────┼──────────┐
   ↓          ↓          ↓
EU cluster  US cluster  IN cluster  …
(local read) (local read) (local read)
```

Writes go to the Content DB only. Each regional cluster subscribes and maintains a local read-only replica of the content tables. App queries run locally — no cross-region round-trip.

### Content DB setup

Run once on the Content DB master:

```sql
-- Allow the replication user to read the tables being published
GRANT SELECT ON growth_area_definitions, mission_templates, personality_catalogue
  TO replication_user;

-- Create the publication
CREATE PUBLICATION buddy_content_pub
  FOR TABLE growth_area_definitions, mission_templates, personality_catalogue;
```

Verify:
```sql
SELECT pubname, pubtables FROM pg_publication_tables WHERE pubname = 'buddy_content_pub';
```

### Regional cluster setup

Run once per regional cluster. Replace `<content-db-host>`, `<password>`, and `<region>` for each:

```sql
-- The content tables must already exist on the subscriber (Alembic creates them)
-- Disable FK checks during initial sync if needed:
-- SET session_replication_role = replica;  -- only if FK constraints fire on sync

CREATE SUBSCRIPTION buddy_content_sub
  CONNECTION 'host=<content-db-host> port=5432 dbname=buddy_content user=replication_user password=<password> sslmode=require'
  PUBLICATION buddy_content_pub
  WITH (copy_data = true, connect = true);
```

`copy_data = true` triggers an initial full-table copy before streaming begins, so a new region is immediately populated.

Verify replication lag:
```sql
-- On Content DB master:
SELECT subscription_name, sent_lsn, write_lsn, flush_lsn, replay_lsn,
       write_lag, flush_lag, replay_lag
FROM pg_stat_replication;
```

### Alembic — keeping content tables in sync

Content table schema changes must be applied to the Content DB first, then propagate automatically to all subscribers via DDL-in-transaction replication. Steps for a schema change:

1. Write the Alembic migration normally (it touches `growth_area_definitions` etc.)
2. Run `alembic upgrade head` against `CONTENT_DB_URL` in a maintenance window.
3. The `ALTER TABLE` / `CREATE TABLE` DDL replicates to all regional subscribers within seconds.
4. Run `alembic upgrade head` against each regional `DATABASE_URL` so Alembic's version table is also updated there (the schema change is already applied via replication, but Alembic must record the revision).

Add `CONTENT_DB_URL` to the entrypoint.sh migration block:

```bash
if [ -n "${CONTENT_DB_URL:-}" ]; then
  echo "[entrypoint] Running content DB migrations (CONTENT_DB_URL)..."
  DATABASE_URL="$CONTENT_DB_URL" alembic upgrade head
fi
```

> **Prerequisite:** `CONTENT_DB_URL` must first be added to `settings.py` and
> `database.py` before this block is useful. See the Connection Setup section in
> [`GLOBAL_ROUTING_AURORA.md`](./GLOBAL_ROUTING_AURORA.md) for the exact code to add.
> Until then, this entrypoint.sh block is safe to include (the `if` guard means
> it is a no-op when the variable is absent).

### App code — reading content tables

No code changes are needed. Because the content tables exist in every regional cluster (populated by the subscription), queries like:

```python
db.execute(select(GrowthAreaDefinition)).scalars().all()
```

run against the local regional DB that `get_db()` already resolves. Zero cross-region network calls.

### Future: user-facing writes to content tables

If a future endpoint allows users to propose or create content (e.g., a custom mission template), the write must be directed to the Content DB, not the regional DB. Use a dedicated dependency:

```python
# backend/app/deps.py (future addition)
def get_content_db() -> Session:
    return _make_session(_content_engine())()
```

That single write propagates to all regions within milliseconds via logical replication, satisfying the "negligible delay" requirement described in the architecture goals.

### Replication monitoring

Add to your observability stack:

```sql
-- Alert if replay_lag exceeds 5 seconds on any subscriber
SELECT client_addr, replay_lag
FROM pg_stat_replication
WHERE replay_lag > interval '5 seconds';
```

For AWS RDS / Aurora: use the `ReplicaLag` CloudWatch metric on each subscriber cluster; set an alarm at 10 seconds.

---

## Summary

| Gap | Solution | When it runs |
|---|---|---|
| Gap 2 | `entrypoint.sh` runs `alembic upgrade head` twice (regional then router DB) before uvicorn starts | Every container start |
| Gap 3 | PostgreSQL Logical Replication from Content DB to all regional clusters; app reads content tables locally | Continuous, sub-second lag |

Neither gap requires changes to the application Python code. Both are pure infrastructure / deployment concerns.
