# AWS for the local manual mode

What the local stack's manual mode (`docker compose up -d`, docs/getting-started.md, "Manual
and test modes") needs in AWS: the personal buckets below and an IAM user whose access key
the services sign with (profile `superpower-local` in `~/.aws`).

| Bucket | Region | Used by the local stack |
|---|---|---|
| `person-local-uploads-bucket-ap-south-1` | ap-south-1 | Yes: `UPLOADS_BUCKET_NAME` (the stack runs as `AWS_REGION=ap-south-1`) |
| `person-local-uploads-bucket-eu-west-1` | eu-west-1 | Not today; covered so a region can be tried without a new policy |
| `person-local-uploads-bucket-us-east-1` | us-east-1 | Not today; as above |
| `person-local-assets-bucket` | us-east-1 | `ASSETS_BUCKET_NAME`: the APK link (`shared`) and the web app's `/app-assets/` proxy |

The test mode uses Moto buckets with the same names (`.env.test`), so the e2e runs never touch
these.

| File | What it is |
|---|---|
| `iam-policy.json` | The IAM user's only permissions: read, write and delete under each uploads bucket's `uploads/`, and read the assets bucket's Android prefix (the APK link) |
| `uploads-bucket-policy-<region>.json` | Each uploads bucket's policy: plain HTTP refused, as Terraform does for the environments' buckets (TF-05). A bucket policy may only name its own bucket, so one file each |
| `uploads-bucket-cors.json` | For each uploads bucket: lets the web app on `localhost:5173` post photos to it and show them |
| `uploads-bucket-lifecycle.json` | For each uploads bucket: aborts unfinished multipart uploads after 7 days |
| `assets-bucket-policy.json` | The assets bucket's policy: anyone may read `app-assets/*`, plain HTTP refused |

**The assets bucket is public for `app-assets/*` on purpose.** The web app's `/app-assets/`
proxy (the frontend container's nginx, and Vite's dev server, which the phone app's
`CDN_BASE_URL` points at by default) reads it unsigned, and it holds only the app's own images and videos, nothing about a user. The APK
link reads it with the IAM user's key. The photos' buckets, by contrast, are private.

These are personal buckets, not an environment's: Terraform owns those, and its next apply
would replace this CORS and policy. Nothing here is a secret; the access key goes in
`~/.aws/credentials` only.

## Setting it up (once, in your own AWS account)

Not a work account: this is a personal key for a local stack.

1. **Each uploads bucket** (S3 → the bucket → Permissions). The buckets already exist; if one
   doesn't, create it in its region with Block Public Access on, ACLs disabled and SSE-S3.
   - **Bucket policy:** check what's there first. If something else needs it, add the
     `DenyInsecureTransport` statement to it rather than replacing it; otherwise paste the
     bucket's own `uploads-bucket-policy-<region>.json`.
   - **Cross-origin resource sharing (CORS):** paste the `CORSRules` array of
     `uploads-bucket-cors.json` (the console takes the array itself, from `[`).
   - **Management → Create lifecycle rule:** `abort-incomplete-multipart`, all objects,
     *Delete incomplete multipart uploads* after 7 days (`uploads-bucket-lifecycle.json`).
2. **The assets bucket** (`person-local-assets-bucket`, us-east-1):
   - **Bucket policy:** replace it with `assets-bucket-policy.json` (the public read of
     `app-assets/*` it already has, plus `DenyInsecureTransport`).
   - **Block public access:** leave *Block public access to buckets and objects granted
     through new public bucket policies* and *… through any public bucket or access point
     policies* **off**, and the two ACL settings on. With the policy ones on, S3 would block
     the public read the proxies need.
   - **Objects:** delete the macOS `.DS_Store` files (anyone can read them; they list folder
     contents) and the empty `app-assets/` folder placeholder. Don't upload `.DS_Store` again:
     `aws s3 sync --exclude '.DS_Store' --exclude '*/.DS_Store'`.
   - No CORS or lifecycle rule: the browser reads it through the same-origin proxy.
3. **IAM → Policies → Create policy → JSON:** paste `iam-policy.json`, name it
   `superpower-local-manual-s3`.
4. **IAM → Users → Create user** `superpower-local-manual`, without console access; attach
   `superpower-local-manual-s3` directly. Then the user → **Security credentials → Create
   access key**, use case *Local code*; copy both values (the secret is shown once).
5. **On this machine:** the key in `~/.aws/credentials` (mode 600), region in `~/.aws/config`,
   both under `superpower-local`:

   ```ini
   # ~/.aws/credentials
   [superpower-local]
   aws_access_key_id = <access key id>
   aws_secret_access_key = <secret access key>
   ```

   ```ini
   # ~/.aws/config
   [profile superpower-local]
   region = ap-south-1
   output = json
   ```

   Keep the key in `credentials` only: where both files have one for a profile,
   `credentials` wins, so a second copy in `config` is ignored (and `config` is usually
   readable by anyone on the machine).
6. **Check the key:**

   ```bash
   aws s3 ls s3://person-local-uploads-bucket-ap-south-1/uploads/ --profile superpower-local
   ```

   An empty result, not *AccessDenied*, means the key and the policy work.
7. **Then the manual mode:** `.env`'s `UPLOADS_BUCKET_NAME`, `ASSETS_BUCKET_NAME`,
   `LOCAL_AWS_PROFILE=superpower-local` and `LOCAL_AWS_DIR` (your `~/.aws`), the 8 Atlas URIs,
   Moto running for the events, and `docker compose up -d`.

Rotate the key now and then (create the new one, update `credentials`, delete the old one).

## Not needed

`person-backend-local-app-bucket` (us-east-1), if you have it: nothing in the repo reads it.
It's an older copy of the assets bucket (every one of its 116 objects is in
`person-local-assets-bucket`, last changed in June), and anyone can read its `app-assets/*`.
Empty it (S3 → the bucket → **Empty**), then **Delete** it.
