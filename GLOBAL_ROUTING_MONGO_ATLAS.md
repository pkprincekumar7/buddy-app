# MongoDB Atlas — Setup & Global Cluster Migration Runbook

How the database is set up today, and the steps to move it to an **Atlas Global Cluster** so
each user's data is stored in their own region. For *why* the design looks like this, see
[`GLOBAL_ROUTING_MONGO.md`](./GLOBAL_ROUTING_MONGO.md). Terraform automation for Atlas is planned
(`docs/infra-architecture-multi-region.md`, Change 10d); these are the manual steps until then.

---

## Where things stand

| | Today | Target |
|---|---|---|
| Cluster | One Atlas **M0** (free) replica set in **ap-south-1** | Atlas **Global Cluster**, M30+, MongoDB **8.0** |
| Used by | Backends in ap-south-1, eu-west-1 and us-east-1 (same `MONGODB_URI`) | Same — one connection string; mongos routes by `location` |
| Data residency | Not enforced — everything is stored in ap-south-1 | Each document stored only in its location's zone |
| App readiness | Every user-owned document has `location`; every index leads with it; login avoids scatter-gather | Needs the code changes in Step 0 |

```
Target layout
┌──────────────────────────────────────────────────────────────────────────┐
│ Atlas Global Cluster (one connection string)                              │
│                                                                           │
│  email_index, allowed_emails ── UNSHARDED (global lookups, primary shard) │
│                                                                           │
│  users · sessions · children · observations · ninety_day_plans            │
│  growth_areas · jobs ── ZONE-SHARDED, shard key leads with `location`     │
│                                                                           │
│  Zone APAC     (ap-south-1 shards)  ◄── location in, apac, me             │
│  Zone EU       (eu-west-1 shards)   ◄── location eu                       │
│  Zone AMERICAS (us-east-1 shards)   ◄── location us, br                   │
└──────────────────────────────────────────────────────────────────────────┘
```

The zone ↔ location mapping is **not** maintained by hand: it is generated from
`REGION_TO_LOCATIONS` in [`backend/app/routing.py`](backend/app/routing.py) — the same mapping
Lambda@Edge routes API calls by and the regional workers scope their jobs by.

---

## Step 0 — Code changes that must ship before sharding

| # | Change | Why |
|---|---|---|
| 1 | `users`: make `(location, email)` **non-unique** in [`database.py`](backend/app/database.py) | On a sharded collection a unique index must start with the **full** shard key (`location, _id`). Email uniqueness is already guaranteed globally by `email_index` |
| 2 | `growth_areas`: make `(location, _id)` **non-unique** | `growth_areas` is sharded on `{location, user_id}` so its existing unique `(location, user_id, child_id, area_id)` stays valid; a unique `(location, _id)` would not |
| 3 | Add `location` to the worker's `jobs` updates by `job_id` and `children` updates by `_id` ([`worker.py`](backend/worker.py)) | Otherwise every such update fans out to all zones. The job document already carries `location` |
| 4 | Scope admin `list_users` ([`routers/admin.py`](backend/app/routers/admin.py)) to a chosen `location` | Unfiltered, it is a cross-zone scatter-gather |
| 5 | Optional: resolve the `TODO(M10+)` transaction markers (account deletion, job enqueue) | Transactions become available on M10+; keep `email_index` outside them |

`jobs` is sharded on `{location, job_id}`: its unique `(location, job_id, user_id)` index already
starts with that key, so no index change is needed there.

Dropping or changing a unique index in `init_indexes()` does **not** remove the old index from an
existing database — drop the old one manually (Step 7).

---

## Step 1 — Organisation and project

1. Sign in at <https://cloud.mongodb.com>.
2. Use (or create) the **Organisation**, e.g. `buddy360`, and a **Project** per environment, e.g.
   `buddy360-prod`.

---

## Step 2 — Create the Global Cluster

1. **Build a Database → Advanced Configuration → Global Cluster.**
   - Tier **M30 or higher** (Global Clusters are not available on M0/M2/M5 or below M30).
   - MongoDB version **8.0** (the worker's claim query needs 7.1+ on a sharded cluster).
2. **Sharding mode: self-managed sharding** (custom zone ranges). Atlas's default *Atlas-managed*
   Global Writes expect ISO country codes in the location field; ours holds location *groups*
   (`eu`, `apac`, …), so the ranges are defined explicitly (Step 4). Confirm the option names
   against the current Atlas documentation when creating the cluster.
3. Add exactly three zones, named as below — the names must match
   `ZONE_FOR_REGION` in [`backend/tools/atlas_zone_ranges.py`](backend/tools/atlas_zone_ranges.py):

   | Zone name | Cloud region | Locations it will hold |
   |---|---|---|
   | `APAC` | AWS ap-south-1 | `in`, `apac`, `me` |
   | `EU` | AWS eu-west-1 | `eu` |
   | `AMERICAS` | AWS us-east-1 | `us`, `br` |

4. Enable **Backup** (continuous cloud backup) and confirm each zone's snapshots are stored in
   that zone's region.
5. Create the cluster (provisioning takes a while).

There is no `cn`/`ru` zone. Those countries are blocked at registration (and at the WAF in
stg/prod); a few legacy accounts may still carry `location: "cn"/"ru"` and are already refused
(503) at the edge.

---

## Step 3 — Database user

1. **Database Access → Add New Database User**, password authentication, e.g. `buddy360app`.
2. Role: **readWrite** on the application database (`MONGODB_DB_NAME`, default `buddy_app`).
   Use a separate admin user for the sharding commands in Step 4.
3. Store the password in Secrets Manager only.

---

## Step 4 — Zone-shard the collections

Do this on the **empty** cluster, before loading any data.

1. Generate the commands from the code (prints `sh.updateZoneKeyRange` for every
   collection × location — 7 × 6 = 42 ranges — then `sh.shardCollection` for each collection):

   ```bash
   python backend/tools/atlas_zone_ranges.py <MONGODB_DB_NAME> > zone-setup.js
   ```

2. Review it, then run it with the admin user:

   ```bash
   mongosh "<connection string>" --username <admin> zone-setup.js
   ```

   Zone ranges are defined first so each empty collection is pre-split straight onto its zones'
   shards.

3. Resulting shard keys:

   | Collection | Shard key |
   |---|---|
   | `users`, `sessions`, `children`, `observations`, `ninety_day_plans` | `{ location: 1, _id: 1 }` |
   | `growth_areas` | `{ location: 1, user_id: 1 }` |
   | `jobs` | `{ location: 1, job_id: 1 }` |
   | `email_index`, `allowed_emails` | **not sharded** |

4. Verify with `sh.status()` and, after data is loaded, `db.<coll>.getShardDistribution()`.

The script's collection list is checked against [`backend/app/models.py`](backend/app/models.py)
by [`backend/tests/test_atlas_zone_ranges.py`](backend/tests/test_atlas_zone_ranges.py): adding a
collection fails the test until it is explicitly placed as zone-sharded or unsharded.

---

## Step 5 — Network access

The backends reach Atlas from three regions. Either:

- **IP access list:** add each region's NAT gateway public IP (no `0.0.0.0/0`):

  ```bash
  aws ec2 describe-nat-gateways --region <region> --filter Name=state,Values=available \
    --query 'NatGateways[].NatGatewayAddresses[].PublicIp' --output text
  ```

  Run for ap-south-1, eu-west-1 and us-east-1. A missing region shows up as that region's API
  calls hanging ~30 s and failing (the backend only connects on first query).

- **PrivateLink** per region — planned, see `docs/infra-architecture-multi-region.md` Change 10d.

---

## Step 6 — Connection string

1. **Connect → Drivers → Python**, copy the `mongodb+srv://` URI.
2. Put it in the `MONGODB_URI` key of each region's `buddy360/<env>/backend-secrets` secret
   (same value in all three regions — the API and worker both read it). Rotating it later:
   `put-secret-value` replaces the whole JSON, so include every key (see
   [`infra-live-backend/terraform/secrets.tf`](infra-live-backend/terraform/secrets.tf)).
3. Redeploy the backend in each region so tasks pick it up.

---

## Step 7 — Indexes (created by the application)

`init_indexes()` in [`backend/app/database.py`](backend/app/database.py) runs on every API
startup (not the worker) and is idempotent. It creates indexes; it never drops them. Current set:

| Collection | Index | Notes |
|---|---|---|
| `email_index` | `{ user_id: 1 }` | Reverse lookup |
| `users` | `{ location: 1, _id: 1 }` unique | Shard key index |
| `users` | `{ location: 1, email: 1 }` unique | **Make non-unique before sharding** (Step 0) |
| `users` | `{ location: 1, role: 1 }` | |
| `sessions` | `{ location: 1, _id: 1 }` unique | Shard key index |
| `sessions` | `{ location: 1, expires_at: 1 }` | Expiry cleanup (no TTL — TTL can't be compound) |
| `sessions` | `{ location: 1, user_id: 1 }` | Logout-all / deletion |
| `observations` | `{ location: 1, _id: 1 }` unique | `_id` = child id |
| `ninety_day_plans` | `{ location: 1, _id: 1 }` unique | `_id` = child id |
| `growth_areas` | `{ location: 1, _id: 1 }` unique | **Make non-unique before sharding** (Step 0) |
| `growth_areas` | `{ location: 1, user_id: 1, child_id: 1, area_id: 1 }` unique | One record per user/child/area |
| `children` | `{ location: 1, _id: 1 }` unique | Shard key index |
| `children` | `{ location: 1, user_id: 1, created_at: -1 }` partial `is_deleted: false` | Default list order |
| `children` | `{ location: 1, user_id: 1, name: 1 }` partial `is_deleted: false` | Name sort |
| `children` | `{ location: 1, deleted_at: 1 }` partial `is_deleted: true` | Soft-delete purge (no purge job exists yet) |
| `jobs` | `{ location: 1, status: 1, retry_after: 1, created_at: 1 }` | Worker claim |
| `jobs` | `{ location: 1, job_id: 1, user_id: 1 }` unique | Client polling; valid under shard key `{location, job_id}` |
| `jobs` | `{ location: 1, user_id: 1, child_id: 1, type: 1, status: 1 }` | In-flight cap check |
| `jobs` | `{ location: 1, status: 1, claimed_at: 1 }` | Stale-claim recovery |
| `jobs` | `{ location: 1, status: 1, domain_write_attempt: 1 }` partial `status: result_ready` | Domain-write retry |
| `jobs` | `{ completed_at: 1 }` TTL 24 h, partial `status ∈ {completed, failed}` | TTL must be single-field, so no `location` |

**Superseded indexes to drop by hand** on any database created before the location-first `jobs`
indexes (only after the new code runs in every region — an old worker without them would scan
the collection):

```javascript
db.jobs.dropIndex("status_1_retry_after_1_created_at_1")
db.jobs.dropIndex("status_1_claimed_at_1")
db.jobs.dropIndex("status_1_domain_write_attempt_1")
```

---

## Step 8 — Migrate the data from M0

1. Freeze writes (maintenance window) or use Atlas **Live Migration**, if available for the
   source tier, into the already-sharded target.
2. Otherwise `mongodump` from M0 and `mongorestore` into the Global Cluster **after** Step 4, so
   documents land directly in their zones.
3. Verify counts per collection and per `location`, then switch `MONGODB_URI` (Step 6).

Documents keep their `location`; nothing is recomputed. Correcting legacy accounts (e.g. users
saved as `"us"` from a then-unmapped country — their real `country_code` is on the user document)
is a separate, deliberate migration: changing `location` moves every one of that user's documents
to another zone.

---

## Step 9 — Local development

Any single MongoDB works — M0 or a local container; zones don't apply:

```bash
docker run -d --name mongo-dev -p 27017:27017 mongo:8
```

```
# .env — Docker Desktop (backend in Compose, Mongo on the host):
MONGODB_URI=mongodb://host.docker.internal:27017
# backend run directly on the host:
MONGODB_URI=mongodb://localhost:27017
```

`localhost` inside a container is the container itself — use `host.docker.internal`, or attach
Mongo to the `buddy360_net` network and use its service name. The local worker processes every
location (it is only region-scoped when `WORKER_SCOPE_TO_REGION=true`, which only ECS sets), even
though `.env.example` sets `AWS_REGION` for S3.

---

## Step 10 — Adding a country, location or region

**A country to an existing location** — edit `COUNTRY_TO_REGION` in `routing.py`, then mirror it in
`frontend{,-app}/src/lib/countries.ts` and `locationHint.ts`. `pytest` fails until all copies
match. No Atlas change.

**A new location** (e.g. `af`) on an existing region — all of these, in one change:

1. `COUNTRY_TO_REGION` and `REGION_TO_LOCATIONS` (`routing.py`)
2. `LOCATION_TO_REGION` in `infra-live-edge/functions/jwt-validator-lambda.js.tpl`
3. `uploads_location_to_region` in `infra-live-edge/terraform/cloudfront.tf`
4. The four frontend files above
5. Atlas: regenerate and run the new zone ranges (Step 4, new location's lines only)

**A new AWS region** — backend Terraform + deploy in that region; add it to the edge's
`backend_regions` (keep `ap-south-1` first — it's the bootstrap region for login); add it to
`REGION_TO_LOCATIONS`, `ZONE_FOR_REGION` and the Lambda/CloudFront maps; add the Atlas zone; allow
its NAT IP (Step 5).

---

## Step 11 — Production checklist

- [ ] Step 0 code changes deployed in every region
- [ ] Global Cluster: M30+, MongoDB 8.0, zones `APAC` / `EU` / `AMERICAS` in the right regions
- [ ] `zone-setup.js` generated from the deployed code and run; `sh.status()` shows 42 ranges
- [ ] `email_index` and `allowed_emails` **not** sharded
- [ ] App user has `readWrite` on the app database only
- [ ] Network access: three NAT IPs (or PrivateLink); no `0.0.0.0/0`
- [ ] `MONGODB_URI` in each region's Secrets Manager secret; backends redeployed
- [ ] Backups enabled, each zone's snapshots stored in its own region
- [ ] Atlas alerts: CPU, replication lag, connections, balancer/chunk-migration errors
- [ ] Superseded `jobs` indexes dropped (Step 7)
- [ ] Edge `backend_regions` = `["ap-south-1","eu-west-1","us-east-1"]`

---

## Key design decisions

### `email_index` stays unsharded

Email is global — one address can't exist in two zones. An unsharded collection is a single
authoritative uniqueness guard (its `_id` is the email) and the login router: one small lookup
returns `{user_id, location}`, after which every query is shard-key targeted. It holds only email,
user id and location.

### No transactions today; `email_index` outside them later

M0 has no transactions, so registration reserves the email in `email_index` first, inserts the
user second, and deletes the reservation if the insert fails; a leftover reservation without a
user is reclaimed on the next attempt. Account deletion deletes user data first and the
`email_index` entry last (best effort, same reclaim). After the upgrade, transactions can cover a
single user's documents (one location → one zone) but never `email_index` — it lives on the
primary shard, which would make the transaction cross-shard.

### Login always runs in the bootstrap region

Login and Google sign-in carry no token yet, so the edge sends them to `backend_regions[0]`
(ap-south-1). The email lookup there is cheap; the user's location is then put in the tokens and
every later call goes to the user's own region.

### `location` is immutable

Set at registration from the declared country; never changed when a user moves. Changing it would
move all of a user's documents across zones with no atomic guarantee, and GDPR allows data to stay
where it was lawfully collected.

### TTL indexes can't include `location`

MongoDB TTL indexes must be single-field. `jobs` uses a single-field `completed_at` TTL (each shard
expires its own documents); `sessions` has no TTL and is cleaned hourly by the API instead.
