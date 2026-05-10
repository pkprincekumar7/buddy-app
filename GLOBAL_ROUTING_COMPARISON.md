# Global Routing Architecture Comparison — PostgreSQL/Aurora vs MongoDB Atlas Global Clusters

> **Related documents**
> - [`GLOBAL_ROUTING_AURORA.md`](./GLOBAL_ROUTING_AURORA.md) — PostgreSQL/Aurora Regional Sharding architecture (full implementation guide)
> - [`GLOBAL_ROUTING_MONGO.md`](./GLOBAL_ROUTING_MONGO.md) — MongoDB Atlas Global Clusters architecture (full implementation guide)

> **Decision summary:** PostgreSQL/Aurora is the recommended architecture for buddy-app. The reasons are cost, zero migration effort, superior compliance auditability, and the fact that the distributed write problem is identical in both approaches — MongoDB does not simplify it.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Side-by-Side](#2-architecture-side-by-side)
3. [Detailed Comparison](#3-detailed-comparison)
   - [3.1 Aggregation and Fetch](#31-aggregation-and-fetch)
   - [3.2 Insertion, Updates, and Distributed Write Coordination](#32-insertionupdates-and-distributed-write-coordination)
   - [3.3 Operational Cost](#33-operational-cost)
   - [3.4 Infrastructure Cost](#34-infrastructure-cost)
   - [3.5 Scalability](#35-scalability)
   - [3.6 Schema Complexity](#36-schema-complexity)
   - [3.7 Other Parameters](#37-other-parameters)
4. [The Distributed Write Problem — Both Approaches Solve It the Same Way](#4-the-distributed-write-problem--both-approaches-solve-it-the-same-way)
5. [Final Recommendation](#5-final-recommendation)
6. [When to Choose MongoDB Instead](#6-when-to-choose-mongodb-instead)
7. [Long-Term PostgreSQL Roadmap for buddy-app](#7-long-term-postgresql-roadmap-for-buddy-app)
8. [Decision Checklist](#8-decision-checklist)

---

## 1. Overview

buddy-app requires multi-region data residency to comply with GDPR, India DPDP, Saudi PDPL, Brazil LGPD, Thailand PDPA, Russia FZ-242, and China PIPL. Two architectures have been evaluated:

- **PostgreSQL/Aurora approach:** Separate Aurora cluster per region, a tiny Global Router DB (email_hash → region), a Global Content DB (non-PII catalogue data), and logical replication pushing content into each regional cluster.
- **MongoDB Atlas Global Clusters approach:** Single logical cluster with zone sharding by `{location, _id}`, mongos handles routing, global collections replicated to all zones automatically.

This document compares them across seven dimensions and issues a definitive recommendation. It is a decision document, not a neutral survey — buddy-app has an existing codebase, an existing schema, and concrete budget constraints. The comparison is evaluated in that context.

---

## 2. Architecture Side-by-Side

### PostgreSQL / Aurora Regional Sharding

```
╔══════════════════════════════════════════════════════════════════════════╗
║              NON-PII LAYER  (no residency restriction)                   ║
║                                                                          ║
║  ┌─────────────────────────┐     ┌──────────────────────────────────┐   ║
║  │    Global Router DB     │     │       Global Content DB          │   ║
║  │   (tiny, ~1 table)      │     │                                  │   ║
║  │  email_hash → region    │     │  growth_area_definitions         │   ║
║  │  user_id    → region    │     │  mission_templates               │   ║
║  │                         │     │  personality_catalogue           │   ║
║  │  Read: login only       │     │  feature_flags / app_config      │   ║
║  └────────────┬────────────┘     └─────────────────┬────────────────┘   ║
║               │ 1× per login                        │ logical replication║
╚═══════════════╪═════════════════════════════════════╪══════════════════╝
                │                                     │ (pushed to all
                │                                     │  regional clusters)
       ╔════════╪═════════════════════════════════════╪═══════════════╗
       ║        │       PII LAYER  (residency laws apply)             ║
       ║   ┌────▼───────────────┐  ┌────────────────────┐  ┌──────┐  ║
       ║   │    EU Cluster      │  │    US Cluster      │  │ ...  │  ║
       ║   │  (Frankfurt/       │  │  (us-east-1)       │  │ IN   │  ║
       ║   │   Ireland)         │  │                    │  │ APAC │  ║
       ║   │                    │  │                    │  │ ME   │  ║
       ║   │  users             │  │  users             │  │ BR   │  ║
       ║   │  children          │  │  children          │  │      │  ║
       ║   │  growth_missions   │  │  growth_missions   │  │      │  ║
       ║   │  user_goals        │  │  user_goals        │  │      │  ║
       ║   │  [all 11 tables]   │  │  [all 11 tables]   │  │      │  ║
       ║   │  ────────────────  │  │  ──────────────    │  │      │  ║
       ║   │  content.* (copy)  │  │  content.* (copy)  │  │      │  ║
       ║   └────────────────────┘  └────────────────────┘  └──────┘  ║
       ╚═══════════════════════════════════════════════════════════════╝

App layer:  JWT carries region claim → connection pool routes to correct cluster
            Login is the only request that touches the Global Router DB
```

### MongoDB Atlas Global Clusters

```
╔══════════════════════════════════════════════════════════════════════════╗
║               ATLAS CLUSTER  (single logical cluster)                    ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐  ║
║  │                    mongos  (Atlas-managed router)                  │  ║
║  │     Routes writes/reads by shard key: { location, _id }           │  ║
║  └───────────────────────┬────────────────────────────────────────────┘  ║
║                          │                                               ║
║   ┌──────────────────────┼──────────────────────────────────┐           ║
║   │                      │                                  │           ║
║   ▼                      ▼                                  ▼           ║
║  ┌────────────────┐  ┌────────────────┐             ┌───────────────┐   ║
║  │   EU Zone      │  │    US Zone     │     ...     │  APAC Zone    │   ║
║  │  (M30+)        │  │  (M30+)        │             │  (M30+)       │   ║
║  │                │  │                │             │               │   ║
║  │  zone-sharded  │  │  zone-sharded  │             │  zone-sharded │   ║
║  │  collections:  │  │  collections:  │             │  collections: │   ║
║  │   users        │  │   users        │             │   users       │   ║
║  │   children     │  │   children     │             │   children    │   ║
║  │   ...          │  │   ...          │             │   ...         │   ║
║  │                │  │                │             │               │   ║
║  │  global        │  │  global        │             │  global       │   ║
║  │  collections   │  │  collections   │             │  collections  │   ║
║  │  (replicated): │  │  (replicated): │             │  (replicated):│   ║
║  │   user_lookups │  │   user_lookups │             │   user_lookups│   ║
║  │   growth_areas │  │   growth_areas │             │   growth_areas│   ║
║  └────────────────┘  └────────────────┘             └───────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════╝

App layer:  Single connection string → mongos → zone
            Login requires: email_hash lookup in user_lookups (global)
                            → zone-specific query for authentication
            Registration: two-phase commit (same saga pattern)
```

### Key Structural Difference

The two architectures converge on the same fundamental shape: a lightweight global lookup layer (Router DB vs `user_lookups` collection) routes to a residency-restricted per-region data store (Aurora cluster vs Atlas zone). The router DB and the `user_lookups` collection solve the same problem with different technology. The application logic — including the distributed write coordination at registration — is structurally identical.

---

## 3. Detailed Comparison

### 3.1 Aggregation and Fetch

#### Single-user fetch (the hot path — every API request)

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Mechanism | JWT carries region → route to correct Aurora cluster → SQL SELECT | Single connection string → mongos routes by `{location, _id}` shard key |
| Extra lookup needed? | No (region in JWT, no extra DB call) | No (mongos routes by shard key embedded in document) |
| Latency (same-region) | ~1–3 ms | ~2–5 ms (mongos routing overhead) |
| Query style | SQL: `SELECT * FROM users WHERE id = $1` | MQL: `db.users.findOne({_id: ..., location: "eu"})` |
| Predictability | High — query plan is stable and cached | Moderate — mongos adds a routing hop |

Both approaches hit only one data store per request on the hot path. Neither has a meaningful advantage here. The mongos hop is negligible at scale.

#### Filtered list queries (e.g. "all growth missions for user X with status=active")

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| SQL/MQL | `SELECT * FROM growth_missions WHERE user_id=$1 AND status='active'` | `db.growth_missions.find({user_id: ..., location: "eu", status: "active"})` |
| Index support | B-tree composite index on `(user_id, status)` — well understood | Compound index on `{user_id, status}` — equivalent |
| JSONB field filtering | `WHERE data->>'status' = 'active'` with GIN index | Native — BSON is the native type |
| After normalization | Full column-level indexes, partial indexes, expression indexes | Same |

**Verdict:** Equivalent for filtered lists. If the JSON fields (`ChildRecord`, `GrowthMissionRecord`, `RecommendationsProgress`) remain as blobs, MongoDB has a marginal ergonomic edge for BSON filtering. After normalization to proper columns — which is the correct path for queryability — PostgreSQL is equal or better.

#### Cross-table aggregation (e.g. "user's goal completion rate across all missions")

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Mechanism | SQL JOIN + GROUP BY in a single query | Aggregation pipeline (`$lookup`, `$group`, `$project`) |
| Multi-collection join | Not needed (single DB, foreign keys) | `$lookup` required — verbose, slower than SQL JOIN |
| Window functions | Native (`OVER`, `PARTITION BY`, `RANK`) | Partial via `$setWindowFields` (added in 5.0) |
| Query readability | High — SQL is declarative and familiar | Moderate — pipeline stages require careful ordering |
| Optimizer quality | Mature (30+ years of planner development) | Good but less mature for complex aggregations |

**Verdict:** PostgreSQL wins clearly on cross-table aggregation. SQL JOIN + GROUP BY is more expressive and better optimized than MongoDB's `$lookup` pipeline for relational data. This advantage is meaningful for analytics dashboards and reporting.

#### Cross-region analytics (e.g. "total active users per region for ops dashboard")

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Mechanism | Application-layer fan-out query to each cluster; aggregate in Python | Cross-zone queries are blocked by zone sharding for user data; requires Atlas Data Federation or separate ETL |
| Complexity | Medium — iterate over region configs, run same query, merge | High — Atlas Data Federation adds another managed component |
| Compliance risk | Explicit — you control which queries touch which cluster | Less explicit — Atlas Data Federation may read across zone boundaries |

**Verdict:** PostgreSQL/Aurora is cleaner for cross-region analytics. You write one query, run it per region explicitly, and aggregate in the application layer. The compliance boundary is transparent.

#### After normalization (the recommended path)

Current schema has heavy JSONB fields: `ChildRecord` stores name, age, school as JSON; `GrowthMissionRecord` stores status, type, due_date as JSON; `RecommendationsProgress` is entirely JSON. These should be normalized to proper columns for queryability. After normalization:

- PostgreSQL gains the full relational advantage: composite indexes, FK constraints, partial indexes, CHECK constraints, SQL aggregations.
- MongoDB loses its ergonomic JSON edge because normalized documents are just flat key-value objects anyway.
- The normalization argument for MongoDB disappears entirely once the schema is normalized.

---

### 3.2 Insertion/Updates and Distributed Write Coordination

#### Single-user write (the common case — 95%+ of writes)

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Single row insert | `INSERT INTO growth_missions ...` — ACID, synchronous | `db.growth_missions.insertOne(...)` — ACID per document |
| Atomicity scope | Transaction across all tables in the regional cluster | Multi-document transactions available (added in 4.0, costly) |
| FK cascade deletes | Native — `ON DELETE CASCADE` enforced by DB engine | Not supported — application must handle cascade manually |
| Optimistic locking | `SELECT FOR UPDATE`, advisory locks | `findAndModify`, no native `FOR UPDATE` equivalent |
| Batch updates | Single SQL UPDATE with WHERE clause | `updateMany` — equivalent |

**Verdict:** PostgreSQL wins for writes that span multiple tables (e.g. creating a user + onboarding record + preferences in a single transaction). MongoDB multi-document transactions carry higher overhead and are less ergonomic.

#### Content updates (global catalogue data — growth area definitions, mission templates)

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Write path | Write to Global Content DB → logical replication pushes to all regional `content.*` schemas | Write to any zone → mongos propagates to global collection replicas |
| Propagation latency | Sub-second via logical replication (configurable) | Typically sub-second via Atlas-managed replication |
| Conflict handling | Single source of truth — Global Content DB is the write target | Global collection writes must be carefully coordinated to avoid conflicts |
| Rollback | Standard DDL/DML rollback | Document-level rollback |

**Verdict:** Equivalent. Both replicate non-PII catalogue data globally with sub-second lag.

#### Registration — the hard distributed write case

This is analyzed in depth in Section 4. Summary: both approaches require the same Saga/two-phase commit pattern. Neither eliminates the distributed write problem.

#### Cross-instance atomicity (registering a user touches two systems)

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Problem | Must write to Router DB AND regional cluster atomically | Must write to `user_lookups` global collection AND zone-specific collection |
| Solution | Saga pattern: Router DB write (pending) → regional write → Router DB confirm | Two-phase commit: `user_lookups` write (pending) → zone write → `user_lookups` confirm |
| Are these different? | No — structurally identical | No — structurally identical |
| Compensation on failure | Delete router entry if regional write fails | Delete user_lookups entry if zone write fails |
| Idempotency required | Yes | Yes |

#### Cascade deletes

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Database-level enforcement | Yes — `ON DELETE CASCADE` across all related tables | No — application must explicitly delete related documents |
| GDPR Article 17 (right to erasure) | Single `DELETE FROM users WHERE id=$1` cascades to all child tables automatically | Application must enumerate all collections and delete by user_id in each |
| Risk of orphaned data | Low — DB engine enforces | Higher — application bugs can leave orphaned documents |

**Verdict:** PostgreSQL wins decisively on cascade deletes. For GDPR right-to-erasure compliance, a single `DELETE` with cascades is safer and auditably complete. MongoDB requires explicit multi-collection application logic with failure handling.

---

### 3.3 Operational Cost

#### Schema migrations

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Tool | Alembic — already integrated in buddy-app | No standard equivalent; manual scripts or third-party tools (Liquibase, custom) |
| Multi-region migration | `alembic upgrade head` per region in CI/CD pipeline | Manual migration scripts run against each zone; no native migration tooling |
| Zero-downtime migrations | Supported patterns well documented (add nullable column, backfill, make NOT NULL in separate step) | Schema-less by default — but application code must handle old and new document shapes during rollout |
| Rollback | Alembic downgrade scripts | Manual reverse scripts |
| Schema validation | PostgreSQL enforces column types, NOT NULL, CHECK constraints | Schema validation via JSON Schema validators (optional, not enforced by default) |
| Buddy-app specific | Zero additional tooling cost — Alembic is already running | Requires new tooling, new migration discipline, or acceptance of uncontrolled schema drift |

**Verdict:** PostgreSQL/Aurora wins significantly. Alembic is already in use; the migration discipline is established. MongoDB introduces uncontrolled schema drift risk if validation is not explicitly configured on every collection.

#### Connection management

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Connection pools | One pool per region (6 pools at 6 regions) — managed in `database.py` | Single connection string — mongos manages connection routing |
| Overhead | Moderate — pool management code exists in `database.py`, is explicit | Lower — single connection string is simpler for the application |
| pgBouncer requirement | Recommended at scale | Not needed — mongos is the connection layer |
| Failure isolation | One region's pool failure does not affect others | mongos failure affects all zones (mitigated by Atlas's HA mongos) |

**Verdict:** MongoDB has a modest advantage here — single connection string reduces connection pool management code. This is a real but minor operational simplicity win.

#### Failover and high availability

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Failover mechanism | Aurora Multi-AZ automatic failover — typically < 30 seconds | Atlas-managed replica sets per zone — typically < 10 seconds |
| Cross-region failover | Not supported — each cluster is independent (by design, for residency compliance) | Not supported for zone-sharded data (by design, same compliance reason) |
| HA configuration | Aurora handles this; RDS parameter group settings | Atlas handles this; configured via cluster tier |
| Read replicas | Aurora read replicas for read scale | Atlas secondary nodes for read preference |

**Verdict:** Equivalent. Both use managed HA within the region. Neither supports cross-region failover for user PII data (compliance prevents it).

#### Engine upgrades

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Upgrade path | AWS-managed minor version upgrades; major version requires blue-green deployment | Atlas-managed, largely transparent |
| Impact on application | SQLAlchemy abstraction layer insulates most changes | PyMongo driver updates occasionally break API compatibility |
| Upgrade frequency | PostgreSQL major release every year; AWS Aurora typically lags 6–12 months | MongoDB Atlas releases more frequently |

**Verdict:** Slightly in favor of PostgreSQL/Aurora — Aurora's managed upgrade cycle is predictable and SQLAlchemy abstracts most compatibility concerns.

#### Monitoring

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Built-in metrics | CloudWatch (if AWS), pg_stat_* views | Atlas Performance Advisor, Atlas Charts |
| Query performance | `EXPLAIN ANALYZE`, `pg_stat_statements` | Atlas Profiler, `explain()` |
| Alerting | CloudWatch Alarms, DataDog RDS integration | Atlas Alerts, DataDog MongoDB integration |
| Tooling ecosystem | Extensive — pgBadger, pganalyze, DataDog, New Relic, Grafana | Good — Atlas built-in + standard monitoring tools |

**Verdict:** PostgreSQL has a richer third-party monitoring ecosystem. Atlas's built-in tooling is sufficient but the independent tooling market is smaller.

---

### 3.4 Infrastructure Cost

#### Minimum viable tier

| Component | PostgreSQL/Aurora | MongoDB Atlas |
|-----------|-------------------|---------------|
| Minimum production tier | `db.t3.medium` Aurora (~$50–80/month) or `db.r6g.large` (~$120/month) | M30 required for zone sharding ($210/month per zone) |
| Why the floor? | Aurora supports smaller instances | M30 is the Atlas minimum tier for zone sharding; M10/M20 do not support it |
| Dev/staging environment | Can use RDS `t3.micro` ~$15/month | M10 can be used for dev ($57/month) but M30 required for production zone features |

#### 3-region deployment cost estimate

Regions: EU (Frankfurt), US (us-east-1), APAC (Singapore)

| Component | PostgreSQL/Aurora 3-region | MongoDB Atlas 3-region |
|-----------|---------------------------|------------------------|
| Regional compute | 3 × ~$120/month (`db.r6g.large`) = $360/month | 3 × $210/month (M30 minimum) = $630/month |
| Global Router DB | ~$30/month (`db.t3.micro`) | Included in Atlas (global collections replicated) |
| Global Content DB | ~$30/month (`db.t3.micro`) | Included in Atlas |
| Redis (rate limiter) | 3 × ~$20/month (ElastiCache `cache.t3.micro`) = $60/month | 3 × ~$20/month (same requirement) = $60/month |
| Storage (100 GB/region) | 3 × ~$11.50/month = ~$35/month | 3 × ~$25/month = ~$75/month |
| Data transfer | ~$20/month (inter-region replication) | ~$20/month (Atlas cross-zone traffic) |
| **Monthly total** | **~$535/month** | **~$785/month** |
| **Delta** | — | **+$250/month (+47%)** |
| **3-year delta** | — | **+$9,000** |

#### 6-region deployment cost estimate

Regions: EU, US, APAC, IN, ME, BR

| Component | PostgreSQL/Aurora 6-region | MongoDB Atlas 6-region |
|-----------|---------------------------|------------------------|
| Regional compute | 6 × ~$120/month = $720/month | 6 × $210/month = $1,260/month |
| Global Router DB | ~$30/month | Included |
| Global Content DB | ~$30/month | Included |
| Redis | 6 × ~$20/month = $120/month | 6 × ~$20/month = $120/month |
| Storage (100 GB/region) | 6 × ~$11.50/month = ~$70/month | 6 × ~$25/month = ~$150/month |
| Data transfer | ~$40/month | ~$50/month |
| **Monthly total** | **~$1,010/month** | **~$1,580/month** |
| **Delta** | — | **+$570/month (+56%)** |
| **3-year delta** | — | **+$20,520** |

> These are baseline estimates at minimum viable instance sizes. Actual costs scale with traffic and storage. The Atlas M30 minimum tier for zone sharding is a hard floor — it cannot be reduced below $210/zone/month regardless of actual traffic. Aurora/RDS instance sizes can be right-sized to actual workload.

#### Storage costs

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Storage pricing | Aurora: $0.10/GB/month; RDS gp3: $0.115/GB/month | Atlas M30: ~$0.25/GB/month (included storage) |
| JSONB storage efficiency | JSONB is compressed; indexes add overhead | BSON is compact binary; WiredTiger compression |
| After normalization | Column storage is more compact than JSONB blobs | Flat documents are compact |

#### Redis requirement

Both architectures require Redis for the rate limiter fix described in `GLOBAL_ROUTING_AURORA.md`. The current in-memory `defaultdict(deque)` rate limiter breaks under multi-instance deployment. Redis is not optional in either architecture — it is a prerequisite for multi-region operation. This cost is therefore identical and does not differentiate the two approaches.

#### Vendor lock-in cost

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Portability | PostgreSQL dialect runs on Aurora, RDS, Neon, Supabase, CockroachDB, self-hosted. Switch cloud providers without changing application code. | MongoDB Atlas global zone sharding is Atlas-specific. Self-hosted MongoDB does not support zone sharding equivalently. Migrating off Atlas means redesigning the routing architecture. |
| License | PostgreSQL — BSD license, fully open source | MongoDB — SSPL license (source available, not OSI open source). Commercial driver required for some integrations. |
| Price leverage | Multiple competing providers keep pricing competitive | Atlas has no competitor offering equivalent global zone sharding |

---

### 3.5 Scalability

#### Read scale

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Read replicas | Aurora read replicas — add up to 15 per cluster; read traffic distributed automatically | Atlas secondary nodes — read preference can route reads to secondaries |
| Read scale ceiling | Very high — Aurora can handle thousands of read replicas via Aurora Serverless or ProxySQL | High — Atlas read preference across replica set members |
| buddy-app workload | Read-heavy (users loading dashboards, goals, missions) — read replicas handle this well | Read-heavy workload also handled well |

**Verdict:** Equivalent for read scale. Both support read replicas/secondaries that can absorb the buddy-app read workload.

#### Vertical write scale

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Instance sizes | Aurora: up to `db.r6g.16xlarge` (64 vCPU, 512 GB RAM) | Atlas: up to M700 ($3,800/month, 96 vCPU, 768 GB RAM) |
| Write throughput ceiling | Very high for single-user-isolated workload | Very high |
| buddy-app writes | Moderate — parenting app users make O(10–100) writes/session | Well within vertical scale of both |

#### Horizontal write scale (sharding)

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Need for buddy-app? | No — user data is fully isolated. There is no cross-user write contention. Each user's writes go to one cluster. Within a cluster, Postgres handles thousands of concurrent single-user writes easily. | Not needed for the same reason — zone sharding is already by user location, and within a zone, single-user writes are independent. |
| When it matters | > 50,000–100,000 writes/second sustained to a single cluster | > 50,000 writes/second — Atlas can add shards within a zone |
| buddy-app projected writes | Estimated < 1,000 writes/second at 100,000 active users (parenting app, not a trading platform) | Same projection applies |

**Key insight:** buddy-app's user-isolated workload is the ideal case for single-instance vertical scale. User A's writes never contend with User B's writes. The multi-region architecture distributes load across regions naturally. Within any single region, a single Aurora cluster handles the write load of that region's users. Horizontal sharding within a region is irrelevant at any realistic buddy-app scale.

MongoDB's native horizontal sharding is its primary architectural advantage over PostgreSQL. For buddy-app, this advantage is not needed and will not be needed for the foreseeable future. The argument for MongoDB's sharding capability is a solution to a problem buddy-app does not have.

#### User-isolated workload characteristic

buddy-app is a parenting/child development application. Each user's data is a self-contained island: their account, their children, their missions, their goals, their recommendations. No cross-user aggregation or write coordination is needed in normal operation. This characteristic makes the workload:

- Perfectly suited to regional sharding (each user stays in one cluster permanently)
- Trivially parallelizable (10 users × 10 writes = 10 independent single-row writes)
- Not a candidate for horizontal sharding until individual regional clusters exceed vertical capacity limits — which requires millions of active concurrent users

---

### 3.6 Schema Complexity

#### Number of tables vs collections

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Current schema | 11 PostgreSQL tables, well-defined relationships, Alembic migrations in place | Would require 11+ collections; zone-sharded collections must include `{location, _id}` as shard key |
| Global/non-sharded data | `content.*` schema in each cluster (2–4 tables) | `user_lookups` + content collections as global (unsharded) collections |
| Total components | 11 user tables + 4 content tables + 1 router table = 16 tables across 3 DB instances | 11+ sharded collections + 3–4 global collections = 15+ collections in 1 logical cluster |
| Structural equivalence | Router DB maps email_hash → cluster | `user_lookups` maps email_hash → zone |

The number of logical objects is equivalent. The Atlas approach bundles them in one logical cluster; Aurora distributes them explicitly across named instances. Neither is simpler in terms of object count.

#### JSON/BSON handling

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Current JSONB fields | `ChildRecord`, `GrowthMissionRecord`, `RecommendationsProgress` stored as JSONB | Would be native BSON documents — no schema translation needed |
| Querying JSON | `WHERE data->>'status' = 'active'` + GIN indexes | `{status: "active"}` — native, no special syntax |
| After normalization | JSONB advantage disappears — proper columns with type safety | Flat document fields — equivalent |
| Type enforcement | PostgreSQL CHECK constraints, custom types | JSON Schema validators (optional) |

**MongoDB has a genuine ergonomic advantage here if the schema remains JSON-heavy.** However, the JSON-heavy schema is a debt item — `ChildRecord.name`, `GrowthMissionRecord.status`, `GrowthMissionRecord.due_date` should be proper columns for queryability, indexability, and type safety. After normalization, this advantage collapses.

#### FK constraints and cascade deletes

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| FK enforcement | Native — database engine enforces referential integrity | None — application must enforce |
| Cascade delete | `ON DELETE CASCADE` — single DELETE statement removes all related rows | Application must enumerate and delete documents in every related collection |
| Orphan prevention | Enforced at DB level — impossible to create an orphaned child record | Possible if application logic has a bug |
| GDPR erasure | Single cascade delete covers all user data | Requires explicit multi-collection delete logic with failure handling |

**Verdict:** PostgreSQL wins decisively on referential integrity. For GDPR compliance (right to erasure, Article 17) and data consistency, database-enforced FK constraints with cascade deletes are materially safer than application-enforced consistency.

#### Schema enforcement

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Default enforcement | Strict — every column has a type, nullable constraint, and optional CHECK | Schema-less by default — any document shape accepted |
| Opt-in enforcement | Always on — cannot be disabled | JSON Schema validators on collections (optional, must be explicitly configured) |
| Accidental schema drift | Not possible — ALTER TABLE required for any change | Possible — typos in field names create new fields silently |
| Code review signal | Schema changes require migration file — easily reviewable | Schema changes may be invisible in code review (no migration artifact) |

**Verdict:** PostgreSQL wins on schema enforcement. Schema-less flexibility is a feature during rapid prototyping but a risk in production, especially for compliance-sensitive applications where data integrity is audited.

#### Schema evolution

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| Adding a column | `ALTER TABLE ADD COLUMN` — Alembic generates this automatically | Add field to documents at write time; old documents have no field (handle in application) |
| Renaming a field | `ALTER TABLE RENAME COLUMN` + migration | Update documents in bulk; application must handle both old and new names during rollout |
| Breaking change safety | Migration script is reviewed, versioned, reversible | No migration artifact; breaking changes can be deployed silently |
| Tooling | Alembic — already integrated and used in buddy-app | No equivalent standard tool |

#### Code migration cost from current codebase

| Aspect | PostgreSQL/Aurora | MongoDB Atlas |
|--------|-------------------|---------------|
| ORM changes | Zero — SQLAlchemy stays; add `get_regional_db()` pool router | Complete rewrite — SQLAlchemy + Alembic → PyMongo/Motor + custom migration scripts |
| Model changes | Zero — existing model classes stay | Every model rewritten as document classes |
| Query changes | Zero for most queries; add region routing to session selection | Every query rewritten in MQL/Aggregation Pipeline |
| Migration tool | Alembic — already running | No equivalent; build or adopt custom tooling |
| Estimated migration effort | 1–2 weeks engineering (add region routing, connection pools, JWT claim) | 6–10 weeks engineering (rewrite all models, queries, migrations, testing) |

---

### 3.7 Other Parameters

| Parameter | PostgreSQL/Aurora | MongoDB Atlas |
|-----------|-------------------|---------------|
| **Query language** | SQL — universally known, 50-year standard, every engineer knows it | MQL + Aggregation Pipeline — proprietary, steeper learning curve, smaller community than SQL |
| **BI / reporting tools** | Universal — Metabase, Grafana, Superset, Tableau, Power BI, Looker all have native PostgreSQL connectors | Good but smaller — most BI tools support MongoDB but SQL connectors are more mature |
| **Full-text search** | `tsvector`/`tsquery` built in; `pg_trgm` for trigram similarity | Atlas Search (Lucene-based) — more powerful, but adds Atlas dependency |
| **Vendor lock-in** | Low — PostgreSQL is open source (BSD); runs on Aurora, RDS, Neon, Supabase, CockroachDB, self-hosted | High — Atlas zone sharding is Atlas-specific. SSPL license. No comparable alternative. |
| **Open source** | Yes — PostgreSQL is fully open source | Partial — MongoDB Community Edition exists but Atlas global zone sharding is commercial-only |
| **GDPR audit clarity** | High — "all EU user data is in Aurora cluster in eu-central-1 (Frankfurt)" is a one-sentence audit answer | Moderate — "data for EU users is in the EU zone of our Atlas global cluster, zone-pinned by shard key `{location: 'eu', _id: ...}`" requires technical explanation to a regulator |
| **Existing codebase fit** | Perfect — zero ORM or migration tool changes | Zero fit — complete rewrite of models, queries, and migration tooling |
| **Compliance auditability** | Explicit physical cluster per region — trivially provable to any regulator, technical or otherwise | Correct but less legible — zone sharding achieves the same physical result but the explanation requires understanding Atlas zone architecture |
| **Team SQL familiarity** | High — SQL is universal | Moderate — requires learning MQL, aggregation pipeline syntax, index strategy differences |
| **Ecosystem maturity** | 35 years; largest open-source database ecosystem | 15 years; growing but smaller ecosystem |

---

## 4. The Distributed Write Problem — Both Approaches Solve It the Same Way

This section is the most important in the document. It addresses the most common argument for MongoDB Atlas: that it "simplifies" the routing problem by handling routing transparently via mongos. This argument is partially true for the hot path (subsequent requests) but completely false for the distributed write problem at registration.

### The problem

Registering a new user requires writing to two systems simultaneously:
1. A global lookup system (Router DB or `user_lookups`)
2. A region-specific data store (Aurora cluster or Atlas zone)

These are two separate storage systems. No distributed transaction spans them. If write #1 succeeds and write #2 fails, you have an inconsistent state: the global lookup points to a user that does not exist in the regional store.

### Both architectures use the same Saga pattern

#### PostgreSQL/Aurora — Registration Saga

```
Step 1:  Write to Global Router DB
         INSERT INTO user_regions (email_hash, user_id, region, status)
         VALUES ($1, $2, 'eu', 'pending')

Step 2:  Write to EU Aurora cluster
         INSERT INTO users (id, email, ...) VALUES (...)
         INSERT INTO user_onboarding (...) VALUES (...)
         INSERT INTO user_preferences (...) VALUES (...)
         -- Full ACID transaction within the regional cluster

Step 3:  Confirm in Global Router DB
         UPDATE user_regions SET status = 'active' WHERE email_hash = $1

Compensation (if Step 2 fails):
         DELETE FROM user_regions WHERE email_hash = $1
         -- or: UPDATE user_regions SET status = 'failed'

Idempotency:
         Check for existing email_hash in Router DB before Step 1
         Use UPSERT with conflict handling
```

#### MongoDB Atlas — Registration (Atlas documentation calls this "two-phase commit")

```
Step 1:  Write to user_lookups global collection
         db.user_lookups.insertOne({
           email_hash: "...",
           user_id: "...",
           zone: "eu",
           status: "pending"
         })

Step 2:  Write to EU zone (zone-pinned by {location: "eu", _id: ...})
         db.users.insertOne({location: "eu", _id: ..., email: ..., ...})
         db.user_onboarding.insertOne({location: "eu", user_id: ..., ...})
         db.user_preferences.insertOne({location: "eu", user_id: ..., ...})
         -- No FK constraints; application must handle partial writes

Step 3:  Confirm in user_lookups
         db.user_lookups.updateOne(
           {email_hash: "..."},
           {$set: {status: "active"}}
         )

Compensation (if Step 2 fails):
         db.user_lookups.deleteOne({email_hash: "..."})
         -- Must also clean up any partially written documents in the zone

Idempotency:
         Check user_lookups before Step 1
         Use findOneAndUpdate with upsert
```

### Side-by-side comparison

```
PostgreSQL/Aurora Saga               MongoDB Atlas Two-Phase Commit
─────────────────────────────        ────────────────────────────────────
1. Write Router DB (pending)         1. Write user_lookups (pending)
2. Write regional cluster (ACID)     2. Write zone documents (no FK protection)
3. Confirm Router DB (active)        3. Confirm user_lookups (active)
4. Compensate on failure             4. Compensate on failure
5. Idempotency check                 5. Idempotency check
```

**These are the same pattern.** The names are different. The storage technology is different. The logic is identical. Atlas does not eliminate the distributed write coordination problem — it renames it.

The critical difference in Step 2: Aurora provides a full ACID transaction for all writes within the regional cluster. If creating the user row succeeds but creating the user_onboarding row fails, Aurora rolls back both automatically. MongoDB's multi-document transactions are available but carry higher overhead and are less commonly used — without explicit transaction wrapping, a partial write to the zone leaves orphaned documents that must be cleaned up by the compensation logic.

### What Atlas's mongos routing actually simplifies

Atlas's single connection string genuinely simplifies the **application connection management** for subsequent requests. Instead of maintaining 6 regional connection pools in `database.py` and routing based on the JWT region claim, the application sends requests to one endpoint and mongos routes them. This is a real operational simplification — but it is a narrow one. It affects connection pool management code (perhaps 50 lines in `database.py`) and does not affect:

- The distributed write saga at registration
- The compliance architecture
- The cost structure
- The query language or ORM
- The schema migration tooling
- The cascade delete logic
- The cross-region analytics logic

The connection routing simplification is not worth $250–570/month premium at 3–6 regions.

---

## 5. Final Recommendation

**PostgreSQL/Aurora is the correct choice for buddy-app.**

This is a clear recommendation, not a close call. The reasons:

### Reason 1: The distributed write problem is identical in both

The most persuasive Atlas argument — that it "handles routing transparently" — holds for the hot path (subsequent requests) but not for the hard case (registration). Both architectures require a Saga pattern. Atlas does not simplify the problem that actually requires careful engineering. It simplifies connection pool configuration (a minor concern) while not helping with distributed write coordination (the actual concern). See Section 4.

### Reason 2: Cost is 47–56% higher with Atlas for no functional benefit that matters

At 3 regions: ~$785/month (Atlas) vs ~$535/month (Aurora) = $250/month premium.
At 6 regions: ~$1,580/month (Atlas) vs ~$1,010/month (Aurora) = $570/month premium.
Over 3 years at 6 regions: ~$20,520 extra spend.

The M30 minimum tier ($210/zone/month) is a hard floor imposed by Atlas's architecture requirements for zone sharding. It cannot be reduced regardless of actual traffic. Aurora instance sizes can be right-sized to actual load. A parenting app starting with early users should not pay for M30 throughput on day one.

### Reason 3: The JSON normalization argument eliminates MongoDB's schema advantage

MongoDB's ergonomic edge is in querying nested BSON documents. The current buddy-app schema stores `ChildRecord` name/age/school, `GrowthMissionRecord` status/type/due_date, and `RecommendationsProgress` as JSONB blobs. This is debt, not a feature. These fields should be normalized to proper columns for queryability, indexability, partial index support, and type safety. After normalization, PostgreSQL's relational model with SQL aggregations is a clear advantage. The JSON argument weakens the moment normalization begins.

### Reason 4: Compliance auditability is simpler with explicit clusters

"All German users' data is in the Aurora cluster in eu-central-1 (Frankfurt)" is a one-sentence answer to a GDPR regulator. Atlas zone sharding achieves the same physical result but requires explaining compound shard keys, zone pin configurations, and mongos routing to a regulator who may have no technical background. The legal risk of a technically equivalent but harder-to-explain architecture is real. Compliance auditors and regulators respond to legibility.

### Reason 5: Zero migration cost — the entire existing codebase works as-is

buddy-app's backend is SQLAlchemy + Alembic + PostgreSQL. The Aurora architecture requires adding:
- `get_regional_db()` connection pool router in `database.py` (~30 lines)
- `region` claim to JWT creation (~5 lines)
- Two-phase logic to the register/login endpoints (~50 lines)
- CI/CD `alembic upgrade head` per region (config change)

Total: approximately 1–2 weeks of engineering, mostly testing.

The Atlas architecture requires:
- Replacing all SQLAlchemy models with MongoDB document classes
- Rewriting all queries in MQL/Aggregation Pipeline
- Replacing Alembic with custom migration scripts or a third-party tool
- Rewriting all JOIN logic as `$lookup` aggregation pipelines
- Rewriting cascade delete logic as multi-collection application operations
- Removing FK constraints and implementing application-level referential integrity

Total: approximately 6–10 weeks of engineering, with high regression risk.

This is not a close call. Switching to Atlas for no functional gain that matters to buddy-app spends 6–10 weeks of engineering and $20,000 in cumulative cost over 3 years.

### Reason 6: Vendor lock-in is materially worse with Atlas

PostgreSQL runs on Aurora (AWS), Cloud SQL (GCP), Azure Database for PostgreSQL, Neon, Supabase, CockroachDB, or self-hosted. Switching providers requires changing a connection string. Application code does not change.

Atlas global zone sharding is an Atlas-specific product. Self-hosted MongoDB does not support zone sharding equivalently. Migrating off Atlas means redesigning the entire routing architecture and rewriting the application. The leverage Atlas has over pricing once you are locked in is significant.

### Reason 7: SQL is universally known

Any engineer hired knows SQL. Not all engineers know the MongoDB Aggregation Pipeline, `$lookup` semantics, index intersection behavior, or BSON type coercion rules. BI tools, data analysts, and support tooling all assume SQL. The total cost of owning a MongoDB codebase includes ongoing training, reduced hiring pool, and reduced BI tool compatibility.

### Summary table

| Criterion | PostgreSQL/Aurora | MongoDB Atlas | Winner |
|-----------|-------------------|---------------|--------|
| Distributed write complexity | Saga pattern | Identical Saga pattern | Tie |
| Monthly cost (6 regions) | ~$1,010 | ~$1,580 | **PostgreSQL** |
| 3-year cost delta | — | +$20,520 | **PostgreSQL** |
| Migration effort | 1–2 weeks | 6–10 weeks | **PostgreSQL** |
| FK constraints + cascade | Native, enforced | Application-level only | **PostgreSQL** |
| Schema migration tooling | Alembic (already used) | Custom/none | **PostgreSQL** |
| GDPR audit legibility | One sentence | Requires technical explanation | **PostgreSQL** |
| Vendor lock-in | Low (BSD, multi-provider) | High (SSPL, Atlas-specific) | **PostgreSQL** |
| Hot-path connection simplicity | 6 connection pools | Single connection string | MongoDB |
| Native JSON ergonomics (before normalization) | JSONB (good) | BSON (better) | MongoDB |
| SQL familiarity | Universal | Requires MQL/Pipeline training | **PostgreSQL** |
| BI tool compatibility | Universal | Good but smaller ecosystem | **PostgreSQL** |
| Read scale | Aurora read replicas | Atlas secondaries | Tie |
| Write scale for buddy-app | More than sufficient | More than sufficient | Tie |
| Open source | Yes (BSD) | Partial (SSPL) | **PostgreSQL** |

PostgreSQL wins 9 criteria. MongoDB wins 2. Three are ties. The recommendation is unambiguous.

---

## 6. When to Choose MongoDB Instead

For completeness and intellectual honesty, MongoDB Atlas Global Clusters would be the correct choice under the following conditions. None of them apply to buddy-app today.

### 1. Starting from scratch with no existing SQL codebase

If buddy-app were being built today for the first time, with no existing SQLAlchemy models, no Alembic history, and a team with deep MongoDB expertise, Atlas would be a reasonable architectural choice. The zero migration cost argument reverses: you are not paying the rewrite tax, you are paying the new build tax, which is the same either way.

### 2. Write volume exceeds ~50,000 sustained writes/second per region

MongoDB's native horizontal sharding (adding shards within a zone) is superior to PostgreSQL's vertical scale + read replica approach when write volume is genuinely very high. Aurora's vertical ceiling is high (~100,000+ writes/second on large instances) but not infinite. If a single regional cluster needs horizontal write sharding, MongoDB's architecture makes this easier.

buddy-app's projected write volume at 100,000 active users: ~500–2,000 writes/second peak. This is well within Aurora's vertical capacity on modest instance sizes.

### 3. Data model is genuinely document-shaped with deeply nested, variable-length structures

If the core data model is fundamentally hierarchical and variable — e.g. a document with an unbounded array of sub-documents with nested arrays — and there is no need for normalized queries or cross-document aggregations, MongoDB's BSON model is more natural. buddy-app's data is relational: users have children, children have missions, missions have completion records. This is a classic entity-relationship model, not a document model.

### 4. Budget is not a constraint and team has deep MongoDB expertise

If the engineering team's primary expertise is MongoDB, and the $570/month premium at 6 regions is immaterial to the business, MongoDB is a viable choice. The operational knowledge advantage of using the tool your team knows best is real. buddy-app does not have this condition.

### 5. Full-text search is a core product feature requiring Lucene capabilities

Atlas Search is built on Lucene and provides significantly richer full-text search than PostgreSQL's `tsvector`/`tsquery`. If buddy-app needs faceted search, fuzzy matching, autocomplete, or language-aware analysis across all user content, Atlas Search is a strong argument for the Atlas stack. buddy-app's current search requirements are covered by `pg_trgm` and `tsvector`.

---

## 7. Long-Term PostgreSQL Roadmap for buddy-app

```
Phase 0 — Today (zero infra cost, code changes only)
    │
    │  ┌─────────────────────────────────────────────────────┐
    │  │  Goal: prevent future pain, no breaking changes     │
    │  │                                                     │
    │  │  ✅ Add `region` to JWT payload (auth_utils.py)     │
    │  │  ✅ Add `country_code` column to User model         │
    │  │  ✅ Add COUNTRY_TO_REGION mapping (routing.py)      │
    │  │  ✅ Add `is_deleted` tombstone to UserRegionRecord  │
    │  │  ✅ JWT token revocation via tokens_revoked_at      │
    │  │  ✅ Saga pattern (register/google_auth) with        │
    │  │     compensation and timing equalization            │
    │  │  ⬜ Add country selector to registration UI         │
    │  │  ⬜ Normalize JSONB fields:                         │
    │  │      ChildRecord → name, age, school_name columns   │
    │  │      GrowthMissionRecord → status, type, due_date   │
    │  │      RecommendationsProgress → structured columns   │
    │  └─────────────────────────────────────────────────────┘
    │
    ▼
Phase 1 — First multi-region deployment (EU + US)
    │
    │  ┌─────────────────────────────────────────────────────┐
    │  │  Goal: serve EU users with full GDPR compliance     │
    │  │                                                     │
    │  │  Infrastructure:                                    │
    │  │  • Provision EU Aurora cluster (eu-central-1)       │
    │  │  • Provision US Aurora cluster (us-east-1)          │
    │  │  • Provision Global Router DB (t3.micro)            │
    │  │  • Provision Global Content DB (t3.micro)           │
    │  │  • Seed Global Content DB with growth areas,        │
    │  │    mission templates, personality catalogue         │
    │  │                                                     │
    │  │  Code changes:                                      │
    │  │  • Implement get_regional_db() in database.py       │
    │  │  • Implement get_content_db() in database.py        │
    │  │  • Update register endpoint: Router DB + regional   │
    │  │  • Update login endpoint: two-phase lookup          │
    │  │  • Update all protected routes: region from JWT     │
    │  │  • Update CI/CD: alembic per region                 │
    │  │  • Replace in-memory rate limiter with Redis        │
    │  │    (ElastiCache cache.t3.micro per region)          │
    │  │                                                     │
    │  │  Estimated cost: ~$290/month (EU + US + infra)     │
    │  └─────────────────────────────────────────────────────┘
    │
    ▼
Phase 2 — Full multi-region compliance rollout
    │
    │  ┌─────────────────────────────────────────────────────┐
    │  │  Goal: all 6 active regions live, compliance docs   │
    │  │                                                     │
    │  │  Infrastructure:                                    │
    │  │  • Add APAC cluster (ap-southeast-1, Singapore)     │
    │  │  • Add IN cluster (ap-south-1, Mumbai)              │
    │  │  • Add ME cluster (me-south-1, Bahrain)             │
    │  │  • Add BR cluster (sa-east-1, São Paulo)            │
    │  │  • Add Redis per new region                         │
    │  │  • Set up logical replication: Global Content DB    │
    │  │    → content.* schema in each regional cluster      │
    │  │    (enables local JOINs between user data and       │
    │  │     content catalogue — no cross-DB queries)        │
    │  │                                                     │
    │  │  Operations:                                        │
    │  │  • Legal review: SCCs for each active region pair   │
    │  │  • Privacy policy update: data-residency by region  │
    │  │  • Monitoring: alert if user data in wrong region   │
    │  │  • Backup isolation: regional S3 buckets only       │
    │  │  • GDPR Article 30 Records of Processing Activities │
    │  │                                                     │
    │  │  Estimated cost: ~$1,010/month (6 regions + infra) │
    │  └─────────────────────────────────────────────────────┘
    │
    ▼
Phase 3 — China (PIPL — separate deployment project)
    │
    │  ┌─────────────────────────────────────────────────────┐
    │  │  Goal: serve Chinese users legally under PIPL       │
    │  │                                                     │
    │  │  • Engage local legal counsel for ICP licence       │
    │  │  • Set up dedicated CN infrastructure               │
    │  │    (ICP-licensed provider, not AWS standard region) │
    │  │  • Fully isolated deployment pipeline               │
    │  │  • Security assessment for any cross-border         │
    │  │    data transfer                                    │
    │  │  • Local legal entity required                      │
    │  │                                                     │
    │  │  Note: treat CN as a separate product track,        │
    │  │  not just another cluster. PIPL requirements are    │
    │  │  qualitatively different from GDPR/LGPD/DPDP.      │
    │  └─────────────────────────────────────────────────────┘
```

### Phase timeline estimates

| Phase | Effort | Duration | Blocker |
|-------|--------|----------|---------|
| Phase 0 | 1 sprint | 1–2 weeks | None — can start today |
| Phase 1 | 2–3 sprints | 3–4 weeks | Phase 0 complete |
| Phase 2 | 3–4 sprints + legal review | 6–10 weeks | Phase 1 stable, legal counsel engaged |
| Phase 3 | Separate project | 3–6 months | Local legal entity, ICP licence |

---

## 8. Decision Checklist

Use this checklist when revisiting the database architecture decision. If circumstances change materially, re-evaluate.

### Conditions that justify staying with PostgreSQL/Aurora

- [ ] Existing SQLAlchemy/Alembic codebase is in use
- [ ] Team is more fluent in SQL than MQL/Aggregation Pipeline
- [ ] Write volume per region is below ~10,000 writes/second
- [ ] Budget sensitivity is present — $250–570/month premium matters
- [ ] GDPR compliance auditability to non-technical regulators is required
- [ ] Cascade-delete safety for GDPR right-to-erasure is required
- [ ] Schema migration tooling (Alembic) is already established
- [ ] BI/reporting tools need native SQL access

### Conditions that would justify reconsidering MongoDB Atlas

- [ ] Team rebuilding from scratch with no existing codebase
- [ ] Sustained write volume exceeds 50,000/second per region (re-evaluate at this threshold)
- [ ] Core data model has shifted to deeply nested, variable-length documents with no relational query needs
- [ ] Atlas Search (Lucene) features are required for a core product feature
- [ ] Team has hired deep MongoDB expertise and SQL fluency has declined
- [ ] Atlas pricing has changed materially (MongoDB has reduced M30 minimums or added lower-tier zone sharding)

### Architectural commitments required for the PostgreSQL path

- [ ] JSONB fields normalized: `ChildRecord`, `GrowthMissionRecord`, `RecommendationsProgress` to proper columns
- [x] `region` claim added to JWT (`create_access_token` in `auth_utils.py`)
- [x] `iat` claim added to JWT (required for token revocation via `tokens_revoked_at`)
- [x] In-memory rate limiter replaced with Redis before multi-region deployment
- [x] Alembic migration covers `user_regions` table with `is_deleted` tombstone
- [ ] Alembic migrations run per region in CI/CD pipeline (entrypoint.sh covers container startup; CI/CD wiring is pending)
- [x] Global Router DB treated as non-PII (only `sha256(email.lower())` stored — never raw email)
- [x] JWT region claim validated (`REGION_RE` allowlist in `database.py`; `user_id` checked in every regional query)
- [ ] Cross-region admin queries prohibited in production tooling
- [ ] Database backups stored in same-region S3 buckets only

---

*This document was authored as a definitive architectural decision record for buddy-app. Revisit if the conditions in the checklist change materially. The recommendation is PostgreSQL/Aurora.*
