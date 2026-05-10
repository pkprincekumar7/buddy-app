# Global Routing & Data Residency Architecture — MongoDB Atlas Global Clusters

> **Related documents**
> - [`GLOBAL_ROUTING_AURORA.md`](./GLOBAL_ROUTING_AURORA.md) — PostgreSQL / Amazon Aurora approach
> - [`GLOBAL_ROUTING_COMPARISON.md`](./GLOBAL_ROUTING_COMPARISON.md) — Full comparison and final recommendation

---

## Overview

MongoDB Atlas Global Clusters extends Atlas's managed sharding to enforce
**geographic data residency** at the database level. Rather than provisioning
separate database instances per region (as the PostgreSQL approach does), a
Global Cluster presents a **single connection string** to the application while
internally routing every write and read to a region-specific shard zone. Each
zone is a geographically isolated replica set; Atlas ensures that documents
whose shard key resolves to a given zone are written to — and read from —
nodes physically located in that zone only. Collections that contain no personal
data can be configured as **global collections**, replicated to all zones so
that content reads are always local. The result is a single logical cluster that
simultaneously enforces strict data residency for user PII and provides
low-latency global reads for shared content.

---

## Architecture

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                         NO RESIDENCY RESTRICTION                                 ║
║                     (zero personal data — global collections)                    ║
║                                                                                  ║
║   ┌──────────────────────────────────────────────────────────────────────────┐   ║
║   │                  mongos Router  (Atlas-managed, one connection string)   │   ║
║   │                                                                          │   ║
║   │   Globally replicated collections (available in ALL zones):              │   ║
║   │     • user_lookups          (email_hash → zone + user_id, no PII)        │   ║
║   │     • growth_area_definitions                                             │   ║
║   │     • mission_templates                                                   │   ║
║   │     • personality_catalogue                                               │   ║
║   │     • feature_flags                                                       │   ║
║   └────────────────────────────────────────────────────────────────────────┬─┘   ║
║                                                                            │     ║
╚════════════════════════════════════════════════════════════════════════════╪═════╝
                         shard key routing (zone pinning)                   │
         ┌─────────────────────────────────────────────────────────────────┘
         │
╔════════╪═══════════════════════════════════════════════════════════════════════╗
║        │   RESIDENCY RESTRICTED (PII)                                          ║
║        │   Zone-sharded collections — each document pinned to one zone         ║
║        │                                                                        ║
║        ▼                                                                        ║
║  ┌─────────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐ ║
║  │      EU Zone        │  │      APAC Zone        │  │        US Zone         │ ║
║  │ (Frankfurt/Ireland) │  │ (Singapore/Tokyo/     │  │     (us-east-1 /       │ ║
║  │                     │  │  Mumbai)              │  │      us-west-2)        │ ║
║  │  Replica Set:       │  │  Replica Set:         │  │  Replica Set:          │ ║
║  │  PRIMARY            │  │  PRIMARY              │  │  PRIMARY               │ ║
║  │  SECONDARY (x2)     │  │  SECONDARY (x2)       │  │  SECONDARY (x2)        │ ║
║  │                     │  │                       │  │                        │ ║
║  │  Zone-sharded docs  │  │  Zone-sharded docs    │  │  Zone-sharded docs     │ ║
║  │  (location="eu"):   │  │  (location="apac"):   │  │  (location="us"):      │ ║
║  │  • users            │  │  • users              │  │  • users               │ ║
║  │  • refresh_tokens   │  │  • refresh_tokens     │  │  • refresh_tokens      │ ║
║  │  • children         │  │  • children           │  │  • children            │ ║
║  │  • growth_missions  │  │  • growth_missions    │  │  • growth_missions     │ ║
║  │  • completed_growth │  │  • completed_growth   │  │  • completed_growth    │ ║
║  │    _areas           │  │    _areas             │  │    _areas              │ ║
║  │  • recommendation   │  │  • recommendation     │  │  • recommendation      │ ║
║  │    _progress        │  │    _progress          │  │    _progress           │ ║
║  └─────────────────────┘  └──────────────────────┘  └────────────────────────┘ ║
║                                                                                  ║
║  [ IN Zone: Mumbai ]   [ ME Zone: Bahrain ]   [ BR Zone: São Paulo ]            ║
║  (same structure as above, omitted for brevity)                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

### What each component is

| Component | Contains PII? | Residency law applies? | Lives in |
|-----------|--------------|------------------------|----------|
| `user_lookups` global collection | No — only `sha256(email)` + zone code | No | All zones (replicated) |
| Content global collections | No — product catalogue, templates, config | No | All zones (replicated) |
| Zone-sharded collections | Yes — all user and child data | Yes — docs must stay in their zone | Pinned zone only |

### Why this works

MongoDB's zone sharding enforces residency at the shard key level. Every
document in a zone-sharded collection has a `location` field that is the
leading component of the compound shard key `{ location: 1, _id: 1 }`. Atlas
maps zone tag ranges on that field (e.g. `"eu" <= location <= "eu"`) to zone
replica sets that are physically located within the required jurisdiction. A
document written with `location: "eu"` can never migrate to a shard in another
zone — Atlas's balancer respects zone tag assignments absolutely. Global
collections use a different mechanism: they are replicated to every shard
zone, so reads are always served locally without cross-region hops.

---

## How MongoDB Replaces the PostgreSQL Multi-Instance Setup

| PostgreSQL approach | MongoDB equivalent | Notes |
|--------------------|--------------------|-------|
| Global Router DB (separate PostgreSQL instance, `user_regions` table) | `user_lookups` global collection (replicated to all zones) | Same logical role: email_hash → zone. Atlas replication replaces the separate instance. |
| Global Content DB (separate PostgreSQL instance, schema: growth_area_definitions etc.) | Global collections (`growth_area_definitions`, `mission_templates`, `personality_catalogue`, `feature_flags`) replicated to all zones | Atlas handles replication automatically; no `postgres_fdw` or logical replication slots needed. |
| Regional PostgreSQL clusters (one per region, 11 tables each) | Zone-sharded collections (one document model per entity, pinned to zones) | 7 PostgreSQL user tables collapse into 1 embedded `users` document; separate collections for children, missions, progress, tokens. |
| Alembic migrations per regional cluster | No Alembic — Python startup code creates indexes | `motor` driver's `create_index` calls at application startup replace schema migrations. |
| Logical replication setup for content schema | Atlas built-in global collection replication | No replication slots, publication/subscription setup, or FDW configuration required. |
| `content.*` schema in each regional cluster (replica of Global Content DB) | Atlas automatically serves global collection reads from local zone nodes | The same result — local reads — but Atlas manages it rather than ops. |

---

## Collection Design — Mapping buddy-app Schema to MongoDB

### `users` collection (zone-sharded)

The seven PostgreSQL tables that describe a single user
(`users`, `user_preferences`, `user_onboarding`, `user_personality`,
`user_journey`, `user_goals`, `user_recommendations_progress`) collapse into
**one MongoDB document**. All subdocuments are embedded because they are
always fetched together with the user and never queried in isolation across
multiple users.

**Shard key:** `{ location: 1, _id: 1 }`

**Full document schema:**

```json
{
  "_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "location": "eu",
  "email": "parent@example.com",
  "password_hash": "$argon2id$v=19$...",
  "full_name": "Anna Schmidt",
  "role": "parent",
  "country_code": "DE",
  "created_at": { "$date": "2025-03-01T10:00:00Z" },
  "updated_at": { "$date": "2025-03-01T10:00:00Z" },

  "preferences": {
    "tts_enabled": true,
    "last_visited_path": "/goals-dashboard",
    "updated_at": { "$date": "2025-04-15T08:30:00Z" }
  },

  "onboarding": {
    "phase": 3,
    "child_name": "Max",
    "child_age": 8,
    "child_school": "Grundschule Mitte",
    "child_strengths": ["creativity", "empathy"],
    "child_hobbies": ["drawing", "football"],
    "child_thinking_pattern": "visual",
    "child_communication_style": "expressive",
    "child_energy_level": "high",
    "child_social_behaviour": "collaborative",
    "child_emotional_behaviour": "sensitive"
  },

  "personality": {
    "source": "onboarding_quiz",
    "personality_type": "EXPLORER",
    "profile_name": "The Creative Explorer",
    "category": "divergent",
    "description": "Max thrives on novelty and creative problem-solving...",
    "color": "#FF6B35",
    "scores": { "openness": 88, "conscientiousness": 52, "extraversion": 76 },
    "traits": ["curious", "imaginative", "energetic"],
    "strengths": ["creative thinking", "enthusiasm", "adaptability"],
    "growth_areas": ["focus", "follow-through"],
    "famous_people": ["Leonardo da Vinci", "Richard Feynman"]
  },

  "journey": {
    "overview": "Max is beginning a journey to build focus and self-regulation...",
    "focus_areas": ["focus", "emotional-regulation"],
    "initial_missions": ["mission_001", "mission_042"]
  },

  "goals": {
    "parent_concern": "Max struggles to finish tasks independently at school.",
    "goals_plan": {
      "short_term": ["Complete one task per day without reminders"],
      "long_term": ["Build independent study habit by end of term"]
    }
  }
}
```

> **Design rationale:** Embedding all user subdocuments eliminates seven
> separate SQL queries per profile load. A single `find_one` by `_id` (with
> `location` for zone routing) returns the complete user context. The tradeoff
> — larger documents — is acceptable because these subdocuments are always
> loaded together.

---

### `refresh_tokens` collection (zone-sharded)

Tokens are tied to a user and must reside in the same zone.

**Shard key:** `{ location: 1, user_id: 1 }`

```json
{
  "_id": "jti-uuid-here",
  "location": "eu",
  "user_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "expires_at": { "$date": "2025-04-01T10:00:00Z" }
}
```

---

### `completed_growth_areas` collection (zone-sharded)

`area_id` is promoted to a top-level field (not buried in a nested object)
so that the compound unique index `(user_id, area_id)` can be enforced at the
collection level and upserts work cleanly.

**Shard key:** `{ location: 1, user_id: 1 }`

```json
{
  "_id": "uuid-cga-001",
  "location": "eu",
  "user_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "area_id": "growth_focus_001",
  "area_name": "Focus & Attention",
  "area_color": "#4A90D9",
  "answers": {
    "q1": "Sometimes",
    "q2": "Rarely",
    "q3": "Often"
  },
  "recommendations": ["rec_101", "rec_102", "rec_103"],
  "child_selections": ["rec_101"],
  "child_summary": "Max chose activities he finds exciting and hands-on.",
  "child_strengths": ["creativity", "enthusiasm"],
  "child_suggested": ["rec_102", "rec_103"],
  "completed_at": { "$date": "2025-04-10T14:20:00Z" }
}
```

---

### `children` collection (zone-sharded)

In the PostgreSQL schema, child attributes are stored in a `payload` JSON
blob. In MongoDB, `name`, `age`, `school`, and other queryable fields are
**top-level fields** — not nested inside a payload object. This is critical
for index efficiency: querying `{ "payload.name": "Max" }` cannot use a
standard index in the same way a query on `{ "name": "Max" }` can.

**Shard key:** `{ location: 1, user_id: 1 }`

```json
{
  "_id": "child-uuid-001",
  "location": "eu",
  "user_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "name": "Max",
  "age": 8,
  "school": "Grundschule Mitte",
  "year_group": "Year 3",
  "additional_needs": ["dyslexia"],
  "avatar_url": "/avatars/explorer.png",
  "created_at": { "$date": "2025-03-01T10:05:00Z" },
  "updated_at": { "$date": "2025-04-01T09:00:00Z" }
}
```

> **Why not a payload blob?** A JSON blob stored as a single field is opaque
> to the query planner. You cannot index inside it without a sparse or
> wildcard index, and you cannot use range queries on `age` or filter by
> `school` efficiently. Top-level fields are first-class citizens in
> MongoDB's index and aggregation pipeline.

---

### `growth_missions` collection (zone-sharded)

Same principle as `children`: `status`, `mission_type`, and `due_date` are
top-level fields, not inside a payload blob.

**Shard key:** `{ location: 1, child_id: 1 }`

```json
{
  "_id": "mission-uuid-001",
  "location": "eu",
  "child_id": "child-uuid-001",
  "user_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "mission_type": "focus_challenge",
  "template_id": "mission_template_042",
  "title": "5-minute focus block",
  "description": "Set a timer and complete one small task without stopping.",
  "status": "active",
  "due_date": { "$date": "2025-05-15T00:00:00Z" },
  "completed_at": null,
  "assigned_at": { "$date": "2025-05-01T10:00:00Z" }
}
```

---

### `recommendation_progress` collection (zone-sharded)

The PostgreSQL `user_recommendations_progress` table stores the entire progress
state as one JSON blob per user. This is a **normalisation problem** — the blob
becomes a complex state machine that is difficult to query, index, or update
atomically for individual recommendations.

MongoDB's document model allows a better design: **one document per
recommendation per user**. This makes per-recommendation status queries,
bulk status updates, and aggregations trivial.

**Shard key:** `{ location: 1, user_id: 1 }`

```json
{
  "_id": "rp-uuid-001",
  "location": "eu",
  "user_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "recommendation_id": "rec_101",
  "area_id": "growth_focus_001",
  "status": "completed",
  "seen_at": { "$date": "2025-04-10T14:30:00Z" },
  "skipped_at": null,
  "completed_at": { "$date": "2025-04-12T09:15:00Z" }
}
```

Valid `status` values: `unseen` | `seen` | `skipped` | `completed`

> **Why one document per recommendation?** With the blob approach, updating
> a single recommendation's status requires reading the full blob, deserializing
> it, mutating one key, and writing the whole blob back — a read-modify-write
> pattern that is error-prone under concurrent access. One document per
> recommendation means each status update is a targeted `update_one` with no
> read step.

---

### Global collections (replicated to all zones)

These collections contain no PII and are replicated to every zone so reads
are always local.

| Collection | Purpose | Write path |
|------------|---------|------------|
| `user_lookups` | `email_hash → { zone, user_id }`. Hit at registration and login only. | Admin registration flow only |
| `growth_area_definitions` | Catalogue of growth areas (id, name, color, description, icon_url, display_order) | Internal admin pipeline |
| `mission_templates` | Library of mission templates (id, type, title, description, difficulty) | Internal admin pipeline |
| `personality_catalogue` | Personality types (id, type_code, profile_name, description, traits, etc.) | Internal admin pipeline |
| `feature_flags` | App-wide feature toggles (flag_name, enabled, rollout_pct, regions) | Internal admin pipeline |

```json
// user_lookups document
{
  "_id": "sha256:9f86d081884c7d659a2fe...",
  "zone": "eu",
  "user_id": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "status": "active",
  "created_at": { "$date": "2025-03-01T10:00:00Z" }
}
```

---

## Zone / Shard Key Configuration

### Why `location` must be the leading shard key field

MongoDB's zone balancer pins documents to zones based on **shard key ranges**.
For zone pinning to work, the zone discriminator (`location`) must be the
**leftmost** component of the compound shard key. If `_id` led the key, the
hash distribution of UUIDs would scatter documents across all shards regardless
of zone, making residency enforcement impossible. With `location` leading, all
documents for `"eu"` fall into a contiguous key-space range that is assigned
exclusively to the EU zone replica set.

### JavaScript configuration (run against mongos)

```javascript
// Connect to mongos (Atlas connection string)
// Run these commands once during cluster provisioning

// ── 1. Enable sharding on the database ──────────────────────────────────────
sh.enableSharding("buddy");

// ── 2. Shard user-data collections ──────────────────────────────────────────
// users: compound key { location, _id }
sh.shardCollection("buddy.users", { location: 1, _id: 1 });

// refresh_tokens: compound key { location, user_id }
sh.shardCollection("buddy.refresh_tokens", { location: 1, user_id: 1 });

// children: compound key { location, user_id }
sh.shardCollection("buddy.children", { location: 1, user_id: 1 });

// growth_missions: compound key { location, child_id }
sh.shardCollection("buddy.growth_missions", { location: 1, child_id: 1 });

// completed_growth_areas: compound key { location, user_id }
sh.shardCollection("buddy.completed_growth_areas", { location: 1, user_id: 1 });

// recommendation_progress: compound key { location, user_id }
sh.shardCollection("buddy.recommendation_progress", { location: 1, user_id: 1 });

// ── 3. Add zone tags to shards ───────────────────────────────────────────────
// In Atlas, shards in the EU zone replica set get tag "EU", etc.
// These are managed in the Atlas UI or via Atlas Admin API.
// The commands below show the mongos-level equivalent:

sh.addShardToZone("shard-eu-1",   "EU");
sh.addShardToZone("shard-eu-2",   "EU");
sh.addShardToZone("shard-us-1",   "US");
sh.addShardToZone("shard-us-2",   "US");
sh.addShardToZone("shard-apac-1", "APAC");
sh.addShardToZone("shard-apac-2", "APAC");
sh.addShardToZone("shard-in-1",   "IN");
sh.addShardToZone("shard-me-1",   "ME");
sh.addShardToZone("shard-br-1",   "BR");

// ── 4. Assign shard key ranges to zones ─────────────────────────────────────
// Each collection that is zone-sharded needs a range assignment per zone.
// Pattern: { location: "<zone_value>" } maps to that zone's tag.

// users collection — EU
sh.updateZoneKeyRange(
  "buddy.users",
  { location: "eu",   _id: MinKey },   // lower bound (inclusive)
  { location: "eu",   _id: MaxKey },   // upper bound (exclusive)
  "EU"
);
// users collection — US
sh.updateZoneKeyRange(
  "buddy.users",
  { location: "us",   _id: MinKey },
  { location: "us",   _id: MaxKey },
  "US"
);
// users collection — APAC
sh.updateZoneKeyRange(
  "buddy.users",
  { location: "apac", _id: MinKey },
  { location: "apac", _id: MaxKey },
  "APAC"
);
// users collection — IN
sh.updateZoneKeyRange(
  "buddy.users",
  { location: "in",   _id: MinKey },
  { location: "in",   _id: MaxKey },
  "IN"
);
// users collection — ME
sh.updateZoneKeyRange(
  "buddy.users",
  { location: "me",   _id: MinKey },
  { location: "me",   _id: MaxKey },
  "ME"
);
// users collection — BR
sh.updateZoneKeyRange(
  "buddy.users",
  { location: "br",   _id: MinKey },
  { location: "br",   _id: MaxKey },
  "BR"
);

// Repeat sh.updateZoneKeyRange for each remaining zone-sharded collection
// (refresh_tokens, children, growth_missions, completed_growth_areas,
//  recommendation_progress) — same pattern, same zone values.
```

---

## The Login Scatter-Gather Problem and Solution

### Why login without a routing step is expensive

A user logs in with an email address. That email resolves to a user document
in one zone. But the application does not yet know which zone. If it queries the
`users` collection with `{ email: "parent@example.com" }` directly, MongoDB's
query router (mongos) must **fan out the query to every zone** because `email`
is not the shard key. This is a scatter-gather operation: mongos sends the query
to all shards in parallel, waits for all responses, and merges the results.
Scatter-gather adds latency proportional to the number of zones and the slowest
zone's response time.

For buddy-app with six zones (EU, US, APAC, IN, ME, BR), every login would
fan out to all six zone replica sets.

### Solution: `user_lookups` global collection

Exactly equivalent to the PostgreSQL Global Router DB. At registration time,
a routing document is written to the `user_lookups` collection before the user
document is created in the zone-sharded `users` collection.

```
email_hash (sha256)  →  { zone: "eu", user_id: "01920f4e-..." }
```

Because `user_lookups` is a global collection (replicated to all zones), this
lookup is always served from a local node with no cross-zone hop.

### Login becomes two-phase

```
Phase 1: lookup email_hash in user_lookups  →  zone = "eu"
Phase 2: query users collection with { location: "eu", _id: user_id }
         (targeted read — hits EU zone only, no scatter-gather)
```

The second query uses the full shard key (`location` + `_id`), so mongos
routes it directly to the correct zone with no fan-out.

---

## Request Flows

### Registration

```
Client                  API                  user_lookups         users (EU zone)
  │                      │                   (global coll.)            │
  │─── POST /register ──▶│                        │                    │
  │   (country: "DE")    │                        │                    │
  │                      │── resolve zone ────────┤                    │
  │                      │   "DE" → "eu"          │                    │
  │                      │                        │                    │
  │                      │── INSERT               │                    │
  │                      │   { email_hash,        │                    │
  │                      │     zone: "eu",        │                    │
  │                      │     user_id,           │                    │
  │                      │     status: "pending"} │                    │
  │                      │──────────────────────▶ │                    │
  │                      │                        │                    │
  │                      │── INSERT user doc ─────┼───────────────────▶│
  │                      │   { location: "eu",    │                    │
  │                      │     email, password_   │                    │
  │                      │     hash, onboarding,  │                    │
  │                      │     ... }              │                    │
  │                      │                        │                    │
  │                      │── UPDATE status        │                    │
  │                      │   "pending"→"active" ─▶│                    │
  │                      │                        │                    │
  │◀─── JWT (zone:eu) ───│                        │                    │
```

### Login (two-phase)

```
Client                  API                  user_lookups         users (EU zone)
  │                      │                   (global coll.)            │
  │─── POST /login ─────▶│                        │                    │
  │                      │── lookup              │                    │
  │                      │   sha256(email) ──────▶│                    │
  │                      │◀── { zone: "eu",       │                    │
  │                      │     user_id: "01920.." }│                   │
  │                      │                        │                    │
  │                      │── targeted read        │                    │
  │                      │   { location: "eu",    │                    │
  │                      │     _id: user_id } ────┼───────────────────▶│
  │                      │◀── user document ──────┼────────────────────│
  │                      │                        │                    │
  │                      │── verify password      │                    │
  │◀─── JWT (zone:eu) ───│                        │                    │
```

### All Subsequent Requests — Hot Path (JWT carries zone claim)

```
Client                  API                              users (EU zone)
  │                      │                                      │
  │─── GET /goals ──────▶│                                      │
  │   Authorization: JWT │                                      │
  │   (zone: "eu")       │                                      │
  │                      │── decode JWT → zone = "eu"           │
  │                      │── find_one({                         │
  │                      │     location: "eu",                  │
  │                      │     _id: user_id                     │
  │                      │   }) ───────────────────────────────▶│
  │                      │◀── user document ────────────────────│
  │◀─── goals payload ───│                                      │
```

> The `user_lookups` global collection is **never touched** on hot-path
> requests. It is only hit once per registration and once per login.

---

## JWT Zone Claim

After login, the zone is embedded in the JWT exactly as in the Aurora approach.
Every subsequent request extracts the zone from the JWT and routes directly to
the correct zone-sharded collection — no global lookup needed.

```json
{
  "sub": "01920f4e-aaaa-7bbb-cccc-ddddeeeeeeee",
  "zone": "eu",
  "type": "access",
  "exp": 1234567890
}
```

The zone claim **must be validated**: the backend always verifies the JWT
signature before trusting the zone value and confirms that the `_id` in the
queried document matches the `sub` claim. A tampered JWT with `"zone": "us"`
cannot access a European user's document because the user's document does not
exist in the US zone — but the check provides defence in depth.

---

## Code Implementation

### `settings.py` — Single Atlas connection string + zone config

```python
# backend/app/core/settings.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Single Atlas connection string — mongos handles zone routing internally
    mongodb_uri: str = "mongodb+srv://user:pass@buddy.atlas.mongodb.net/?retryWrites=true"
    mongodb_database: str = "buddy"

    # JWT
    jwt_secret: str = "change-me-in-production"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days:   int = 30

    # Zone mapping (mirrors COUNTRY_TO_ZONE below)
    default_zone: str = "us"

    class Config:
        env_file = ".env"


settings = Settings()
```

---

### `database.py` — Single MongoClient, collection accessors

```python
# backend/app/core/database.py
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from .settings import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=5_000,
            connectTimeoutMS=10_000,
            socketTimeoutMS=30_000,
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_database]


# ── Collection accessors ─────────────────────────────────────────────────────

def users_col():
    return get_db()["users"]

def refresh_tokens_col():
    return get_db()["refresh_tokens"]

def children_col():
    return get_db()["children"]

def growth_missions_col():
    return get_db()["growth_missions"]

def completed_growth_areas_col():
    return get_db()["completed_growth_areas"]

def recommendation_progress_col():
    return get_db()["recommendation_progress"]

# Global collections (no PII)
def user_lookups_col():
    return get_db()["user_lookups"]

def growth_area_definitions_col():
    return get_db()["growth_area_definitions"]

def mission_templates_col():
    return get_db()["mission_templates"]

def personality_catalogue_col():
    return get_db()["personality_catalogue"]

def feature_flags_col():
    return get_db()["feature_flags"]
```

---

### Registration: two-phase commit pattern

```python
# backend/app/routers/auth.py
import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClientSession

from ..core.database import get_client, users_col, user_lookups_col
from ..core.security import hash_password, create_access_token
from ..schemas.auth import RegisterRequest

router = APIRouter()


def _email_hash(email: str) -> str:
    return hashlib.sha256(email.lower().strip().encode()).hexdigest()


@router.post("/auth/register", status_code=201)
async def register(data: RegisterRequest):
    zone = _resolve_zone(data.country_code)  # e.g. "DE" → "eu"
    user_id = str(uuid.uuid4())
    email_hash = _email_hash(data.email)

    # ── Phase 1: Reserve routing slot (two-phase commit pattern) ────────────
    # Write with status="pending" first. If the zone write fails, we can
    # detect and clean up orphaned "pending" records in a background job.
    lookup_doc = {
        "_id":        email_hash,
        "zone":       zone,
        "user_id":    user_id,
        "status":     "pending",
        "created_at": datetime.now(timezone.utc),
    }
    try:
        await user_lookups_col().insert_one(lookup_doc)
    except Exception:
        # Duplicate key — email already registered
        raise HTTPException(status_code=409, detail="Email already registered")

    # ── Phase 2: Write user document to zone-sharded collection ─────────────
    user_doc = {
        "_id":           user_id,
        "location":      zone,
        "email":         data.email,
        "password_hash": hash_password(data.password),
        "full_name":     data.full_name,
        "role":          "parent",
        "country_code":  data.country_code.upper(),
        "created_at":    datetime.now(timezone.utc),
        "updated_at":    datetime.now(timezone.utc),
        "preferences":   { "tts_enabled": False, "last_visited_path": None },
        "onboarding":    { "phase": 0 },
        "personality":   None,
        "journey":       None,
        "goals":         None,
    }
    try:
        await users_col().insert_one(user_doc)
    except Exception as exc:
        # Zone write failed — compensate by removing the pending lookup entry
        await user_lookups_col().delete_one({ "_id": email_hash, "status": "pending" })
        raise HTTPException(status_code=500, detail="Registration failed") from exc

    # ── Confirm: mark routing record as active ───────────────────────────────
    await user_lookups_col().update_one(
        { "_id": email_hash },
        { "$set": { "status": "active" } }
    )

    access_token = create_access_token(user_id=user_id, zone=zone)
    return { "access_token": access_token, "token_type": "bearer" }
```

---

### Login: lookup then targeted query

```python
@router.post("/auth/login")
async def login(data: LoginRequest):
    email_hash = _email_hash(data.email)

    # Phase 1: resolve zone from global user_lookups collection (local read)
    route = await user_lookups_col().find_one(
        { "_id": email_hash, "status": "active" }
    )
    if not route:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Phase 2: targeted read — full shard key means no scatter-gather
    user = await users_col().find_one(
        { "location": route["zone"], "_id": route["user_id"] }
    )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token(user_id=user["_id"], zone=route["zone"])
    return { "access_token": access_token, "token_type": "bearer" }
```

---

### JWT: token creation

```python
# backend/app/core/security.py
from datetime import datetime, timedelta, timezone
import jwt as pyjwt
from .settings import settings


def create_access_token(user_id: str, zone: str) -> str:
    payload = {
        "sub":  user_id,
        "zone": zone,        # ← critical addition for hot-path routing
        "type": "access",
        "exp":  datetime.now(timezone.utc) + timedelta(
                    minutes=settings.access_token_expire_minutes
                ),
    }
    return pyjwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return pyjwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
```

---

### Protected route dependency — extract zone from JWT

```python
# backend/app/core/dependencies.py
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_current_user_zone(
    token: str = Depends(oauth2_scheme),
) -> tuple[str, str]:
    """Returns (user_id, zone) from a validated JWT. Use as a FastAPI dependency."""
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    zone    = payload.get("zone")
    if not user_id or not zone:
        raise HTTPException(status_code=401, detail="Malformed token")

    return user_id, zone


# ── Usage in any router ──────────────────────────────────────────────────────
@router.get("/user/goals")
async def get_goals(
    identity: tuple[str, str] = Depends(get_current_user_zone),
):
    user_id, zone = identity
    user = await users_col().find_one(
        { "location": zone, "_id": user_id },
        projection={ "goals": 1, "_id": 0 }
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user.get("goals") or {}
```

---

### Example: CRUD for children (top-level field queries)

```python
# backend/app/routers/children.py
from fastapi import APIRouter, Depends, HTTPException
from ..core.dependencies import get_current_user_zone
from ..core.database import children_col
from ..schemas.children import ChildCreate

router = APIRouter()


@router.post("/children", status_code=201)
async def create_child(
    data: ChildCreate,
    identity: tuple[str, str] = Depends(get_current_user_zone),
):
    user_id, zone = identity
    child_doc = {
        "_id":      str(uuid.uuid4()),
        "location": zone,           # ← shard key leading field
        "user_id":  user_id,
        "name":     data.name,      # top-level — indexable, queryable
        "age":      data.age,       # top-level — range queries work
        "school":   data.school,    # top-level — exact match index
        "year_group":       data.year_group,
        "additional_needs": data.additional_needs or [],
        "avatar_url":       data.avatar_url,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await children_col().insert_one(child_doc)
    return child_doc


@router.get("/children")
async def list_children(
    identity: tuple[str, str] = Depends(get_current_user_zone),
):
    user_id, zone = identity
    # Uses compound index (location, user_id) — no scatter-gather, no blob parsing
    cursor = children_col().find(
        { "location": zone, "user_id": user_id },
        sort=[("created_at", 1)]
    )
    return await cursor.to_list(length=100)


@router.get("/children/{child_id}")
async def get_child(
    child_id: str,
    identity: tuple[str, str] = Depends(get_current_user_zone),
):
    user_id, zone = identity
    child = await children_col().find_one(
        { "location": zone, "_id": child_id, "user_id": user_id }
    )
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return child
```

---

### Example: aggregation — count missions by status per child

```python
@router.get("/children/{child_id}/mission-summary")
async def mission_summary(
    child_id: str,
    identity: tuple[str, str] = Depends(get_current_user_zone),
):
    user_id, zone = identity

    pipeline = [
        # Stage 1: filter to this child's documents in the correct zone
        { "$match": { "location": zone, "child_id": child_id } },

        # Stage 2: group by status, count each bucket
        { "$group": { "_id": "$status", "count": { "$sum": 1 } } },

        # Stage 3: reshape to { status: count } dict
        { "$group": {
            "_id": None,
            "summary": { "$push": { "k": "$_id", "v": "$count" } }
        }},
        { "$replaceRoot": {
            "newRoot": { "$arrayToObject": "$summary" }
        }}
    ]

    result = await growth_missions_col().aggregate(pipeline).to_list(length=1)
    return result[0] if result else {}
```

---

## Write Coordination — Two-Phase Commit Pattern

Registration spans two collections with different sharding characteristics:
`user_lookups` (global, replicated) and `users` (zone-sharded). These are
separate logical write targets and MongoDB does not provide cross-collection
multi-document transactions that span zone boundaries within Global Clusters.
The two-phase commit pattern handles this safely.

### Normal path

```
Step 1  →  INSERT user_lookups { status: "pending" }
              If DuplicateKeyError → email already registered → abort
Step 2  →  INSERT users { location: zone, _id: user_id, ... }
              If failure → go to compensate
Step 3  →  UPDATE user_lookups SET status = "active"
              If failure → background reconciler will find orphaned "pending"
              records > 5 minutes old and retry Step 3 or clean up
```

### Compensating write (Step 2 fails)

```
Compensate → DELETE user_lookups WHERE _id = email_hash AND status = "pending"
```

Because the `user_lookups` record was in `"pending"` state, no login could
have succeeded (the login query filters for `status: "active"`). The
compensating delete is safe to retry idempotently.

### Background reconciler (for Step 3 failures)

```python
# Scheduled task (e.g. every 5 minutes via APScheduler or a cron job)
async def reconcile_pending_lookups():
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    async for record in user_lookups_col().find({
        "status": "pending",
        "created_at": { "$lt": cutoff }
    }):
        # Check if the user document actually exists in the target zone
        user = await users_col().find_one({
            "location": record["zone"],
            "_id":      record["user_id"]
        })
        if user:
            # User document exists — Step 3 failed; complete the commit
            await user_lookups_col().update_one(
                { "_id": record["_id"] },
                { "$set": { "status": "active" } }
            )
        else:
            # User document does not exist — Step 2 failed; clean up
            await user_lookups_col().delete_one({ "_id": record["_id"] })
```

### Why not MongoDB multi-document transactions?

MongoDB 4.0+ supports multi-document ACID transactions within a replica set,
and 4.2+ extends this to sharded clusters. However, transactions that span
multiple shard zones add coordination overhead and can conflict with zone
sharding's write routing. The two-phase commit pattern avoids this overhead
while providing equivalent safety guarantees for the registration flow, which
is not a high-frequency operation.

---

## Index Management

There is no Alembic in a MongoDB-backed stack. Indexes are created at
application startup using `motor`'s `create_index` / `create_indexes` API.
The startup code is idempotent — calling `create_index` on an already-existing
index is a no-op.

```python
# backend/app/core/indexes.py
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel


async def create_all_indexes(db: AsyncIOMotorDatabase) -> None:
    """
    Create all required indexes. Called once at application startup.
    All operations are idempotent — safe to run on every deploy.
    """

    # ── users ────────────────────────────────────────────────────────────────
    await db["users"].create_indexes([
        # Unique email constraint
        IndexModel([("email", ASCENDING)], unique=True, name="users_email_unique"),
        # Shard key index (compound; required for zone-sharded collections)
        IndexModel([("location", ASCENDING), ("_id", ASCENDING)], name="users_shard_key"),
        # Support lookup by country_code for compliance reporting
        IndexModel([("country_code", ASCENDING)], name="users_country_code"),
    ])

    # ── refresh_tokens ───────────────────────────────────────────────────────
    await db["refresh_tokens"].create_indexes([
        IndexModel([("location", ASCENDING), ("user_id", ASCENDING)], name="tokens_shard_key"),
        # TTL index: Atlas will auto-delete expired tokens
        IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0, name="tokens_ttl"),
    ])

    # ── children ─────────────────────────────────────────────────────────────
    await db["children"].create_indexes([
        IndexModel(
            [("location", ASCENDING), ("user_id", ASCENDING), ("created_at", ASCENDING)],
            name="children_by_user_created"
        ),
        IndexModel([("location", ASCENDING), ("user_id", ASCENDING)], name="children_shard_key"),
    ])

    # ── growth_missions ──────────────────────────────────────────────────────
    await db["growth_missions"].create_indexes([
        IndexModel(
            [("location", ASCENDING), ("child_id", ASCENDING), ("status", ASCENDING)],
            name="missions_by_child_status"
        ),
        # Support due date queries (overdue missions dashboard)
        IndexModel(
            [("location", ASCENDING), ("child_id", ASCENDING), ("due_date", ASCENDING)],
            name="missions_by_child_duedate"
        ),
    ])

    # ── recommendation_progress ──────────────────────────────────────────────
    await db["recommendation_progress"].create_indexes([
        IndexModel(
            [("location", ASCENDING), ("user_id", ASCENDING), ("status", ASCENDING)],
            name="recprogress_by_user_status"
        ),
        # Support per-recommendation lookup
        IndexModel(
            [("location", ASCENDING), ("user_id", ASCENDING), ("recommendation_id", ASCENDING)],
            unique=True,
            name="recprogress_user_rec_unique"
        ),
    ])

    # ── completed_growth_areas ───────────────────────────────────────────────
    await db["completed_growth_areas"].create_indexes([
        IndexModel(
            [("user_id", ASCENDING), ("area_id", ASCENDING)],
            unique=True,
            name="cga_user_area_unique"
        ),
        IndexModel(
            [("location", ASCENDING), ("user_id", ASCENDING)],
            name="cga_shard_key"
        ),
    ])

    # ── user_lookups (global collection — no PII) ────────────────────────────
    await db["user_lookups"].create_indexes([
        # _id is already the email_hash (indexed by default)
        # Secondary index to look up by user_id (admin tooling)
        IndexModel([("user_id", ASCENDING)], unique=True, name="lookups_user_id_unique"),
        # Index for reconciler query on pending records
        IndexModel(
            [("status", ASCENDING), ("created_at", ASCENDING)],
            name="lookups_pending_created"
        ),
    ])

    # ── growth_area_definitions (global collection) ──────────────────────────
    await db["growth_area_definitions"].create_indexes([
        IndexModel([("display_order", ASCENDING)], name="growth_def_display_order"),
    ])

    # ── feature_flags (global collection) ───────────────────────────────────
    await db["feature_flags"].create_indexes([
        IndexModel([("flag_name", ASCENDING)], unique=True, name="flags_name_unique"),
        IndexModel([("enabled", ASCENDING)], name="flags_enabled"),
    ])
```

### Calling at startup

```python
# backend/app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .core.database import get_db
from .core.indexes import create_all_indexes


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await create_all_indexes(get_db())
    yield
    # Shutdown — motor client closes automatically via GC; explicit close optional


app = FastAPI(lifespan=lifespan)
```

---

## Region Detection at Signup

The user **explicitly selects their country** during registration. This is the
only detection method used. GeoIP inference and `Accept-Language` headers are
not used as the primary signal — regulators treat explicit user declaration as
the strongest form of consent and it is fully auditable.

The selected `country_code` is stored as a top-level field on the `users`
document for compliance reporting (GDPR Article 30 Records of Processing
Activities).

```python
# backend/app/core/zones.py

COUNTRY_TO_ZONE: dict[str, str] = {
    # EU / EEA / UK — GDPR
    "AT": "eu", "BE": "eu", "BG": "eu", "CY": "eu", "CZ": "eu",
    "DE": "eu", "DK": "eu", "EE": "eu", "ES": "eu", "FI": "eu",
    "FR": "eu", "GR": "eu", "HR": "eu", "HU": "eu", "IE": "eu",
    "IT": "eu", "LT": "eu", "LU": "eu", "LV": "eu", "MT": "eu",
    "NL": "eu", "PL": "eu", "PT": "eu", "RO": "eu", "SE": "eu",
    "SI": "eu", "SK": "eu", "GB": "eu", "NO": "eu", "IS": "eu", "LI": "eu",
    # Americas
    "US": "us", "CA": "us", "MX": "us",
    "BR": "br",            # Brazil LGPD — dedicated BR zone
    # Asia-Pacific
    "SG": "apac", "MY": "apac", "ID": "apac", "PH": "apac", "TH": "apac",
    "VN": "apac", "JP": "apac", "KR": "apac", "AU": "apac", "NZ": "apac",
    # India — DPDP 2023
    "IN": "in",
    # Middle East — Saudi PDPL, UAE DIFC
    "SA": "me", "AE": "me", "QA": "me", "KW": "me", "BH": "me", "OM": "me",
    # China — PIPL: requires dedicated deployment outside Atlas standard regions
    "CN": "cn",
}


def _resolve_zone(country_code: str) -> str:
    """
    Map a two-letter ISO 3166-1 alpha-2 country code to a buddy-app zone.
    Unknown country codes fall back to "us" (no strict residency law).
    """
    return COUNTRY_TO_ZONE.get(country_code.upper(), "us")
```

> **China note:** `"cn"` is included in the mapping but requires a fully
> separate deployment (mainland China ICP licence, local legal entity,
> China-specific Atlas configuration or alternative provider). Treat it as a
> Phase 3 project — see the implementation checklist.

---

## In-Memory Rate Limiter — Known Issue

The current LLM rate limiter in `routers/llm.py` uses a `defaultdict(deque)`
in process memory. In a multi-instance deployment (multiple API pods per zone),
each pod maintains its own counter — a user can exceed the intended limit by
hitting different pods.

**Fix required before multi-region launch:** Replace with a Redis-backed
sliding window counter. Deploy one Redis instance per zone (so rate limit state
stays in the zone and does not introduce cross-zone latency).

```python
# backend/app/core/rate_limit.py
import time
import redis.asyncio as aioredis
from .settings import settings

# One Redis client per zone — URL injected via environment variable
_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def check_llm_rate_limit(user_id: str) -> bool:
    """
    Sliding window rate limiter.
    Allows up to 50 LLM requests per user per hour.
    Returns True if the request is allowed, False if rate-limited.
    """
    key    = f"llm_rate:{user_id}"
    now    = time.time()
    window = 3_600  # 1 hour in seconds
    limit  = 50

    redis = get_redis()
    pipe  = redis.pipeline()
    pipe.zremrangebyscore(key, 0, now - window)   # remove expired entries
    pipe.zcard(key)                                # count remaining
    pipe.zadd(key, { str(now): now })              # add current request
    pipe.expire(key, window)                       # reset TTL
    _, count, _, _ = await pipe.execute()

    return count < limit
```

---

## Implementation Checklist

### Phase 0 — Do today (zero infra cost, prevents future pain)

- [ ] Add `zone` field to JWT payload (`create_access_token`)
- [ ] Add country selector to registration UI
- [ ] Add `COUNTRY_TO_ZONE` mapping to `core/zones.py`
- [ ] Add `location` field to all in-progress data models (even if only one zone today)
- [ ] Update SQLAlchemy models to include `country_code` column (for Aurora path parity)

### Phase 1 — First multi-zone deployment

- [ ] Provision MongoDB Atlas Global Cluster with EU and US zones
- [ ] Configure shard keys and zone tag ranges (see Zone / Shard Key section)
- [ ] Seed global collections: `growth_area_definitions`, `mission_templates`, `personality_catalogue`, `feature_flags`
- [ ] Implement `database.py` with single `AsyncIOMotorClient` and collection accessors
- [ ] Implement `indexes.py` and call `create_all_indexes` in `lifespan`
- [ ] Implement `user_lookups` two-phase commit in register endpoint
- [ ] Implement two-phase login (lookup → targeted query)
- [ ] Update all protected routes: extract zone from JWT via `get_current_user_zone` dependency
- [ ] Migrate `children` schema: flatten payload blob to top-level fields
- [ ] Migrate `growth_missions` schema: flatten payload blob to top-level fields
- [ ] Migrate `user_recommendations_progress`: one document per recommendation
- [ ] Update CI/CD: remove `alembic upgrade head` steps; ensure `create_all_indexes` is called on startup

### Phase 2 — Full compliance rollout

- [ ] Add remaining zones: APAC, IN, ME, BR (Atlas zone config + shard key ranges)
- [ ] Replace in-memory rate limiter with Redis (one Redis per zone)
- [ ] Implement background reconciler for orphaned `pending` `user_lookups` records
- [ ] Add monitoring/alerting: detect if any `location` field contains an unexpected value
- [ ] Enable MongoDB Atlas audit logging per zone
- [ ] Enable Atlas field-level encryption for `email`, `full_name`, `password_hash`
- [ ] Legal review: confirm adequacy decisions / SCCs for each active zone pair
- [ ] Privacy policy update: document where each user's data is stored by zone

### Phase 3 — China (PIPL — treat as separate project)

- [ ] Engage local legal counsel for ICP licence requirements
- [ ] Set up dedicated China infrastructure (not an Atlas standard region)
- [ ] Implement `cn` zone with fully isolated deployment pipeline
- [ ] Security assessment required by PIPL for any cross-border data transfer
- [ ] Do **not** use Atlas's standard Global Cluster for China — Atlas standard regions do not include mainland China

---

## Security Considerations

### Zone claim validation in JWT

The `zone` claim in the JWT must be validated on every request. The backend
always verifies the JWT signature (via `pyjwt.decode` with the `algorithms`
allow-list) before trusting any claim. After extracting `zone` and `user_id`,
every query includes both `location` and `_id` to prevent cross-zone data
access even if a JWT were crafted with a different zone value.

```python
# Always query with both shard key fields — never just _id alone
user = await users_col().find_one({ "location": zone, "_id": user_id })
```

A document with `_id = user_id` only exists in its correct zone. Querying
with a wrong `location` returns `None`, which the route handler treats as a
404. This provides a second layer of defence beyond JWT signature verification.

### Field-level encryption for sensitive fields

MongoDB Atlas supports **Client-Side Field Level Encryption (CSFLE)** for
encrypting individual document fields before they reach the server. For GDPR
and PIPL compliance, consider encrypting `email`, `full_name`, and
`password_hash` at the driver level. CSFLE means even Atlas support staff and
MongoDB employees cannot read plaintext PII from storage — only application
instances holding the encryption keys can decrypt.

```python
# Sketch of CSFLE configuration with motor
from pymongo.encryption_options import AutoEncryptionOpts

auto_encryption = AutoEncryptionOpts(
    kms_providers={ "aws": { "accessKeyId": "...", "secretAccessKey": "..." } },
    key_vault_namespace="buddy.__keyVault",
    schema_map={
        "buddy.users": {
            "bsonType": "object",
            "encryptMetadata": { "keyId": [Binary(b"...", UUID_SUBTYPE)] },
            "properties": {
                "email":         { "encrypt": { "bsonType": "string", "algorithm": "AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic" } },
                "full_name":     { "encrypt": { "bsonType": "string", "algorithm": "AEAD_AES_256_CBC_HMAC_SHA_512-Random" } },
                "password_hash": { "encrypt": { "bsonType": "string", "algorithm": "AEAD_AES_256_CBC_HMAC_SHA_512-Random" } },
            }
        }
    }
)
```

Use **Deterministic** encryption for `email` (so equality queries still work
after the login phase resolves the user_id) and **Randomised** encryption for
fields that do not need server-side query support.

### Atlas audit logs

Enable MongoDB Atlas Database Auditing per zone. Configure audit filters to
capture all `find`, `insert`, `update`, and `delete` operations on
zone-sharded collections. Audit logs must be stored in the same geographic
zone as the cluster they record (required by GDPR Article 30 and Brazil LGPD).

Atlas exports audit logs to Atlas-managed storage or to an AWS S3 bucket you
specify. Configure S3 export to a bucket in the same AWS region as the
cluster zone (e.g. EU audit logs → `eu-central-1` S3 bucket).

### No cross-zone admin queries

Internal tooling and support dashboards must enforce the same zone boundaries
as user-facing code. An admin console must require the operator to select a
zone before running queries. Never run a `find({})` against a zone-sharded
collection without a `location` filter — this triggers a scatter-gather to all
zones and may expose data from the wrong jurisdiction to an operator in a
different region.

### `user_lookups` must not log emails

The `user_lookups` collection stores only `sha256(email.lower())`, never the
plaintext email. Ensure no application code accidentally logs the plaintext
email in proximity to the lookup step. Configure Atlas query profiler and slow
query logs to exclude the `_id` field of `user_lookups` queries (the `_id`
is the email hash, not PII, but belt-and-suspenders hygiene avoids accidental
hash logging that could be cross-referenced).

### Backup isolation

Atlas continuous cloud backups must be configured to store snapshots in the
same geographic zone as the primary cluster. In Atlas, backup storage location
is tied to the cluster region. Verify in the Atlas UI that each zone's backup
destination region matches the zone's compliance jurisdiction (e.g. EU zone
backups stored in `eu-central-1` or `eu-west-1`, not `us-east-1`).
