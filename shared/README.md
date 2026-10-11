# `shared/routing.json` — country → location → region → zone

The **single source of truth** for where every user is served from and (once on an Atlas Global
Cluster) where their data is stored. Edit only this file; everything else is derived from it.

```bash
node scripts/sync-routing.mjs          # regenerate the code copies after editing
node scripts/sync-routing.mjs --check  # what CI runs — fails if a copy is stale
```

## What it contains

| Key | Meaning |
|---|---|
| `regions` | AWS region → `atlas_zone` (zone name on the Global Cluster) and the `locations` it serves. Each location belongs to exactly one region |
| `countries` | Every country/territory a user can register from: ISO-3166-1 alpha-2 `code`, display `label`, assigned `location` |
| `blocked_countries` | Never served — not offered, refused at registration, geo-blocked at the WAF |

The script validates the file before generating anything: well-formed and unique codes, every
country's location belongs to a region, every location has at least one country, no country is
both mapped and blocked, and labels are safe to embed in code.

## Who uses it

| Consumer | How | Uses |
|---|---|---|
| `backend/app/routing_data.py` | **Generated** (committed) | Registration: `country_code` → `location`; validation; blocked-country 403; worker region scoping; Atlas zone script |
| `frontend/src/lib/countries.ts`, `frontend-app/src/lib/countries.ts` | **Generated** (committed) | Country selector |
| `frontend/src/lib/locationHint.ts`, `frontend-app/src/lib/locationHint.ts` | **Generated** (committed) | `X-Client-Location` registration hint |
| `infra-live-edge/terraform/routing.tf` | **Read directly** (`jsondecode(file(...))`) | Lambda@Edge API routing, CloudFront `/uploads/{location}/*` routing, WAF geo-block list |
| `backend/tools/atlas_zone_ranges.py` | Via `routing_data.py` | Atlas zone ranges for the Global Cluster |

Generated files are committed (not built on the fly) because the web frontend's Docker build
and the mobile app's Metro bundler can only see their own folders. Don't edit them by hand — the
next sync overwrites them and CI rejects a mismatch.

## Grouping rules

| Location | Region | Covers |
|---|---|---|
| `eu` | eu-west-1 | Europe (EU/EEA, UK, CH, Balkans, UA, TR, microstates); all of Africa except Egypt; Caucasus & Central Asia; EU outermost regions |
| `me` | ap-south-1 | Middle East, incl. Egypt |
| `in` | ap-south-1 | India |
| `apac` | ap-south-1 | Rest of South Asia, East & Southeast Asia, Oceania |
| `us` | us-east-1 | North & Central America, Caribbean, US territories |
| `br` | us-east-1 | South America |

- **Territories follow their sovereign's data-protection law, not geography.** EU outermost
  regions (Guadeloupe, Martinique, French Guiana, Réunion, Mayotte, Saint Martin) are EU territory
  where GDPR applies → `eu`. US territories (Puerto Rico, Guam, USVI, American Samoa, Northern
  Mariana Islands) → `us`. Non-EU overseas territories (e.g. French Polynesia, Aruba) follow
  geography.
- **Sub-Saharan Africa → `eu`** for cross-border-transfer-law reasons as much as latency:
  Nigeria's NDPA, South Africa's POPIA, Kenya's DPA and similar laws are GDPR-modelled and
  reference GDPR-style adequacy, making eu-west-1 the more defensible destination than ap-south-1
  or us-east-1. Not a substitute for a privacy-law review before launching in a market.
- **Caucasus & Central Asia → `eu`.** Georgia/Armenia/Azerbaijan are close to Europe with
  GDPR-style laws; Central Asian traffic largely routes via Europe anyway.
- **South Asia outside India (PK, BD, NP, LK, BT, MV, AF) → `apac`, not `in`** — same physical
  region (ap-south-1), but non-Indian accounts are never labelled with the `in` location value.
- **Blocked: `BY CN CU IR KP RU SY`.** China legitimately requires AWS's separate China
  partition (a different account/infrastructure). The rest are under comprehensive sanctions —
  export-control (OFAC/EAR) exposure this business has decided not to take on. Legacy accounts
  that already carry `location: "cn"`/`"ru"` get a 503 at the edge (no region serves them).
- **Coverage:** all 249 ISO-3166-1 codes are accounted for — mapped, blocked, or one of six with
  no permanent population and deliberately absent (AQ, BV, GS, HM, TF, UM) — plus `XK` (Kosovo,
  user-assigned but widely used). The backend rejects any other code (422) instead of defaulting.

These groupings are engineering defaults, not legal advice.

## Changing it

| Change | Steps |
|---|---|
| Add/move a country | Edit `countries`, run the sync, commit. Deploy backend + frontends together. **Existing accounts keep their location** — moving them is a data migration (on a sharded cluster their documents change zone) |
| New location on an existing region | Add it to that region's `locations` and assign countries to it; sync; apply the edge Terraform; on a Global Cluster, add its zone ranges (`backend/tools/atlas_zone_ranges.py`) |
| New AWS region | Add it under `regions` (with its `atlas_zone`); deploy the backend there; add it to the edge's `backend_regions` (keep `ap-south-1` first — it's the bootstrap region for login); on a Global Cluster, add the zone |
| Block/unblock a country | Edit `blocked_countries` (and remove/add it in `countries`); sync; deploy backend + frontends; apply the edge Terraform (WAF) |

The mobile app's copy only updates when users install a new app release.

See [`GLOBAL_ROUTING_MONGO.md`](../GLOBAL_ROUTING_MONGO.md) for the end-to-end architecture.
