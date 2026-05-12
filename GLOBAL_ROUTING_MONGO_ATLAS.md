# MongoDB Atlas Global Cluster — Setup & Operations Runbook

This document covers everything needed to create, configure, and operate the
MongoDB Atlas Global Cluster used by buddy-app. Terraform automation is planned
for a future phase; these are the manual steps until then.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Single Atlas Global Cluster  (one connection string, many zones)    │
│                                                                      │
│  email_index  ─── UNSHARDED (primary shard, global)                 │
│                   _id = email  →  { user_id, location }             │
│                   Global uniqueness guard + login routing lookup     │
│                                                                      │
│  users / sessions / onboarding / goals / recommendations             │
│  growth_areas / children / missions  ─── ZONE-SHARDED               │
│                   shard key: { location: 1, _id: 1 }                │
│                                                                      │
│  Zone routing:                                                       │
│    location = "us"   → AWS us-east-1 / us-west-2  shard             │
│    location = "eu"   → AWS eu-central-1 / eu-west-1 shard           │
│    location = "apac" → AWS ap-southeast-1 / ap-northeast-1 shard    │
│    location = "in"   → AWS ap-south-1 shard                         │
│    location = "br"   → AWS sa-east-1 shard                          │
│    location = "me"   → AWS me-south-1 / me-central-1 shard          │
│    location = "cn"   → (separate deployment — see China note)        │
│    location = "ru"   → (separate deployment — see Russia note)       │
└──────────────────────────────────────────────────────────────────────┘
```

**Why zone sharding?** Data-residency laws (GDPR, India DPDP, Brazil LGPD,
Saudi PDPL) require that personal data be physically stored within a specific
jurisdiction. Atlas Global Clusters enforce this automatically: a document with
`location: "eu"` is written to and stored on EU-region nodes only. The
application never needs to manage routing logic — Atlas handles it.

---

## Step 1 — Create the Atlas Organisation and Project

1. Sign in at <https://cloud.mongodb.com>.
2. Create an **Organisation** (e.g. `buddy360`).
3. Inside it, create a **Project** (e.g. `buddy360-prod`).

---

## Step 2 — Create the Global Cluster

1. In the project, click **Build a Database → Advanced Configuration**.
2. Select **Global Cluster** (requires M30 or higher for production; M0 free
   tier does NOT support Global Clusters — use it only for single-zone dev).
3. Choose a **Global Write** configuration.
4. Add zones to match your active markets. Recommended starting set:

   | Zone name (in Atlas) | Cloud region(s) | Maps to `location` value |
   |----------------------|-----------------|--------------------------|
   | `US_EAST`            | AWS us-east-1   | `us`                     |
   | `EU_CENTRAL`         | AWS eu-central-1| `eu`                     |
   | `APAC_SE`            | AWS ap-southeast-1 | `apac`                |
   | `INDIA`              | AWS ap-south-1  | `in`                     |
   | `BRAZIL`             | AWS sa-east-1   | `br`                     |
   | `MIDDLE_EAST`        | AWS me-south-1  | `me`                     |

   You can add zones incrementally — only add a zone when you have real users
   in that region.

5. Set the cluster tier (M30+ for Global; M10 acceptable for staging).
6. Enable **Backup** (continuous cloud backups recommended for production).
7. Click **Create Cluster** and wait for provisioning (~10 minutes).

> **China / Russia note:** PIPL and FZ-242 impose strict requirements that
> cannot be satisfied by an Atlas Global Cluster hosted in a Western cloud.
> Treat `cn` and `ru` as completely separate deployments with separate MONGODB_URI
> values, not as zones in the main cluster. These locations are present in
> `routing.py` as placeholders only.

---

## Step 3 — Configure Zone Sharding Rules

Zone sharding rules tell Atlas which `location` values belong to which physical
zone. This must be done **once** after cluster creation, before any data is
written.

1. In the Atlas UI, navigate to your cluster → **Collections**.
2. For each collection listed below, enable sharding and add zone mappings:

### Collections to zone-shard

Apply the following for each of: `users`, `sessions`, `onboarding`, `goals`,
`recommendations`, `growth_areas`, `children`, `missions`.

**Shard key:** `{ "location": 1, "_id": 1 }`

Zone mapping (add one entry per zone):

| Zone (Atlas name) | Min key `location` | Max key `location` |
|-------------------|--------------------|--------------------|
| `US_EAST`         | `"us"`             | `"us"`             |
| `EU_CENTRAL`      | `"eu"`             | `"eu"`             |
| `APAC_SE`         | `"apac"`           | `"apac"`           |
| `INDIA`           | `"in"`             | `"in"`             |
| `BRAZIL`          | `"br"`             | `"br"`             |
| `MIDDLE_EAST`     | `"me"`             | `"me"`             |

For `_id`, set both min and max to `MinKey` / `MaxKey` (Atlas default — leave
the `_id` range as the full range; only the `location` prefix drives zone
placement).

> **Do not add `location` = `cn` or `ru` zone mappings here.** These are served
> by separate clusters and must never land on this cluster's shards.

### `email_index` — do NOT shard

`email_index` must remain **unsharded**. It is a global lookup table with no
zone affinity. Do not add it to the zone-shard configuration. It will
automatically live on the cluster's primary shard.

---

## Step 4 — Create a Database User

1. Go to **Database Access → Add New Database User**.
2. Choose **Password** authentication.
3. Username: `buddy360app` (or your preferred name).
4. Generate a strong random password (save it in your secrets manager).
5. Built-in Role: **Atlas admin** for migration/setup; switch to
   **Read and write to any database** for the application user in production.
6. Click **Add User**.

---

## Step 5 — Configure Network Access

1. Go to **Network Access → Add IP Address**.
2. For production: add the static egress IPs of your application servers /
   ECS tasks.
3. For local dev: add your current IP address (or `0.0.0.0/0` temporarily,
   but remove it before going live).

---

## Step 6 — Get the Connection String

1. On the cluster overview, click **Connect → Drivers**.
2. Select **Python** / **Motor** (they use the same connection string format).
3. Copy the `mongodb+srv://` URI. It looks like:

   ```
   mongodb+srv://buddy360app:<password>@buddy360.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

4. Set this as `MONGODB_URI` in your `.env` (local dev) or your secrets
   manager / ECS task definition (production).

---

## Step 7 — Indexes (handled automatically by the application)

The application calls `init_indexes()` in [`backend/app/database.py`](backend/app/database.py)
on every startup. This is idempotent — if the indexes already exist, the call
is a no-op. You do not need to create indexes manually.

For reference, the indexes created are:

| Collection      | Index                                              | Notes                              |
|-----------------|----------------------------------------------------|------------------------------------|
| `email_index`   | `{ user_id: 1 }`                                  | Supports reverse lookups           |
| `users`         | `{ location: 1, _id: 1 }` unique                 | Shard key index (required)         |
| `users`         | `{ location: 1, email: 1 }` unique                | Email uniqueness per shard         |
| `users`         | `{ location: 1, role: 1 }`                        | Role-based queries                 |
| `sessions`      | `{ location: 1, _id: 1 }` unique                 | Shard key index                    |
| `sessions`      | `{ location: 1, expires_at: 1 }`                  | Expiry cleanup                     |
| `sessions`      | `{ location: 1, user_id: 1 }`                     | Logout / revocation                |
| `onboarding`    | `{ location: 1, _id: 1 }` unique                 | Shard key index                    |
| `goals`         | `{ location: 1, _id: 1 }` unique                 | Shard key index                    |
| `recommendations` | `{ location: 1, _id: 1 }` unique               | Shard key index                    |
| `recommendations` | `{ location: 1, step: 1 }`                     |                                    |
| `recommendations` | `{ location: 1, current_area_index: 1 }`       |                                    |
| `growth_areas`  | `{ location: 1, _id: 1 }` unique                 | Shard key index                    |
| `growth_areas`  | `{ location: 1, user_id: 1, area_id: 1 }` unique | One record per user per area       |
| `growth_areas`  | `{ location: 1, user_id: 1, created_at: 1 }`      | Chronological listing              |
| `children`      | `{ location: 1, _id: 1 }` unique                 | Shard key index                    |
| `children`      | `{ location: 1, user_id: 1, created_at: -1 }`     | Default sort                       |
| `children`      | `{ location: 1, user_id: 1, name: 1 }`            | Name sort                          |
| `missions`      | `{ location: 1, _id: 1 }` unique                 | Shard key index                    |
| `missions`      | `{ location: 1, child_id: 1, created_at: -1 }`    | Per-child listing                  |
| `missions`      | `{ location: 1, child_id: 1, status: 1 }`         | Status filtering                   |
| `missions`      | `{ location: 1, user_id: 1 }`                     | Account deletion cascade           |

---

## Step 8 — Local Development Setup

Atlas M0 (free tier) is a single-region replica set, not a Global Cluster.
It is perfectly fine for local development — data residency is not enforced
but all application logic works identically.

**Recommended local dev flow:**

1. Create a free M0 cluster at <https://cloud.mongodb.com>.
2. Set `MONGODB_URI` in your root `.env` to the M0 connection string.
3. Set `DEFAULT_LOCATION=us` (or any valid location string — it doesn't matter
   for M0 since there is no zone sharding).
4. Run `docker compose up` — the backend connects to Atlas M0 on startup and
   creates all indexes.

**Alternative: local MongoDB (no Atlas account needed):**

```bash
# Start a local MongoDB 7 container on the host network
docker run -d --name mongo-dev -p 27017:27017 mongo:7
```

Then set in `.env`:
```
# On Mac/Windows with Docker Desktop:
MONGODB_URI=mongodb://host.docker.internal:27017
# On Linux with --network host:
MONGODB_URI=mongodb://localhost:27017
```

> **Important:** `mongodb://localhost:27017` inside a Docker container refers to
> the container itself, not the host. Use `host.docker.internal` on Mac/Windows
> (Docker Desktop), or add the Mongo container to the `buddy360_net` network
> and reference it by service name.

---

## Step 9 — Adding a New Location / Region

1. In the Atlas UI, add a new zone to the Global Cluster (new cloud region).
2. Add a zone mapping for the new `location` string (e.g. `"za"` for South
   Africa) following the same pattern as Step 3.
3. Add the new country codes to `COUNTRY_TO_REGION` in
   [`backend/app/routing.py`](backend/app/routing.py).
4. Add the new zone name to this document's zone table (Step 2 and Step 3).
5. Deploy the updated application. Atlas begins routing new documents with the
   new `location` value to the new zone immediately.

Existing users are unaffected — their `location` is set at registration and
never changes. No data migration is needed.

---

## Step 10 — Production Checklist

Before going live, verify:

- [ ] M30+ cluster tier selected (Global Clusters require M30 minimum)
- [ ] All required zones provisioned in Atlas (Step 2)
- [ ] Zone shard mappings configured for all 8 user-data collections (Step 3)
- [ ] `email_index` confirmed as **not** zone-sharded (Step 3)
- [ ] Application user has **Read and write to any database** role (not Atlas admin)
- [ ] Network access restricted to application server egress IPs (no `0.0.0.0/0`)
- [ ] `MONGODB_URI` stored in secrets manager (not in version-controlled `.env`)
- [ ] `DEFAULT_LOCATION` set to your primary zone string (e.g. `"us"`)
- [ ] Atlas Backup enabled with a retention policy
- [ ] Atlas Alerts configured for CPU, replication lag, and connection count
- [ ] `COOKIE_SECURE=true` and `APP_ENV=prod` in production environment

---

## Key Design Decisions

### Why `email_index` is unsharded

Email is global — the same address cannot exist in two zones. An unsharded
collection provides a single authoritative uniqueness guard without scatter-
gather. At login, one cheap lookup on `email_index` (primary shard, tiny
collection) resolves the user's zone; all subsequent hot-path queries are
shard-key-aware and touch only the user's own zone.

### Why transactions exclude `email_index`

MongoDB transactions on Atlas can span multiple sharded collections within
the same zone shard. However, a transaction that includes an unsharded
collection alongside a sharded one becomes a **cross-shard transaction**, which
Atlas M0/M2/M5 free tiers do not support and which adds cross-zone latency on
paid tiers.

Account deletion therefore uses a two-step approach:

1. **Transaction (single zone shard):** revoke tokens → delete sessions, children,
   missions, onboarding, goals, recommendations, growth_areas, user doc.
2. **Post-commit (outside transaction):** delete the `email_index` entry.

If step 2 fails, the orphaned `email_index` entry is reclaimed automatically
the next time someone attempts to register with the same email address.

### Why `location` is immutable

A user's zone is determined at registration from their country code and never
changes. Moving a user between zones would require copying every document across
shards — a complex, expensive migration with no atomic guarantee. If a user
moves countries, their data remains in the original zone. This is both simpler
and compliant: GDPR allows data to remain where it was lawfully collected;
it does not require migration on relocation.
