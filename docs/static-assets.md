# Static Assets (Images)

Activity-game images (used in `ChildActivityGame`) are stored in S3 and served differently depending on the environment. **Two separate buckets are used** — a dedicated local bucket that is never touched by Terraform, and per-environment deployed buckets managed entirely by Terraform.

## How images are served

| Environment | Bucket | Path | How it works |
|---|---|---|---|
| **Local dev** | dedicated local bucket (set via `ASSETS_BUCKET_NAME` in `.env`) | `/app-assets/<path>` via Vite proxy | `vite.config.js` proxies `/app-assets/*` to `https://<bucket>.s3.us-east-1.amazonaws.com`. The bucket has a public `s3:GetObject` policy on `app-assets/*` — no AWS credentials required. |
| **Deployed (dev/stg/prod)** | per-environment bucket (set via `ASSETS_BUCKET_NAME` GitHub secret) | `/app-assets/<path>` via CloudFront | CloudFront `/app-assets/*` behaviour proxies to the bucket using OAC (SigV4 signing). No public S3 access needed. |

In all environments the frontend resolves a theme-aware path at runtime — `astronaut.jpg` stored in S3 becomes `/app-assets/child_activity_game/life_ambition/astronaut_vg_dark.png` or `…_vg_light.png` depending on the active theme. Avatar stage images follow the same pattern: `stage-01-dark.png` / `stage-01-light.png`. No environment-specific URL logic lives in the component. If an image fails to load, the component falls back to an emoji/gradient tile automatically.

> **Note — CDN edge caching:** Local dev sends requests directly to the S3 regional endpoint in `us-east-1` — there is no CDN, no edge caching, and no geographic distribution. Only deployed CloudFront distributions serve from edge locations.

## S3 bucket folder structure

Images live under the `app-assets/` prefix, organised by growth area:

```
app-assets/
  child_activity_game/
    life_ambition/          astronaut_vg_dark.png,     astronaut_vg_light.png,
                            sports_person_vg_dark.png, sports_person_vg_light.png,
                            like_my_parents_vg_dark.png, like_my_parents_vg_light.png,
                            super_hero_vg_dark.png,    super_hero_vg_light.png,
                            dancer_vg_dark.png,        dancer_vg_light.png,
                            scientist_vg_dark.png,     scientist_vg_light.png
    self_care/              reading_vg_dark.png,       reading_vg_light.png,
                            listening_to_music_vg_dark.png, listening_to_music_vg_light.png,
                            being_in_nature_vg_dark.png, being_in_nature_vg_light.png,
                            drawing_painting_vg_dark.png, drawing_painting_vg_light.png,
                            resting_sleeping_vg_dark.png, resting_sleeping_vg_light.png,
                            exercise_vg_dark.png,      exercise_vg_light.png
    critical_thinking/      solving_puzzles_vg_dark.png, solving_puzzles_vg_light.png,
                            science_experiments_vg_dark.png, science_experiments_vg_light.png,
                            debates_arguments_vg_dark.png, debates_arguments_vg_light.png,
                            strategy_games_vg_dark.png, strategy_games_vg_light.png,
                            solving_mysteries_vg_dark.png, solving_mysteries_vg_light.png,
                            inventing_things_vg_dark.png, inventing_things_vg_light.png
    creativity/             drawing_art_vg_dark.png,   drawing_art_vg_light.png,
                            storytelling_vg_dark.png,  storytelling_vg_light.png,
                            making_music_vg_dark.png,  making_music_vg_light.png,
                            building_making_vg_dark.png, building_making_vg_light.png,
                            acting_drama_vg_dark.png,  acting_drama_vg_light.png,
                            cooking_baking_vg_dark.png, cooking_baking_vg_light.png
    physical_wellness/      football_soccer_vg_dark.png, football_soccer_vg_light.png,
                            swimming_vg_dark.png,      swimming_vg_light.png,
                            cycling_vg_dark.png,       cycling_vg_light.png,
                            dancing_vg_dark.png,       dancing_vg_light.png,
                            yoga_stretching_vg_dark.png, yoga_stretching_vg_light.png,
                            running_vg_dark.png,       running_vg_light.png
    social_skills/          helping_others_vg_dark.png, helping_others_vg_light.png,
                            leading_a_group_vg_dark.png, leading_a_group_vg_light.png,
                            listening_to_friends_vg_dark.png, listening_to_friends_vg_light.png,
                            working_in_a_team_vg_dark.png, working_in_a_team_vg_light.png,
                            making_new_friends_vg_dark.png, making_new_friends_vg_light.png,
                            enjoying_my_own_time_vg_dark.png, enjoying_my_own_time_vg_light.png
  avatars/
    — video stages (1, 2, 4, 7) — .mp4 only, no .png:
    stage-01-dark.mp4  stage-01-light.mp4
    stage-02-dark.mp4  stage-02-light.mp4
    stage-04-dark.mp4  stage-04-light.mp4
    stage-07-dark.mp4  stage-07-light.mp4
    — image stages (3, 5, 6, 8, 9, 10) — .png only, no .mp4:
    stage-03-dark.png  stage-03-light.png
    stage-05-dark.png  stage-05-light.png
    stage-06-dark.png  stage-06-light.png
    stage-08-dark.png  stage-08-light.png
    stage-09-dark.png  stage-09-light.png
    stage-10-dark.png  stage-10-light.png
```

## Step 1 — Create and configure the local bucket (one-time)

This is a **dedicated bucket used only for local development**. It is never referenced by Terraform, so its configuration is managed manually and will never be overwritten by a Terraform apply or destroy.

### 1a. Create the bucket

1. Open the [S3 console](https://s3.console.aws.amazon.com/s3/) and click **Create bucket**
2. Set **Bucket name** to your chosen local bucket name — note it down, you will set this as `ASSETS_BUCKET_NAME` in `.env`
3. Set **AWS Region** to `us-east-1`
4. Leave all other settings at their defaults and click **Create bucket**

### 1b. Relax Block Public Access

1. Click on the bucket you just created → **Permissions** tab → **Block public access (bucket settings)** → **Edit**
2. Uncheck the following two settings:
   - **Block public access to buckets and objects granted through new public bucket or access point policies**
   - **Block public and cross-account access to buckets and objects through any public bucket or access point policies**
3. Leave the top two checkboxes checked (they block ACL-based public access, which is not used here)
4. Click **Save changes** → type `confirm` → **Confirm**

### 1c. Add a bucket policy

1. Still on the **Permissions** tab, scroll to **Bucket policy** → **Edit**
2. Paste the following (replace `<your-local-bucket>` with your actual bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicGetAssets",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<your-local-bucket>/app-assets/*"
    }
  ]
}
```

3. Click **Save changes**

### 1d. Create the folder structure

Images live directly in S3 — there is no `app-assets/` folder in this repository.

1. Click on the bucket → **Objects** tab → **Create folder** → name it `app-assets` → **Create folder**
2. Open `app-assets/` → **Create folder** → name it `child_activity_game` → **Create folder**
3. Open `child_activity_game/` and create one subfolder for each growth area:
   - `life_ambition`
   - `self_care`
   - `critical_thinking`
   - `creativity`
   - `physical_wellness`
   - `social_skills`
4. Back in `app-assets/`, create a second top-level folder named `avatars` — this holds the onboarding stage splash images.

## Step 2 — Upload images

Each activity-game image must be uploaded in two themed variants — a dark version (`_vg_dark.png`) and a light version (`_vg_light.png`). The component rewrites the base name at runtime: `astronaut.jpg` → `astronaut_vg_dark.png` or `astronaut_vg_light.png`.

Open each subfolder in the S3 console, click **Upload** → **Add files**, and upload both variants for each image:

| Folder | Base names (upload `<name>_vg_dark.png` + `<name>_vg_light.png` for each) |
|---|---|
| `life_ambition/` | `astronaut`, `sports_person`, `like_my_parents`, `super_hero`, `dancer`, `scientist` |
| `self_care/` | `reading`, `listening_to_music`, `being_in_nature`, `drawing_painting`, `resting_sleeping`, `exercise` |
| `critical_thinking/` | `solving_puzzles`, `science_experiments`, `debates_arguments`, `strategy_games`, `solving_mysteries`, `inventing_things` |
| `creativity/` | `drawing_art`, `storytelling`, `making_music`, `building_making`, `acting_drama`, `cooking_baking` |
| `physical_wellness/` | `football_soccer`, `swimming`, `cycling`, `dancing`, `yoga_stretching`, `running` |
| `social_skills/` | `helping_others`, `leading_a_group`, `listening_to_friends`, `working_in_a_team`, `making_new_friends`, `enjoying_my_own_time` |
| `avatars/` (video stages — .mp4 only) | `stage-01-dark.mp4`, `stage-01-light.mp4`, `stage-02-dark.mp4`, `stage-02-light.mp4`, `stage-04-dark.mp4`, `stage-04-light.mp4`, `stage-07-dark.mp4`, `stage-07-light.mp4` |
| `avatars/` (image stages — .png only) | `stage-03-dark.png`, `stage-03-light.png`, `stage-05-dark.png`, `stage-05-light.png`, `stage-06-dark.png`, `stage-06-light.png`, `stage-08-dark.png`, `stage-08-light.png`, `stage-09-dark.png`, `stage-09-light.png`, `stage-10-dark.png`, `stage-10-light.png` |

## Step 3 — Local dev setup

**Vite dev server (`npm run dev`):**

1. Ensure `frontend/.env` has `ASSETS_BUCKET_NAME` set to your local bucket name:
   ```env
   ASSETS_BUCKET_NAME=<your-local-bucket-name>
   ```
2. Run:
   ```bash
   cd frontend && npm run dev
   ```

**Docker Compose:**

Ensure `ASSETS_BUCKET_NAME` is set to your local bucket name in the root `.env`, then:
```bash
docker compose up --build
```

nginx proxies `/app-assets/*` requests directly to S3.

If `ASSETS_BUCKET_NAME` is not set, image requests fall back to the emoji/gradient tile automatically — no error is thrown.

---

## Uploads bucket (user-generated content)

Child profile photos uploaded during onboarding are stored in a **separate uploads bucket**. Like the assets bucket, the local version is a dedicated manually-managed bucket that is never touched by Terraform.

### Upload and display flow

**Upload (all environments):** The backend generates a presigned S3 PUT URL and the final `avatar_url` (`POST /children/{id}/avatar/presign`). The browser PUTs the file directly to S3 using the presigned URL. The frontend then PATCHes the child record with the returned `avatar_url`. `PutObject` never requires public bucket access.

**Display (local dev):** The local bucket has a public `GetObject` policy on `uploads/*`. Photos are served via a direct S3 URL (`https://{bucket}.s3.{region}.amazonaws.com/uploads/...`). All four Block Public Access settings for the two "public bucket policy" categories are unset.

**Display (deployed — dev/stg/prod):** The bucket has **all four Block Public Access settings ON** — no public access whatsoever. Photos are served through CloudFront via a `/uploads/*` behaviour backed by an OAC-signed origin. The `avatar_url` stored in MongoDB is a CloudFront URL (`https://{app-fqdn}/uploads/...`). Terraform in `infra-live-edge` manages the OAC, the `/uploads/*` behaviour, and the bucket policy granting CloudFront SigV4 read access.

### Local dev environment variables

Set the following in your root `.env` and `backend/.env`:

```env
UPLOADS_BUCKET_NAME=person-local-uploads-bucket-ap-south-1
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
# Leave UPLOADS_CDN_DOMAIN blank — falls back to direct S3 URL for local bucket
UPLOADS_CDN_DOMAIN=
```

In ECS (dev/stg/prod) `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are left unset — the ECS task role provides credentials automatically via IMDS. `UPLOADS_CDN_DOMAIN` is set automatically by Terraform to the app's CloudFront FQDN (same as `COOKIE_DOMAIN`).

### Create and configure the local uploads bucket (one-time)

#### a. Create the bucket

1. Open the [S3 console](https://s3.console.aws.amazon.com/s3/) and click **Create bucket**
2. Set **Bucket name** to `person-local-uploads-bucket-ap-south-1`
3. Set **AWS Region** to `ap-south-1` (Asia Pacific — Mumbai)
4. Leave all other settings at their defaults and click **Create bucket**

#### b. Relax Block Public Access and add a bucket policy (GetObject only — local only)

The local bucket needs public `GetObject` so browsers can load photos via direct S3 URLs. **This step is for the local bucket only** — deployed buckets keep all Block Public Access settings ON and use CloudFront OAC instead (managed by Terraform).

1. Click the bucket → **Permissions** tab → **Block public access (bucket settings)** → **Edit**
2. Uncheck only these two settings:
   - **Block public access to buckets and objects granted through new public bucket or access point policies**
   - **Block public and cross-account access to buckets and objects through any public bucket or access point policies**
3. Leave the top two checkboxes checked (block ACL-based public access — not used here)
4. Click **Save changes** → type `confirm` → **Confirm**
5. Scroll to **Bucket policy** → **Edit** and paste the following (replace `<your-bucket-name>` with your actual bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicGetUploads",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<your-bucket-name>/uploads/*"
    }
  ]
}
```

6. Click **Save changes**

#### c. Configure CORS

The browser uploads directly to S3 via presigned URL. Without CORS, the browser blocks the cross-origin PUT request.

1. Still on the **Permissions** tab, scroll to **Cross-origin resource sharing (CORS)** → **Edit**
2. Paste the following:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["http://localhost:5173"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. Click **Save changes**

> **Production:** For deployed environments (dev/stg/prod), CORS is managed automatically by Terraform (`infra-live-backend/terraform/s3.tf`) — `AllowedOrigins` is set to the CloudFront app domain. The nginx CSP (`connect-src` and `img-src`) already allows all S3 regions via `https://*.s3.amazonaws.com` and `https://*.s3.*.amazonaws.com` — set in `frontend/nginx.conf` and `frontend/nginx.conf.template`.

#### d. Create the uploads folder

1. Click the bucket → **Objects** tab → **Create folder** → name it `uploads` → **Create folder**

Objects are stored as `uploads/<child_id>/<uuid>.<ext>` — the `child_id` subdirectory is created automatically by S3 on first upload; no manual folder creation is needed inside `uploads/`.

### Deployed bucket setup (one-time, per environment)

For deployed environments (dev/stg/prod), the uploads bucket is also created manually but all access control is managed by Terraform — **do not** relax Block Public Access or add a bucket policy manually. After creating the bucket:

1. Create the bucket in `ap-south-1` with all Block Public Access settings **ON** (the default)
2. Add the bucket name as the `UPLOADS_BUCKET_NAME_AP_SOUTH_1` GitHub environment secret (already used by `terraform-live-backend.yml` and `terraform-live-edge.yml`)
3. Apply `infra-live-backend` — sets up CORS (for presigned PUT), lifecycle, and IAM (for presigned URL generation)
4. Apply `infra-live-edge` — creates the CloudFront OAC, `/uploads/*` behaviour, and bucket policy granting CloudFront SigV4 read access
