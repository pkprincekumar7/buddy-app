"""AI generation for discover, grow, transform and release: `common[generation]` (docs/auth-users-split.md, 8).

- `jobs`: the job queue in the service's own `jobs` (atomic start, region-scoped claim,
  backoff, completion, cancellation on deletion);
- `llm`: the provider client and timeouts;
- `llm_limit`: the hourly LLM limit per user, shared by every circle;
- `prompts`: prompt building with parent data kept as data.

The `PendingJobCount` leader lock is `common.metrics.RegionLeader` (15.5).
"""
