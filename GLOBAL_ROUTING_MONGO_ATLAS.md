# MongoDB Atlas — Setup & Global Cluster Migration Runbook

How the database is set up today, and the steps to move it to an **Atlas Global Cluster** so
each user's data is stored in their own region. For *why* the design looks like this, see
[`GLOBAL_ROUTING_MONGO.md`](./GLOBAL_ROUTING_MONGO.md). Terraform automation for Atlas is planned
(`docs/infra-architecture-multi-region.md`, Change 10d); these are the manual steps until then.

---

## Where things stand

| | Today | Target |
|---|---|---|
| Cluster | stg and prod: one Atlas **M10** each in **ap-south-1**, over PrivateLink (DB-01, DEC-02). dev and sbx: an **M0** (free) each in ap-south-1. Every environment has its own Atlas project and cluster | Atlas **Global Cluster**, M30+, MongoDB **8.0** |
| Used by | stg and prod: every service in ap-south-1 only (`served_from`, DEC-01). dev and sbx: every service in ap-south-1, eu-west-1 and us-east-1. One database per service (`auth`, `users`, `children`, `onboarding`, `discover`, `grow`, `transform`, `release`), each with its own `MONGODB_URI` | Every region; one cluster; mongos routes by `location` |
| Data residency | Not enforced — everything is stored in ap-south-1 (India); see [docs/data-residency.md](docs/data-residency.md) | Each document stored only in its location's zone |
| App readiness | Every user-owned document has `location`; every unique index on a to-be-sharded collection is `{location, _id}`; login avoids scatter-gather | Ready: see Step 0 |

> **Relation to the infra plan.** [`docs/infra-architecture-multi-region.md`](docs/infra-architecture-multi-region.md)
> Change 10d is the Terraform version of this runbook and sets stricter targets: an **M50** tier,
> `cluster_type = "GEOSHARDED"`, and Atlas traffic over **PrivateLink only** (no NAT/IP list).
> The M30+ tier and the IP access-list option below are the manual minimum; if you follow the
> infra plan, use its numbers.

```
Target layout
┌──────────────────────────────────────────────────────────────────────────┐
│ Atlas Global Cluster — one database per service                           │
│                                                                           │
│  auth: email_index, allowed_emails, deletions, admin_count, worker_state  │
│        ── UNSHARDED (global lookups, primary shard)                       │
│                                                                           │
│  every other collection of every service database                         │
│        ── ZONE-SHARDED on { location: 1, _id: 1 }                         │
│                                                                           │
│  Zone APAC     (ap-south-1 shards)  ◄── location in, apac, me             │
│  Zone EU       (eu-west-1 shards)   ◄── location eu                       │
│  Zone AMERICAS (us-east-1 shards)   ◄── location us, br                   │
└──────────────────────────────────────────────────────────────────────────┘
```

The zone ↔ location mapping is **not** maintained by hand: zone names and locations come from
[`shared/routing.json`](shared/routing.json) — the same file Lambda@Edge routes API calls by and
the regional workers scope their jobs by (see [`shared/README.md`](shared/README.md)).

---

## Step 0 — Code readiness

No code changes are needed before sharding. Each service's collections and indexes are created
by its own code (`ensure_*` in `backend/<service>/app/store.py`, plus the shared helpers in
`backend/common/models.py`, `backend/common/events/store.py` and
`backend/common/upload_tracking.py`), and they were designed for the Global Cluster
(docs/auth-users-split.md, 14):

- every zone-sharded collection has a unique `{location: 1, _id: 1}` index, the shard key;
- no other unique index exists on them — email uniqueness is enforced by the unsharded
  `auth.email_index`, and "one per child" through `_id` (the child id, or `{child_id}:{area_id}`);
- writes filter by `location` as well as `_id` or `user_id`, so they target one zone.

Two things remain an operator's job: run MongoDB **8.0** (Step 2), and scope admin account
listing by location if that scatter matters (`GLOBAL_ROUTING_MONGO.md`, section 10).

---

## Step 1 — Organisation and project

1. Sign in at <https://cloud.mongodb.com>.
2. Use (or create) the **Organisation**, e.g. `superpower`, and a **Project** per environment, e.g.
   `superpower-prod`.

---

## Step 2 — Create the Global Cluster

1. **Build a Database → Advanced Configuration → Global Cluster.**
   - Tier **M30 or higher** (Global Clusters are not available on M0/M2/M5 or below M30).
   - MongoDB version **8.0** (the job workers' claim query needs 7.1+ on a sharded cluster).
2. **Sharding mode: self-managed sharding** (custom zone ranges). Atlas's default *Atlas-managed*
   Global Writes expect ISO country codes in the location field; ours holds location *groups*
   (`eu`, `apac`, …), so the ranges are defined explicitly (Step 4). Confirm the option names
   against the current Atlas documentation when creating the cluster.
3. Add exactly three zones, named as below — the names must match each region's `atlas_zone`
   in [`shared/routing.json`](shared/routing.json):

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

## Step 3 — Database users

1. **Database Access → Add New Database User**, password authentication — **one per service with
   a database** (auth, users, children, onboarding, discover, grow, transform, release; shared has
   none), so a service can't read another's data.
2. Role: a custom role with **readWrite** and the **collMod** action on that service's database only (each service keeps its collections' `$jsonSchema` validators current with `collMod`, which `readWrite` lacks). The database is named after the service:
   `MONGODB_DB_NAME` is the service name both in deployed environments
   ([`infra-live-backend/terraform/services.tf`](infra-live-backend/terraform/services.tf)) and in
   `docker-compose.yml`. Use a separate admin user for the sharding commands in Step 4.
3. Store each password in that service's Secrets Manager secret only (Step 6).

---

## Step 4 — Zone-shard the collections

Do this on the **empty** cluster, before loading any data.

1. **Create the services' indexes first.** Start each service (or its worker) once against the new
   cluster: both run `runtime.prepare()` at startup, which creates the collections and indexes,
   *before* `zone-setup.js`. `shardCollection` reuses an existing index on the shard key; if none
   exists it creates a **non-unique** `location_1__id_1`, and the service's later request for a
   **unique** index under that same name fails with an index-options conflict — the service won't
   start. Verify this order once on a scratch cluster.

2. Generate the commands from the code. For each service database it prints
   `sh.updateZoneKeyRange` for every sharded collection × location (6 locations), then
   `sh.shardCollection` for each sharded collection; with no arguments it covers every service
   with a database:

   ```bash
   python backend/tools/atlas_zone_ranges.py > zone-setup.js            # every service
   python backend/tools/atlas_zone_ranges.py auth users > zone-setup.js  # only these
   ```

   An unknown service, or one without a database (`shared`), exits with status 2.

3. Review it, then run it with the admin user:

   ```bash
   mongosh "<connection string>" --username <admin> zone-setup.js
   ```

   Zone ranges are defined first so each empty collection is pre-split straight onto its zones'
   shards.

4. Resulting shard keys: every collection in the script's `SHARDED` table is sharded on
   `{ location: 1, _id: 1 }`. Only auth's `email_index`, `allowed_emails`, `deletions`,
   `admin_count` and `worker_state` (`UNSHARDED`) are **not sharded**; the script lists them in a
   comment and leaves them alone.

5. Verify with `sh.status()` and, after data is loaded, `db.<coll>.getShardDistribution()`.

The script's collection tables are checked against the code by
[`backend/tools/tests/test_atlas_zone_ranges.py`](backend/tools/tests/test_atlas_zone_ranges.py)
(`cd backend && .venv/bin/pytest tools/tests/test_atlas_zone_ranges.py`): every service with a
database must be in the table, each service's list must match exactly the collections its code
creates, and every location of every collection must be assigned to its zone. Adding a collection
fails the test until it is explicitly placed as zone-sharded or unsharded.

---

## Step 5 — Network access

The backends reach Atlas from three regions. Either:

- **IP access list:** add **every** NAT gateway public IP in each region (no `0.0.0.0/0`). ECS
  tasks run in private subnets (`assign_public_ip = false`) and reach Atlas through the NAT
  gateways, and their count differs per environment (`nat_gateway_count`: 1 per region in
  dev/sbx, 2 in stg, 3 in prod — so 9 IPs for prod across three regions):

  ```bash
  aws ec2 describe-nat-gateways --region <region> --filter Name=state,Values=available \
    --query 'NatGateways[].NatGatewayAddresses[].PublicIp' --output text
  ```

  Run for every deployed region. A missing IP shows up as that region's **service tasks and
  workers failing to start** — startup collection and index creation (`runtime.prepare()`) times
  out after ~30 s of server selection.

- **PrivateLink** per region — planned, see `docs/infra-architecture-multi-region.md` Change 10d.

---

## Step 6 — Connection strings

1. **Connect → Drivers → Python**, copy the `mongodb+srv://` URI; build one per service with that
   service's database user (Step 3).
2. Put each in the `MONGODB_URI` key of that service's `<APP_NAME>/<env>/<service>-secrets`
   secret in each region (`APP_NAME` is the GitHub secret, e.g. `superpower`; same value in all
   three regions — a service and its worker share the secret). Rotating it later:
   `put-secret-value` replaces the whole JSON, so include every key (see
   [`infra-live-backend/terraform/secrets.tf`](infra-live-backend/terraform/secrets.tf)).
3. Redeploy the services in each region so tasks pick it up.

---

## Step 7 — Indexes (created by the services)

Each service creates its own collections and indexes in `runtime.prepare()`, run at startup by
both its HTTP app and its worker; it is idempotent, and it creates indexes but never drops them.
The code is the reference — each service's `app/store.py` and the shared helpers named in
Step 0 — and docs/auth-users-split.md, 14 lists the set. In short:

| Collections | Indexes |
|---|---|
| Every zone-sharded collection | `{ location: 1, _id: 1 }` unique (shard key index), plus `{ location: 1, user_id: 1 }` (user deletion) and other location-led indexes |
| `jobs` (discover, grow, transform, release) | Location-led indexes for the claim, in-flight check and deletion; TTL 7 days on `completed_at` |
| `outbox` | `{ region: 1, published_at: 1, created_at: 1 }` (relay polling, own region); TTL after `published_at` |
| `auth.sessions` | TTL on `expires_at` (expired sessions go by themselves) |
| auth's unsharded collections | Keyed by `_id`; `email_index` also `{ user_id: 1 }` |

TTL indexes are single-field, so they don't lead with `location` (see Key design decisions).

---

## Step 8 — Migrate the data from M0

1. Freeze writes (maintenance window) or use Atlas **Live Migration**, if available for the
   source tier, into the already-sharded target.
2. Otherwise `mongodump` from M0 and `mongorestore` into the Global Cluster **after** Step 4, so
   documents land directly in their zones. Restore with **`--noIndexRestore`** — the dump carries
   the source's index definitions, and the services have
   already created the right ones (Step 4.1). Restore **only the collections listed in
   [`backend/tools/atlas_zone_ranges.py`](backend/tools/atlas_zone_ranges.py)** (`SHARDED` and
   `UNSHARDED`), each into its service's database: anything else would land unsharded.
3. Verify counts per collection and per `location`, then switch `MONGODB_URI` (Step 6).

Documents keep their `location`; nothing is recomputed. Correcting legacy accounts (e.g. users
saved as `"us"` from a then-unmapped country — their real `country_code` is on the `auth.auth` document)
is a separate, deliberate migration: changing `location` moves every one of that user's documents
to another zone.

---

## Step 9 — Local development

Any single MongoDB **replica set** works (the services use transactions and change streams, which
a standalone server lacks); zones don't apply. The compose stack's `mongo` service is a
single-node replica set, and every service in compose connects to it with its own database
(`MONGODB_DB_NAME` = the service):

```
# inside compose (set by docker-compose.yml):
MONGODB_URI=mongodb://mongo:27017/?directConnection=true
# from the host (tests: MONGODB_TEST_URI):
mongodb://localhost:27017/?directConnection=true
```

Local workers process every location: region scoping is off when `APP_ENV=local`, which compose
sets.

---

## Step 10 — Adding a country, location or region

Everything starts in [`shared/routing.json`](shared/routing.json) — see
[`shared/README.md`](shared/README.md) for the rules and per-change steps. In short: edit the file,
run `node scripts/sync-routing.mjs`, commit the regenerated files, deploy backend + frontends
together, and apply the edge Terraform (it reads the JSON directly). Atlas-specific extras:

- **New location** on an existing region: once on the Global Cluster, add its zone ranges — the
  new location's lines from `python backend/tools/atlas_zone_ranges.py [service ...]`, for every
  service database.
- **New AWS region:** add it under `regions` with its `atlas_zone`; deploy the backend there; add
  it to the edge's `backend_regions` (keep `ap-south-1` first — the bootstrap region for login);
  add the zone in Atlas; allow its NAT IP (Step 5).

---

## Step 11 — Production checklist

- [ ] Global Cluster: M30+, MongoDB 8.0, zones `APAC` / `EU` / `AMERICAS` in the right regions
- [ ] Each service started once on the empty cluster (its indexes created), then `zone-setup.js` (generated from the deployed code) run; `sh.status()` shows 6 ranges per sharded collection
- [ ] auth's `email_index`, `allowed_emails`, `deletions`, `admin_count`, `worker_state` **not** sharded
- [ ] One database user per service, `readWrite` plus `collMod` on its own database only
- [ ] Network access: every NAT gateway IP in every region (9 for prod) or PrivateLink; no `0.0.0.0/0`
- [ ] Each service's `MONGODB_URI` in its Secrets Manager secret in each region; services redeployed
- [ ] Backups enabled, each zone's snapshots stored in its own region
- [ ] Atlas alerts: CPU, replication lag, connections, balancer/chunk-migration errors
- [ ] Data restored with `--noIndexRestore`, only the collections in the zone tool's tables
- [ ] Edge `backend_regions` = `["ap-south-1","eu-west-1","us-east-1"]`

---

## Key design decisions

### `email_index` stays unsharded

Email is global — one address can't exist in two zones. An unsharded collection is a single
authoritative uniqueness guard (its `_id` is the email's HMAC key, docs/auth-users-split.md, 6)
and the login router: one small lookup returns `{user_id, location}`, after which every query is
shard-key targeted. It holds no email in plaintext — only the key, user id, location and status;
the one plaintext copy is in `auth.auth`, in the user's own zone.

### Transactions stay in one zone; `email_index` stays outside them

The services use transactions (for example account-deletion start, logout-all, job creation),
each within one user's documents in one service's database (one location → one zone). Nothing
unsharded joins them — `email_index` lives on the primary shard, which would make the
transaction cross-shard. So registration is a saga instead: it reserves the email in
`email_index` first, inserts `auth.auth` second, activates the reservation last, and undoes the
earlier steps if a later one fails; a stale reservation is taken over by the next attempt
(`backend/auth/app/registration.py`). Account deletion deletes the credentials and the
`email_index` entry last, once every service has confirmed (`backend/auth/app/deletion.py`).

### Login always runs in the bootstrap region

Login and Google sign-in carry no token yet, so the edge sends them to `backend_regions[0]`
(ap-south-1). The email lookup there is cheap; the user's location is then put in the tokens and
every later call goes to the user's own region.

### `location` is immutable

Set at registration from the declared country; never changed when a user moves. Changing it would
move all of a user's documents across zones with no atomic guarantee, and GDPR allows data to stay
where it was lawfully collected.

### TTL indexes can't include `location`

MongoDB TTL indexes must be single-field, so they don't lead with `location`; on a sharded
cluster each shard expires its own documents. `jobs` uses `completed_at` (7 days), `auth.sessions`
`expires_at`, and the outbox, tombstones, guards and audit their own timestamps.
