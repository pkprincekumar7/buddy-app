# Global Routing & Data Residency Architecture — PostgreSQL / Amazon Aurora

> **Related documents**
> - [`GLOBAL_ROUTING_MONGO.md`](./GLOBAL_ROUTING_MONGO.md) — MongoDB Atlas Global Clusters approach
> - [`GLOBAL_ROUTING_COMPARISON.md`](./GLOBAL_ROUTING_COMPARISON.md) — Full comparison and final recommendation

## Overview

Many countries legally require that their residents' personal data be stored
**within their own borders** (or in approved equivalent jurisdictions). This
document describes how buddy-app handles this requirement through a
**Regional Database Sharding** pattern, where each user's data lives entirely
inside their assigned region and never crosses into another region's database.

Relevant laws include (but are not limited to):

| Law | Jurisdiction | Key Requirement |
|-----|-------------|-----------------|
| **GDPR** | EU + EEA + UK | Store EU residents' data in EU or adequacy-approved countries; SCCs required for outbound transfers |
| **PIPL** | China | Chinese users' data must stay in mainland China; security assessment required for outbound transfers |
| **Russia FZ-242** | Russia | Russian citizens' data must be initially collected and stored in Russia |
| **India DPDP 2023** | India | Certain data categories restricted; cross-border rules still being finalised |
| **Saudi Arabia PDPL** | Saudi Arabia | Personal data must stay in KSA unless recipient country has equivalent protection |
| **Brazil LGPD** | Brazil | International transfers require adequacy decision or appropriate safeguards |
| **Thailand PDPA** | Thailand | Cross-border transfers need adequate protection; Controller must ensure compliance |

---

## Architecture

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        NO RESIDENCY RESTRICTION                               ║
║                    (contains zero personal data)                              ║
║                                                                               ║
║  ┌──────────────────────────┐      ┌──────────────────────────────────────┐  ║
║  │     Global Router DB     │      │         Global Content DB            │  ║
║  │                          │      │                                      │  ║
║  │  email_hash → region     │      │  growth_area_definitions             │  ║
║  │  user_id    → region     │      │  mission_templates                   │  ║
║  │                          │      │  personality_catalogue               │  ║
║  │  Hit at login only       │      │  feature_flags / app_config          │  ║
║  └────────────┬─────────────┘      └──────────────────┬───────────────────┘  ║
║               │ lookup at login                        │ replicated via       ║
╚═══════════════╪════════════════════════════════════════╪═════════════════════╝
                │                                        │ logical replication
                │              ┌─────────────────────────┤
                │              │                         │
       ╔════════╪══════════════╪═════════════════════════╪══════════════════╗
       ║        │   RESIDENCY RESTRICTED (PII)            │                  ║
       ║        │   Must stay within the border           │                  ║
       ║        │                                         ▼ (to each cluster)║
       ║   ┌────▼────────────────┐  ┌─────────────────────────┐  ┌───────┐  ║
       ║   │    EU Cluster       │  │      APAC Cluster        │  │  ...  │  ║
       ║   │  (Frankfurt/Ireland)│  │  (Singapore/Tokyo/Mumbai)│  │       │  ║
       ║   │                     │  │                          │  │       │  ║
       ║   │  users              │  │  users                   │  │       │  ║
       ║   │  refresh_tokens     │  │  refresh_tokens          │  │       │  ║
       ║   │  user_preferences   │  │  user_preferences        │  │       │  ║
       ║   │  user_onboarding    │  │  user_onboarding         │  │       │  ║
       ║   │  user_personality   │  │  user_personality        │  │       │  ║
       ║   │  user_journey       │  │  user_journey            │  │       │  ║
       ║   │  user_goals         │  │  user_goals              │  │       │  ║
       ║   │  completed_growth.. │  │  completed_growth..      │  │       │  ║
       ║   │  children           │  │  children                │  │       │  ║
       ║   │  growth_missions    │  │  growth_missions         │  │       │  ║
       ║   │  ─────────────────  │  │  ──────────────────────  │  │       │  ║
       ║   │  content.*  (copy)  │  │  content.*  (copy)       │  │       │  ║
       ║   └─────────────────────┘  └──────────────────────────┘  └───────┘  ║
       ╚═══════════════════════════════════════════════════════════════════════╝
```

### What each component is

| Component | Instance count | Contains PII? | Residency law applies? |
|-----------|---------------|---------------|----------------------|
| Global Router DB | 1 (anywhere) | No — only `sha256(email)` + region code | No |
| Global Content DB | 1 (anywhere) | No — product catalogue, templates, config | No |
| Regional Cluster | 1 per region | Yes — all user and child data | Yes — data must stay in region |
| `content.*` schema | Inside each regional cluster | No — read-only replica of Global Content DB | No |

### Why this works

All personal data in buddy-app is **user-isolated** — User A's data never
touches User B's data. This makes regional partitioning clean: assign each user
to a region at registration and keep all their data there permanently.

The Global Content DB and Global Router DB contain **no personal data**, so no
residency law restricts where they live or whether they can be replicated. The
`content.*` schema inside each regional cluster is not a separate instance — it
is a synchronised shadow of the Global Content DB, replicated via PostgreSQL
logical replication, kept inside the regional cluster so that JOINs between
content and user data are fully local (no cross-instance query needed).

---

## Components

### 1. Global Router DB

A single, lightweight PostgreSQL instance (can be a small RDS instance or
equivalent). It stores **zero personal data** — only the routing key:

```
sha256(email.lower()) → region_code
user_id               → region_code
```

Because this table contains no PII, no data residency law applies to it.

**Schema (`user_regions` table):**

```python
class UserRegionRecord(Base):
    __tablename__ = "user_regions"

    email_hash = Column(String(64), primary_key=True)   # sha256(email.lower())
    user_id    = Column(String(36), unique=True, index=True)
    region     = Column(String(16))                     # "eu", "apac", "us", etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Tombstone: True only while account deletion is in progress.
    # Blocks concurrent re-registration of the same email during the deletion window.
    is_deleted = Column(Boolean, nullable=False, default=False, server_default="false")
```

### 2. Regional Clusters

Each region runs the **full buddy-app schema** (all 11 tables) in an isolated
PostgreSQL cluster. No data is replicated between regional clusters.

Recommended cluster groupings:

| Region Code | Suggested Cloud Location | Jurisdictions Covered |
|-------------|-------------------------|-----------------------|
| `eu` | AWS eu-central-1 (Frankfurt) or eu-west-1 (Ireland) | GDPR: EU, EEA, UK |
| `us` | AWS us-east-1 or us-west-2 | USA (CCPA; no federal residency law yet) |
| `apac` | AWS ap-southeast-1 (Singapore) or ap-northeast-1 (Tokyo) | SEA, Japan, Australia |
| `in` | AWS ap-south-1 (Mumbai) | India DPDP |
| `me` | AWS me-south-1 (Bahrain) or me-central-1 (UAE) | Saudi PDPL, UAE DIFC |
| `cn` | China-based ICP-licensed provider | PIPL — see note below |
| `br` | AWS sa-east-1 (São Paulo) | Brazil LGPD |

> **China note:** PIPL is the strictest law on this list. Serving Chinese users
> requires a mainland China ICP licence, a local legal entity, and infrastructure
> entirely within China. Treat `cn` as a separate deployment project rather than
> just another cluster.

### 3. JWT Region Claim

After login, the region is embedded in the JWT so every subsequent request
routes to the correct regional DB **without any additional lookup**:

```json
{
  "sub": "<user_id>",
  "region": "eu",
  "type": "access",
  "exp": 1234567890
}
```

The global router DB is only hit **once per login** — never on hot paths.

---

## Request Flows

### Registration

```
Client                  API                 Global Router DB       Regional DB (eu)
  │                      │                        │                       │
  │─── POST /register ──▶│                        │                       │
  │   (country: "DE")    │                        │                       │
  │                      │── detect region ──────▶│                       │
  │                      │   (country → "eu")     │                       │
  │                      │                        │                       │
  │                      │── INSERT email_hash,   │                       │
  │                      │   user_id, "eu" ──────▶│                       │
  │                      │                        │                       │
  │                      │── CREATE User, ────────┼──────────────────────▶│
  │                      │   OnboardingRecord,    │                       │
  │                      │   etc. (EU DB only)    │                       │
  │◀─── JWT (region:eu) ─│                        │                       │
```

### Login (two-phase)

```
Client                  API                 Global Router DB       Regional DB (eu)
  │                      │                        │                       │
  │─── POST /login ─────▶│                        │                       │
  │                      │── lookup email_hash ──▶│                       │
  │                      │◀─── region: "eu" ──────│                       │
  │                      │                        │                       │
  │                      │── authenticate user ───┼──────────────────────▶│
  │                      │◀─── user record ───────┼───────────────────────│
  │◀─── JWT (region:eu) ─│                        │                       │
```

### All Subsequent Requests (hot path — no global router involved)

```
Client                  API                              Regional DB (eu)
  │                      │                                      │
  │─── GET /user/goals ─▶│                                      │
  │   Authorization: JWT │                                      │
  │   (region: "eu")     │── decode JWT → region = "eu" ───────▶│
  │                      │── query EU DB only ─────────────────▶│
  │◀─── goals payload ───│                                      │
```

---

## Code Implementation Guide

### `settings.py` — Regional DB URLs

```python
class Settings(BaseSettings):
    # Existing single DB URL kept for local dev / single-region fallback
    database_url: str = "sqlite:///./dev.db"

    # Regional DB URLs (set via environment variables per deployment)
    regional_db_urls: dict[str, str] = {
        "eu":   "postgresql://...",
        "us":   "postgresql://...",
        "apac": "postgresql://...",
        "in":   "postgresql://...",
        "me":   "postgresql://...",
        "br":   "postgresql://...",
    }

    # Global router DB URL
    router_db_url: str = "postgresql://..."
```

### `database.py` — Regional Connection Pools

```python
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REGIONAL_ENGINES: dict[str, Engine] = {}

def get_engine_for_region(region: str) -> Engine:
    if region not in REGIONAL_ENGINES:
        url = settings.regional_db_urls[region]
        REGIONAL_ENGINES[region] = create_engine(
            url,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
        )
    return REGIONAL_ENGINES[region]

def get_regional_db(region: str):
    """FastAPI dependency — yields a session bound to the correct regional DB."""
    engine = get_engine_for_region(region)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

### `auth.py` — Register: assign region, write to both DBs

```python
import hashlib

@router.post("/auth/register")
async def register(data: RegisterRequest, request: Request, ...):
    # 1. Determine region from user's explicit country selection
    region = _resolve_region(data.country_code)   # e.g. "DE" → "eu"

    # 2. Write routing record (no PII)
    email_hash = hashlib.sha256(data.email.lower().encode()).hexdigest()
    router_db.add(UserRegionRecord(
        email_hash=email_hash,
        user_id=new_user_id,
        region=region,
    ))
    router_db.commit()

    # 3. Write all personal data to regional DB only
    regional_db = next(get_regional_db(region))
    regional_db.add(User(id=new_user_id, email=data.email, ...))
    regional_db.commit()

    # 4. Issue JWT with region claim
    access_token = _create_access_token(user_id=new_user_id, region=region)
    ...
```

### `auth.py` — Login: two-phase lookup

```python
@router.post("/auth/login")
async def login(data: LoginRequest, ...):
    # Phase 1: resolve region from global router (no PII lookup)
    email_hash = hashlib.sha256(data.email.lower().encode()).hexdigest()
    route = router_db.get(UserRegionRecord, email_hash)
    if not route:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Phase 2: authenticate against the correct regional DB
    regional_db = next(get_regional_db(route.region))
    user = regional_db.execute(
        select(User).where(User.email == data.email)
    ).scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Issue JWT with region embedded
    access_token = _create_access_token(user_id=user.id, region=route.region)
    ...
```

### `auth.py` — JWT token creation

```python
def create_access_token(sub: str, region: str = "local", extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub":    sub,
        "iat":    now,          # required — used by token-revocation check in get_current_user
        "exp":    now + timedelta(minutes=settings.jwt_access_expire_minutes),
        "type":   "access",
        "region": region,       # ← routes every hot-path request without a DB lookup
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
```

### Protected route dependency — extract region from JWT

```python
def get_current_user_region(
    token: str = Depends(oauth2_scheme),
) -> tuple[str, str]:
    """Returns (user_id, region) from a validated JWT."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    return payload["sub"], payload["region"]

# Usage in any router:
@router.get("/user/goals")
async def get_goals(
    identity: tuple = Depends(get_current_user_region),
):
    user_id, region = identity
    db = next(get_regional_db(region))
    ...
```

---

## Region Detection at Signup

The user **explicitly selects their country** during registration. This is the
only method used. It is the strongest signal for compliance — regulators and
courts treat explicit user declaration as consent, which is unambiguous and
auditable. GeoIP inference and browser headers are not used.

The registration form presents a country dropdown. The selected country code
is submitted as part of the registration payload and mapped to a region via
`_resolve_region()`.

```python
COUNTRY_TO_REGION: dict[str, str] = {
    # EU / EEA / UK
    "AT": "eu", "BE": "eu", "BG": "eu", "CY": "eu", "CZ": "eu",
    "DE": "eu", "DK": "eu", "EE": "eu", "ES": "eu", "FI": "eu",
    "FR": "eu", "GR": "eu", "HR": "eu", "HU": "eu", "IE": "eu",
    "IT": "eu", "LT": "eu", "LU": "eu", "LV": "eu", "MT": "eu",
    "NL": "eu", "PL": "eu", "PT": "eu", "RO": "eu", "SE": "eu",
    "SI": "eu", "SK": "eu", "GB": "eu", "NO": "eu", "IS": "eu", "LI": "eu",
    # Americas
    "US": "us", "CA": "us", "MX": "us",
    "BR": "br",
    # Asia-Pacific
    "SG": "apac", "MY": "apac", "ID": "apac", "PH": "apac", "TH": "apac",
    "VN": "apac", "JP": "apac", "KR": "apac", "AU": "apac", "NZ": "apac",
    # India
    "IN": "in",
    # Middle East
    "SA": "me", "AE": "me", "QA": "me", "KW": "me", "BH": "me", "OM": "me",
    # China — requires dedicated deployment
    "CN": "cn",
    # Default fallback
}

def _resolve_region(country_code: str) -> str:
    return COUNTRY_TO_REGION.get(country_code.upper(), "us")
```

The selected country code is also stored on the `User` record in the regional
DB (`country_code` column) so it can be referenced for support, auditing, and
GDPR Article 30 Records of Processing Activities.

---

## Global / Shared Data

Some data has no user affiliation and must be readable from every region —
for example:

| Data type | Examples in buddy-app |
|-----------|----------------------|
| Reference / catalogue data | Growth area definitions, mission templates, personality type catalogue, activity libraries |
| App configuration | Feature flags, LLM prompt templates, supported languages |
| System metadata | App version, maintenance windows |

This data contains **no PII**, so no residency law restricts where it lives.
The architecture handles it with a dedicated **Global Content DB** — a separate
instance from both the Global Router DB and all regional clusters.

### How it fits into the main architecture

The Global Content DB is the second non-PII component alongside the Global
Router DB. Both sit outside any residency boundary. The `content.*` schema
inside each regional cluster is a local replica of the Global Content DB —
not a separate instance — kept in sync via logical replication so that JOINs
between content and user data are fully local.

See the main architecture diagram at the top of this document for the full
picture.

### What belongs in the Global Content DB vs regional clusters

| Belongs in Global Content DB | Belongs in regional cluster |
|-----------------------------|----------------------------|
| Growth area definitions | User's completed growth areas + answers |
| Mission template library | User's assigned/completed missions |
| Personality type catalogue | User's personality record |
| LLM prompt templates | User's goals, preferences, onboarding state |
| Feature flags | Child records |
| App config / copy | Refresh tokens |

The rule is simple: **if the row can identify or describe a real person, it
belongs in a regional cluster. If it exists independently of any user, it
belongs in the Global Content DB.**

### Connection setup

> **Implementation status:** `global_content_db_url` and `get_content_db()` are
> **not yet implemented** in `settings.py` or `database.py`. The Global Content DB
> is a Phase 2 infrastructure item. Add these when provisioning the content DB.

```python
# settings.py — add when provisioning the Global Content DB
class Settings(BaseSettings):
    ...
    content_db_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("CONTENT_DB_URL", "content_db_url"),
    )

# database.py — add alongside get_router_db()
def get_content_db():
    """FastAPI dependency — session to Global Content DB (or main DB as fallback)."""
    url = settings.content_db_url
    eng = _cached_engine(url) if url else engine
    session = _make_session(eng)()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
```

### Usage in a route — mixing regional + global data

A typical request that needs both a user's progress (regional) and the full
activity catalogue (global) looks like this:

```python
@router.get("/growth-areas/catalogue")
async def get_growth_areas(
    identity: tuple = Depends(get_current_user_region),
    content_db: Session = Depends(get_content_db),
):
    user_id, region = identity
    regional_db = next(get_regional_db(region))

    # User's completed areas — from regional DB (PII)
    completed = regional_db.execute(
        select(CompletedGrowthAreaRecord).where(
            CompletedGrowthAreaRecord.user_id == user_id
        )
    ).scalars().all()

    # Full catalogue — from Global Content DB (no PII)
    catalogue = content_db.execute(
        select(GrowthAreaDefinition)
    ).scalars().all()

    return _merge(catalogue, completed)
```

### Writes to the Global Content DB

Application code **never writes** to the Global Content DB directly. All
content updates go through an internal admin pipeline (e.g. a separate admin
API, a migration script, or a CMS). This keeps the content DB read-only from
the perspective of user-facing requests.

For feature flags that need near-real-time rollout, consider a dedicated
feature flag service (LaunchDarkly, Unleash, or a simple Redis key) rather than
polling the content DB on every request.

### Alembic for the Global Content DB

No separate Alembic config file is needed. Reuse the standard config with a
`CONTENT_DB_URL` override:

```bash
# Run once globally during deploy — not per region
DATABASE_URL=$CONTENT_DB_URL alembic upgrade head
```

Add this step to `entrypoint.sh` alongside the router DB migration block (see
[`GLOBAL_ROUTING_SETUP.md`](./GLOBAL_ROUTING_SETUP.md)).

---

## Joining Global Content Data with Regional User Data

Standard SQL `JOIN` syntax **cannot span two separate database instances**. The
Global Content DB and a regional cluster are two different PostgreSQL servers —
the query planner of one has no visibility into the other. However, there are
three patterns that solve this at different levels of complexity. A fourth
approach — already present in the current schema — often makes the join
unnecessary altogether.

---

### Pattern 0 — Denormalisation (already in the schema, use first)

Before reaching for a cross-DB join strategy, check whether the join is
actually needed. The current schema already stores copies of content attributes
directly in user-data rows:

```
completed_growth_areas
  area_id      ← FK to content catalogue (logical, not enforced)
  area_name    ← copy of content.name    ← already here
  area_color   ← copy of content.color   ← already here
```

When a user completes a growth area, the write path copies the relevant display
fields from the content catalogue into the regional row at write time. Reads
never need to go back to the content DB for those fields.

**When to use:** For display fields that are stable (names, colours, icons).
Write the content value into the regional row at the moment of user action.

**When it breaks down:** If the content definition changes after the user
record is written (e.g. you rename a growth area), the regional copy becomes
stale. Acceptable for display labels; not acceptable for business logic fields.

---

### Pattern 1 — Application-level merge (simplest, recommended default)

Fetch from both databases independently in the Python layer and merge the
results in memory. This is explicit, debuggable, and already shown in the
existing route example.

```
API handler
  │
  ├── query regional DB  →  [user rows with area_id, ...]
  │
  ├── query content DB   →  [catalogue rows keyed by area_id]
  │
  └── merge in Python    →  combined response payload
```

```python
@router.get("/growth-areas/summary")
async def growth_area_summary(
    identity: tuple = Depends(get_current_user_region),
    content_db: Session = Depends(get_content_db),
):
    user_id, region = identity
    regional_db = next(get_regional_db(region))

    # 1. Pull user records from regional DB
    completed = regional_db.execute(
        select(CompletedGrowthAreaRecord)
        .where(CompletedGrowthAreaRecord.user_id == user_id)
    ).scalars().all()

    # 2. Pull only the matching catalogue rows (avoid full table scan)
    area_ids = [r.area_id for r in completed]
    definitions = content_db.execute(
        select(GrowthAreaDefinition)
        .where(GrowthAreaDefinition.id.in_(area_ids))
    ).scalars().all()

    # 3. Merge in Python — O(n) with a lookup dict
    def_map = {d.id: d for d in definitions}
    return [
        {
            **row.__dict__,
            "description":  def_map[row.area_id].description,
            "icon_url":     def_map[row.area_id].icon_url,
            "display_order": def_map[row.area_id].display_order,
        }
        for row in completed
        if row.area_id in def_map
    ]
```

**Pros:**
- Zero infrastructure change
- Fully transparent — easy to trace, test, and debug
- Each query is independently optimised by its own DB

**Cons:**
- Two network round trips per request (regional DB + content DB)
- Cannot push `WHERE`, `ORDER BY`, or `LIMIT` that span both datasets down to
  the DB — filtering must happen in Python after both fetches
- Aggregations across both datasets (e.g. `COUNT` grouped by content category)
  require pulling raw data and aggregating in Python

**Use when:** The result set is small-to-medium (up to a few hundred rows
after filtering), or when the joined fields are only needed for display
enrichment after the main query is already filtered.

---

### Pattern 2 — PostgreSQL Foreign Data Wrapper (FDW)

PostgreSQL's built-in `postgres_fdw` extension lets you mount a remote
PostgreSQL table as a **foreign table** inside a local database. Once mounted,
you can write a native `JOIN` in SQL and the local query planner handles the
remote fetch transparently.

#### Setup (run once per regional cluster)

```sql
-- On each regional cluster (e.g. EU cluster)

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Register the Global Content DB as a foreign server
CREATE SERVER global_content_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'content-db.internal', port '5432', dbname 'buddy_content');

-- Map the regional DB user to the content DB user
CREATE USER MAPPING FOR regional_app_user
  SERVER global_content_server
  OPTIONS (user 'content_reader', password '...');

-- Create a local schema to hold the foreign tables
CREATE SCHEMA global_content;

-- Import all tables from the content DB into the local schema
IMPORT FOREIGN SCHEMA public
  FROM SERVER global_content_server
  INTO global_content;
```

#### Querying with a native JOIN

```python
# SQLAlchemy — reflect the foreign table into the ORM
from sqlalchemy import Table, MetaData

content_meta = MetaData(schema="global_content")
GrowthAreaForeign = Table(
    "growth_area_definitions", content_meta, autoload_with=regional_engine
)

# Now JOIN works inside a single regional DB session
stmt = (
    select(
        CompletedGrowthAreaRecord,
        GrowthAreaForeign.c.description,
        GrowthAreaForeign.c.icon_url,
    )
    .join(
        GrowthAreaForeign,
        CompletedGrowthAreaRecord.area_id == GrowthAreaForeign.c.id
    )
    .where(CompletedGrowthAreaRecord.user_id == user_id)
)
rows = regional_db.execute(stmt).all()
```

**Pros:**
- Native SQL `JOIN` — filtering, ordering, aggregations all work across both
  datasets in a single query
- No application-layer merge code
- Can push `WHERE` clauses to the remote server (predicate pushdown), reducing
  data transferred

**Cons:**
- The Global Content DB becomes a **live dependency** of every regional cluster.
  If the content DB is slow or unreachable, all regional queries that touch
  foreign tables fail or slow down
- FDW queries are slower than local joins — each cross-server join involves a
  network call during query execution
- Query planner statistics for foreign tables are approximate; plans can be
  suboptimal
- Connection overhead: each regional cluster opens connections to the content DB
  (multiplied across all regions)

**Use when:** You need true server-side filtering and aggregation across both
datasets and the result set or filtering logic makes application-level merge
impractical.

---

### Pattern 3 — Replicated content schema inside each regional cluster
                  (recommended for high-frequency joins)

Copy the Global Content DB tables into a dedicated `content` schema inside
**each** regional cluster. JOINs become fully local — same DB, same query
planner, no network calls.

```
Global Content DB          EU Regional Cluster
──────────────────         ──────────────────────────────────────
growth_area_definitions ──► content.growth_area_definitions (copy)
mission_templates       ──► content.mission_templates       (copy)
personality_catalogue   ──► content.personality_catalogue   (copy)
```

#### Sync mechanism

Use PostgreSQL **logical replication** to keep regional copies up to date:

```sql
-- On Global Content DB: create a publication
CREATE PUBLICATION buddy_content_pub
  FOR TABLE growth_area_definitions, mission_templates, personality_catalogue;

-- On each regional cluster: subscribe to it
CREATE SUBSCRIPTION buddy_content_sub_eu
  CONNECTION 'host=content-db.internal dbname=buddy_content user=replication_user'
  PUBLICATION buddy_content_pub;
```

Changes made to the content DB replicate to all regional clusters with
typically sub-second lag. For content that changes rarely (growth area
definitions, personality types), a periodic ETL (e.g. nightly) is also
sufficient and simpler to operate.

#### Querying

```python
# No FDW, no cross-DB call — pure local JOIN
stmt = (
    select(
        CompletedGrowthAreaRecord,
        GrowthAreaDefinition,   # ← mapped to content.growth_area_definitions
    )
    .join(
        GrowthAreaDefinition,
        CompletedGrowthAreaRecord.area_id == GrowthAreaDefinition.id
    )
    .where(CompletedGrowthAreaRecord.user_id == user_id)
    .order_by(GrowthAreaDefinition.display_order)
)
```

**Pros:**
- Full native SQL JOIN performance — same as joining two tables in a single DB
- No runtime dependency on the Global Content DB for reads
- Complex aggregations, window functions, and `ORDER BY` across both datasets
  all work at full speed
- Regional cluster remains fully functional even if the content DB is down

**Cons:**
- Storage duplication across all regional clusters (acceptable — content tables
  are small)
- Slight eventual consistency window during replication (typically < 1 second
  for logical replication)
- Content writes must go through the Global Content DB, never directly into a
  regional `content` schema
- One more operational component (logical replication slots) to monitor

**Use when:** Joins between content and user data are frequent (e.g. every
dashboard load), you need complex server-side filtering across both, or you
cannot tolerate the FDW latency/availability dependency.

---

### Comparison summary

| | Pattern 0 | Pattern 1 | Pattern 2 | Pattern 3 |
|---|---|---|---|---|
| **Mechanism** | Denormalise at write time | App-layer merge | PostgreSQL FDW | Local content replica |
| **SQL JOIN** | Not needed | No | Yes | Yes |
| **Join performance** | N/A — no join | Python loop | Network-bound | Full local speed |
| **Server-side filter across both** | N/A | No | Yes | Yes |
| **Infra complexity** | None | None | FDW setup per cluster | Logical replication |
| **Content DB availability dependency** | None at read time | At read time | At read time (hard) | Only at write time |
| **Consistency** | Stale if content changes | Always fresh | Always fresh | ~sub-second lag |
| **Best for** | Stable display fields | Small result sets, enrichment | Medium complexity, occasional joins | High-frequency joins, aggregations |

---

### Recommendation for buddy-app

Apply the patterns in this order of preference:

1. **Pattern 0 first** — The current schema already denormalises `area_name`
   and `area_color` into `completed_growth_areas`. Extend this for any new
   content fields that are stable display attributes (icons, short labels).

2. **Pattern 1 as the default** — For all enrichment queries where the user
   result set is already filtered before enrichment (e.g. load 5–20 completed
   growth areas for one user, then enrich with descriptions). Two round trips
   at this scale are negligible.

3. **Pattern 3 when you need server-side aggregations** — For example, a future
   analytics dashboard that counts completed missions grouped by content
   category across all users in a region. Set up logical replication from the
   Global Content DB into a `content` schema on each regional cluster.

4. **Avoid Pattern 2 (FDW) in production hot paths** — FDW is useful for
   ad-hoc admin queries and backfill scripts, but the live runtime dependency on
   the content DB makes it unsuitable for user-facing request paths.

---

## Alembic Migrations Across Regions

Migrations are run automatically at container startup via `entrypoint.sh` — see
[`GLOBAL_ROUTING_SETUP.md`](./GLOBAL_ROUTING_SETUP.md) for the full flow. The
single `alembic` config (no separate `alembic_router.ini`) is reused for both the
regional DB and the router DB by overriding `DATABASE_URL`:

```bash
# Container startup (entrypoint.sh pattern)
alembic upgrade head                           # regional tables (uses DATABASE_URL)
DATABASE_URL=$ROUTER_DB_URL alembic upgrade head  # router tables (same migrations, different target)
```

For CI/CD pipelines that prefer running migrations before deploying containers:

```bash
# Run per regional cluster
DATABASE_URL=$EU_DB_URL   alembic upgrade head
DATABASE_URL=$US_DB_URL   alembic upgrade head
DATABASE_URL=$APAC_DB_URL alembic upgrade head
DATABASE_URL=$IN_DB_URL   alembic upgrade head

# Global router DB — same alembic config, different target URL
DATABASE_URL=$ROUTER_DB_URL alembic upgrade head
```

> **Note:** There is no separate `alembic_router.ini`. The router DB runs the
> same migration set as regional clusters; extra tables on the router DB are
> inert and harmless.

---

## LLM Rate Limiter — Redis Implementation

The LLM rate limiter is implemented in `backend/app/llm_rate_limiter.py` as a
Redis-backed sliding window counter (ZSET + Lua script for atomic TOCTOU-safe
enforcement). When `REDIS_URL` is not set it falls back to an in-process counter,
which is correct for single-instance local dev but breaks under multiple pods.

**Deployment requirement:** Set `REDIS_URL` to an ElastiCache (or equivalent)
endpoint in every regional ECS task definition before multi-region launch. Deploy
one Redis instance per regional cluster so rate-limit state stays within the
region and does not introduce cross-region latency.

---

## Implementation Checklist

### Phase 0 — Do today (zero infra cost, prevents future pain)

- [x] Add `region` field to JWT payload (`create_access_token` in `auth_utils.py`)
- [x] Add `region` + `is_deleted` fields to `UserRegionRecord` model (`models.py`)
- [x] Add `COUNTRY_TO_REGION` mapping (`routing.py`)
- [x] Add `country_code` column to `User` model (`models.py`)
- [ ] Add country selector to registration UI (frontend — not yet done)

### Phase 1 — First multi-region deployment

- [ ] Provision EU and US clusters (separate PostgreSQL instances)
- [ ] Provision global router DB instance
- [ ] Provision Global Content DB instance; seed with growth area definitions, mission templates, personality catalogue
- [ ] Implement `get_regional_db()` connection pool router in `database.py`
- [ ] Implement `get_content_db()` connection to Global Content DB in `database.py`
- [ ] Update register endpoint: write to router DB + regional DB
- [ ] Update login endpoint: two-phase lookup
- [ ] Update all protected routes: extract region from JWT
- [ ] Update routes that serve catalogue/reference data to read from Global Content DB
- [ ] Update CI/CD or `entrypoint.sh`: run `alembic upgrade head` per regional cluster on deploy
- [ ] Update CI/CD: run `DATABASE_URL=$CONTENT_DB_URL alembic upgrade head` once globally on deploy

### Phase 2 — Full compliance rollout

- [ ] Add remaining regional clusters (APAC, IN, ME, BR)
- [x] Replace in-memory rate limiter with Redis (one Redis per region)
- [ ] Add monitoring/alerting: detect if any user data row appears in the wrong regional DB
- [ ] Legal review: confirm adequacy decisions / SCCs for each active region pair
- [ ] Privacy policy update: document where each user's data is stored by region

### Phase 3 — China (PIPL — treat as separate project)

- [ ] Engage local legal counsel for ICP licence requirements
- [ ] Set up dedicated China infrastructure (not an AWS standard region)
- [ ] Implement `cn` region with fully isolated deployment pipeline
- [ ] Security assessment for any cross-border data transfer

---

## Security Considerations

- **The global router DB must not log full email addresses** — only `email_hash`
  is stored. Configure your DB/proxy query logs accordingly.
- **JWT region claim must be validated** — always verify the JWT signature before
  trusting the region claim. A tampered JWT with `"region": "us"` targeting a
  different user's data in the US cluster must be rejected by the `user_id` check
  in each query.
- **No cross-region admin queries** — internal tooling and support dashboards
  must enforce the same regional boundaries. An admin console must require the
  operator to select a region before querying.
- **Backup isolation** — database backups must be stored in the same geographic
  region as the primary cluster (e.g. EU DB backups in EU-region S3 buckets only).
- **Audit logging** — maintain an audit log per region of who accessed what data
  and when. This is required for GDPR Article 30 Records of Processing Activities.
