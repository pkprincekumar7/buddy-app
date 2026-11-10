# Data residency — where personal data is stored and processed

The residency matrix for production-readiness review item PRIV-03: each kind of personal data,
where it's stored, who else processes it, and in which region. It describes the code and
configuration **as they are today**, then what changes later. Legal steps (contracts, transfer
basis, privacy policy) are listed at the end; they're the owner's to complete, not code.

## Today's setup, in one paragraph

stg and prod are **served from ap-south-1 (Mumbai) only** (`shared/routing.json` `served_from`,
DEC-01): every user, whatever their country, is handled there, and each environment has **one
Atlas M10 cluster in ap-south-1**, reached privately (PrivateLink, DEC-02). So every user's data
is stored in India. Each account still records its own `location` (`in`, `apac`, `me`, `eu`,
`us`, `br`), so the data can move to per-location storage later without a rewrite. dev and sbx
run in three regions, each against its own Atlas M0 cluster in ap-south-1, with test data only.

## The matrix (stg and prod)

| Data | Where it's stored | Region | Also processed by | Notes |
|---|---|---|---|---|
| Parent account: email, password hash (bcrypt), role, country, `location`, sessions | Atlas M10, `auth` database | ap-south-1 | — | The email is stored in `auth` only; other services hold an HMAC of it (`email_index`) |
| Parent profile: first, middle and last name, address lines, preferences | Atlas M10, `users` database | ap-south-1 | — | Exported and deleted with the account; never logged |
| Child profile: name, age, gender, school, emoji avatar, progress | Atlas M10, `children` database | ap-south-1 | — | |
| Child photos (avatar, 90-day plan photos) | S3 uploads bucket | ap-south-1 | — | Read through short-lived presigned URLs only; HTTPS-only bucket policy (TF-05) |
| Onboarding answers (the seven questions about the child) | Atlas M10, `onboarding`, plus local copies in the circles that use them | ap-south-1 | LLM provider (below) | |
| Personality, growth areas, plans, observations | Atlas M10, `discover`, `grow`, `transform`, `release` | ap-south-1 | LLM provider (below) | Generated text about the child |
| **Generation prompts** | Not stored by the app | — | **OpenAI, Anthropic or Google (Gemini)**, global endpoints | Built on the server from the rows above: the child's **first name, age, pronouns**, onboarding answers, personality summary and growth-area answers. No email, address or parent name |
| **Voice recordings** (speech-to-text) | Not stored by the app | — | **OpenAI** (`whisper-1`), global endpoint | Sent as `recording.<ext>`, the parent's filename dropped; up to 10 MB |
| Google Sign-In | — | — | Google | Only when a parent signs in with Google: Google verifies the ID token |
| Events between services (SNS/SQS) | AWS SNS/SQS, encrypted | ap-south-1 | — | Ids and the fields other services copy; kept until consumed (days at most) |
| Cache and rate limits | Valkey (ElastiCache) | ap-south-1 | — | Authorization cache by user id; rate-limit counters by user id or client IP (IPv6 by /64) |
| Application logs | CloudWatch Logs | ap-south-1 | — | User ids appear hashed (`user_hash`); no names, emails or answers (PRIV-01). 30 days in stg, 90 in prod |
| Traces | AWS X-Ray, through the OpenTelemetry collector | ap-south-1 | — | Errors, slow requests and a sample; no request bodies |
| ALB access logs | S3 regional logging bucket | ap-south-1 | — | Client IP, path, user agent |
| WAF logs (prod) | S3 global logging bucket | us-east-1 | — | Blocked or counted requests only; `Authorization` and `Cookie` redacted; deleted after 90 days (SEC-02) |
| Edge request handling | CloudFront and Lambda@Edge | Edge locations worldwide | — | Requests pass through the nearest edge; the validator logs no personal data |
| Database backups | Atlas Cloud Backup | ap-south-1, plus the snapshot-copy region | — | The copy region is a choice: **ap-south-2 (Hyderabad)** keeps backups in India; another country's region moves them abroad (`docs/infra-operations.md`, "Atlas clusters") |

dev and sbx: the same services and stores, test data only, in the region that serves each
location (ap-south-1, eu-west-1 or us-east-1), with each environment's database on its own Atlas M0 in ap-south-1.

## What leaves India today

1. **Generation prompts and voice recordings** go to the AI providers' global endpoints (mostly
   US-based), for every user. This doesn't depend on where the database is.
2. **WAF logs** (blocked requests, redacted) are stored in us-east-1.
3. **Backup copies**, if their copy region is outside India.
4. Requests briefly pass through CloudFront's edge locations wherever the user is.

Everything else stays in ap-south-1.

## Later: per-location storage

When users outside India are served from their own regions (DB-01 Stage 2: an Atlas Global
Cluster sharded by `location`, or separate clusters per region with the shared auth collections
redesigned), remove stg and prod from `served_from` and apply their other regions. Each user's
rows then live in their location's region, because every row already carries `location`. Prompts
and recordings still go to the providers unless each location gets a provider with in-region
processing (for example Azure OpenAI or Amazon Bedrock in that region), chosen per location.

## For the owner: legal and contract steps (not code)

- [ ] **Processing agreements** with OpenAI, Anthropic and Google, with zero data retention where they offer it, since children's data reaches them.
- [ ] **The law that applies to your users.** For users in India, the Digital Personal Data Protection Act 2023: verifiable parental consent for anyone under 18, no tracking or targeted advertising of children, and transfers abroad allowed except to countries the government restricts. For EU users stored in India, GDPR needs a transfer basis (typically Standard Contractual Clauses plus a transfer risk assessment) and parental consent for children (Article 8). For US children under 13, COPPA.
- [ ] **Privacy policy** saying where data is stored (India), which processors receive it (the AI providers, Google Sign-In, AWS, MongoDB Atlas) and why.
- [ ] Have someone qualified review this matrix and the above before launch.

Related: [production-readiness-review.md](production-readiness-review.md) (PRIV-01, PRIV-02, PRIV-03, DB-01, DEC-01, DEC-02), [infra-architecture-multi-region.md](infra-architecture-multi-region.md).
