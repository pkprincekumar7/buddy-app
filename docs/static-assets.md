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
