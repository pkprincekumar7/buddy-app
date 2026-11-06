# stg — first apply, deploy and the checks that need it

The first time stg is built, step by step, then the production-readiness items that can only
be closed against a running environment. stg lives in its **own AWS account** (one account per
environment, [environments.md](environments.md) section 1). Tick each box as it's done; each
verification names the review item it closes ([production-readiness-review.md](production-readiness-review.md)).

Set these once for the commands below:

```bash
APP=superpower ENV=stg REGION=ap-south-1
HOST=https://<SUBDOMAIN>-stg.<DOMAIN_NAME>
```

---

## 1. Before anything runs

### AWS account (stg's own)
- [ ] GitHub OIDC provider and the deploy role, trust limited to `repo:<owner>/buddy-app:environment:stg` ([environments.md](environments.md) 4). Its ARN is `ROLE_ARN`.
- [ ] Terraform state bucket in `us-east-1`, versioning on (`STATE_BUCKET`).
- [ ] Service Quotas, per region used: Fargate On-Demand vCPU covers stg's peak (76 Mongo tasks + 2 collectors at their `runtime_sizes`, ×1.5 during a deploy); 2 Elastic IPs (NAT) and 1 VPC are free.
- [ ] Route 53 hosted zone for `DOMAIN_NAME` (or a delegated subdomain zone) in this account.
- [ ] ACM certificates: one in `us-east-1` (CloudFront) and one in each backend region, covering the public name and the region's internal name (a wildcard `*.<DOMAIN_NAME>` does), DNS-validated.

### Buckets (created by hand, they outlive the environment)
- [ ] Assets (`us-east-1`), SPA (`us-east-1`), uploads per region, regional logging per region. stg doesn't need the global logging bucket (edge CloudTrail and WAF logging are off in stg).
- [ ] Each with Block Public Access on, default encryption (SSE-S3) and no bucket policy of your own: Terraform writes the policies (HTTPS-only, CloudFront access, log delivery) and the uploads CORS and lifecycle rules.

### MongoDB Atlas
- [ ] stg's cluster (**M10**, `ap-south-1`: a paid tier, about $60 a month, chosen so Atlas's Test Failover can run, DB-05) with cloud backup, storage auto-scaling and termination protection on ([infra-operations.md](infra-operations.md), "Atlas clusters"), in **stg's own Atlas project** (`superpower-stg`), and one database user per service but shared, named `superpower-stg-<service>` with `readWrite` on that service's database only ([ci-cd.md](ci-cd.md), `MONGODB_URIS`).
- [ ] An Atlas API key for Terraform (Project → Access Manager → API Keys), with **Project Owner** on stg's project only; it creates and removes the PrivateLink endpoint (DEC-02). Keep its public and private parts for the GitHub secrets below.
- [ ] Network Access: add **no** IP access list entries. stg's tasks reach the cluster only through the PrivateLink endpoint Terraform makes.
- [ ] Each service's connection string is the cluster's **private-endpoint** one (`mongodb+srv://<cluster>-pl-0.<id>.mongodb.net/…`); Atlas shows it under Connect → Private Endpoint once the endpoint exists. Check it after step 3.

### GitHub Environment `stg`
- [ ] Variables and secrets from [environments.md](environments.md) section 6: `ATLAS_PROJECT_ID` (stg's Atlas project ID), `ROLE_ARN`, `APP_NAME`, `STATE_BUCKET`, `DOMAIN_NAME`, `SUBDOMAIN`, `HOSTED_ZONE_ID`, `ASSETS_BUCKET_NAME`, `SPA_BUCKET_NAME`, `JWT_PUBLIC_KEYS` (and `JWT_KEY_ID` if not `key-v1`), the three `*_MODEL`s, `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`; the three region maps `ACM_CERTIFICATE_ARNS`, `UPLOADS_BUCKET_NAMES`, `REGIONAL_LOGGING_BUCKET_NAMES`; `OPS_EMAIL` (alarms are on in stg).
- [ ] Secrets: `JWT_PRIVATE_KEY`, `ORIGIN_VERIFY_SECRET` (`openssl rand -hex 32`; not `ORIGIN_VERIFY_SECRET_NEXT`), `MONGODB_URIS` (the private-endpoint strings), `EMAIL_HMAC_PEPPER` (back it up), at least one LLM key, and `MONGODB_ATLAS_PUBLIC_KEY` / `MONGODB_ATLAS_PRIVATE_KEY` (the API key above).
- [ ] Only if the nightly schedule will be used: `GIT_ACTIONS_PAT`, a **fine-grained** token for this repository only with **Actions: Read and write** ([environments.md](environments.md) section 6). Note its expiry date.

### Outside AWS
- [ ] Google Cloud OAuth client: add `$HOST` to Authorized JavaScript origins.

---

## 2. Plan

- [ ] Run **terraform-live-all**: `action = plan`, `environment = stg`, `backend_regions = ap-south-1`.
  The backend plans fully. Edge and frontend show **Partial plan** warnings: they can't plan until
  the stack before them is applied (CI-17). Read the backend plan: 18 ECS services, Valkey, ALB, VPC.
  The run also creates the service-token key pairs in SSM (SEC-01); that's expected.

## 3. Apply the backend; check the private endpoint

- [ ] Run **terraform-live-backend**: `action = apply`, `environment = stg`, `aws_regions = ap-south-1`.
  The services start on the `:latest` placeholder and stay unhealthy until the first deploy; that's expected.
- [ ] In Atlas (Network Access → Private Endpoint), stg's AWS endpoint in ap-south-1 shows **Available**. Compare the cluster's private-endpoint connection string (Connect → Private Endpoint) with `MONGODB_URIS`; if a service's differs, update its value with `put-secret-value` ([infra-operations.md](infra-operations.md), "Rotating a value") and restart it.

- [ ] Confirm the `OPS_EMAIL` SNS subscription email.

## 4. Apply edge and frontend, then deploy

- [ ] Run **terraform-live-all**: `action = apply`, `environment = stg`, `backend_regions = ap-south-1`, `deploy = true`.
  It re-applies the backend (no changes), then edge, frontend, deploy-backend and deploy-frontend.
  Confirm the second `OPS_EMAIL` subscription (the edge stack's, `us-east-1`).
- [ ] `curl -s "$HOST/api/health"` answers with `"status": "ok"`, and `$HOST` loads the web app.

## 5. First admin

- [ ] Follow [infra-operations.md](infra-operations.md), "First admin of an environment": allow-list your email, register on `$HOST`, then promote the account with the one-off `auth.promote_admin` task.
- [ ] Sign in, add a child and go through onboarding once. (This makes real LLM calls.)

---

## 6. Checks that close review items

Run these once stg works. Each closes, or narrows, the item named.

### EDGE-03: 404s stay 404s
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' "$HOST/api/v1/does-not-exist"` → `404`, with a JSON body.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' "$HOST/some/spa/route"` → `200` (the app's `index.html`).
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' "$HOST/assets/missing.js"` → `404`.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' "$HOST/uploads/missing.jpg"` → `403` or `404`, never the app.

### EDGE-02: the origin secret rotates without 403s
- [ ] Rotate `ORIGIN_VERIFY_SECRET` once, following [infra-operations.md](infra-operations.md#rotating-the-origin-verify-secret), while a loop runs `curl -s -o /dev/null -w '%{http_code}\n' "$HOST/api/health"` every second. No `403` should appear.

### APP-01: rate limits use the real client address
- [ ] Send 11 bad logins within a minute, each with a different forged `X-Forwarded-For`:

  ```bash
  for i in $(seq 1 11); do
    curl -s -o /dev/null -w '%{http_code} ' -X POST "$HOST/api/v1/auth/login" \
      -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.0.0.$i" \
      -d '{"email":"nobody@example.com","password":"wrong"}'
  done; echo
  ```

  The last answer is `429`: the limit (10 a minute per address) counted your real address,
  which CloudFront forwards as `CloudFront-Viewer-Address`, not the forged header. If every
  answer is `401`, the header isn't reaching the backend and every client shares the ALB's
  address: check the origin request policy (`infra-live-edge/terraform/cloudfront.tf`).

### CI-11: a broken release fails the deploy
- [ ] On a throwaway branch, make one service's `/health` return 500, then run **deploy-live-backend** for `stg` with `service = users`. The run must **fail**, the ECS circuit breaker rolls `users` back, and the service keeps answering. Delete the branch.

### CI-12: mixed images are flagged
- [ ] The same run shows a **Mixed images** warning only if other services in it succeeded; with `service = users` alone it doesn't. Optional: repeat with `service = users,children` to see the warning and the summary table.

### DB-03: indexes build once per release
- [ ] After the first deploy, each service's log shows its indexes built in the background by one task, and the `index-problems` alarm stays OK. (The 10M-document case needs data stg doesn't have; it's covered by the design.)

### DB-05: surviving an Atlas election
- [ ] In Atlas, run **Test Failover** on stg's M10 cluster while a loop calls `$HOST/api/health` and
  a child's profile every second, and a generation job runs. The API may show brief errors, but
  tasks don't restart in a loop (ECS events stay quiet), the job finishes, and no job is lost.

### SCH-01: the scheduler dispatches once and alerts on failure
Only if the schedule will be used:
- [ ] Run **terraform-live-scheduler**: `environment = stg`, `action = apply`, `schedule_enabled = false`, `target_aws_regions = ap-south-1`.
- [ ] Invoke the dispatcher twice in a row from the Lambda console with the start schedule's input: the first starts one **Full Stack** run, the second logs *Already dispatched* and starts nothing.
- [ ] Put a wrong value in the PAT secret, invoke once: the failure alarm emails `OPS_EMAIL`. Put the PAT back.

### TF-03 and TF-04: load
- [ ] Pause LLM generation first, so the test costs nothing ([infra-operations.md](infra-operations.md), "Pausing LLM generation").
- [ ] Load the read paths (`/api/health`, `/api/v1/auth/me`, a child's profile) with a load tool (k6, Locust) up to the point stg scales to its `max_capacity`, and watch:
  - ECS CPU and memory per service, and that scaling settles at or below `max_capacity`;
  - Atlas connections staying under the budget, 1050 (70% of M10's 1500; 836 at peak);
  - ALB 5xx and p95 latency, and the alarms that fire;
  - Valkey `DatabaseMemoryUsagePercentage` and evictions (TF-04's working set).
- [ ] A burst of logins, for auth's bcrypt cost (TF-03 fix 9).
- [ ] Turn generation back on. Write the numbers into the TF-03 and TF-04 entries.

### L12: read-only root filesystem on Fargate
- [ ] In the ECS console, make a new revision of one worker's task definition with *Read-only root file system* on and a `/tmp` bind-mount volume, and run it as a one-off task. If its heartbeat works (the task turns healthy), L12 can be done in Terraform the same way; if `/tmp` isn't writable for `appuser`, it needs another approach.

### DB-01: a restore, once
- [ ] Restore a stg snapshot to a new cluster in Atlas and note how long it took. This is the practice run; prod's is required before go-live ([infra-operations.md](infra-operations.md), "Atlas clusters"). Delete the restored cluster afterwards.

### Promotion, later (CI-03, CI-09)
- [ ] When dev has its own account and a release: in dev's backend tfvars set `ecr_pull_account_ids` to stg's account, apply dev, give stg's deploy role ECR pull on dev's repositories, then run **promote-live-backend** dev → stg. It copies each image by digest; the run fails if the digest changes.

---

## 7. After the checks

- [ ] Update each item's entry in [production-readiness-review.md](production-readiness-review.md) with what was seen.
- [ ] Leave stg running, or destroy it with **terraform-live-all** `action = destroy` (it removes everything Terraform made, the service-token keys included; the buckets and Atlas stay). The next apply re-creates the private endpoint and links it in Atlas by itself (DEC-02).
