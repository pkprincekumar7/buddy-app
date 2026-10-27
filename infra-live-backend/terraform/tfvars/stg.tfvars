# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
# One /16 per region — see vpc_cidrs in variables.tf (NET-01). Subnets are
# derived in vpc.tf.
vpc_cidrs = {
  "ap-south-1" = "10.12.0.0/16"
  "eu-west-1"  = "10.13.0.0/16"
  "us-east-1"  = "10.14.0.0/16"
}
nat_gateway_count = 2

# ElastiCache (Valkey) — holds only rate-limit counters and a lock, a few MB
# to a few GB even at high traffic. The app falls back to per-task in-memory
# limits if it's unavailable, so it isn't on the critical path.
elasticache_node_type     = "cache.t4g.small"
elasticache_replica_count = 0
elasticache_multi_az      = false

# ECS — one uvicorn process per task, so scale out with more tasks, not bigger
# ones (TF-03). Auth is bcrypt-bound and keeps two (docs/auth-users-split.md, 15.3).
runtime_sizes = {
  "http"              = { cpu = 512, memory = 1024, desired_count = 1, min_capacity = 1, max_capacity = 5 }
  "auth"              = { cpu = 512, memory = 1024, desired_count = 2, min_capacity = 2, max_capacity = 4 }
  "worker"            = { cpu = 512, memory = 1024, desired_count = 1, min_capacity = 1, max_capacity = 3 }
  "generating-worker" = { cpu = 512, memory = 1024, desired_count = 1, min_capacity = 1, max_capacity = 5 }
  "collector"         = { cpu = 256, memory = 512, desired_count = 2, min_capacity = 2, max_capacity = 2 }
}

# Application
llm_timeout_seconds = 60
llm_hourly_limit    = 100

# ECS Exec — intentionally enabled in staging for live container debugging.
# Staging does not use production data, so shell access to running tasks is
# an acceptable trade-off. Disabled in prod via prod.tfvars.
enable_execute_command = true

# Observability — stg: 30-day retention, ALB alarms only, no dashboard, no email alerts
log_retention_days         = 30
enable_basic_alarms        = true
enable_all_alarms          = false
enable_dashboard           = false
xray_default_sampling_rate = 0.05
enable_ops_email           = false

# Security — GuardDuty and CloudTrail enabled on stg
# regional_logging_bucket_name is set via TF_VAR_regional_logging_bucket_name
# GitHub secret (REGIONAL_LOGGING_BUCKET_NAME_AP_SOUTH_1) — do not set here
enable_guardduty  = true
enable_cloudtrail = true

# ALB access logs enabled on stg — independent of enable_cloudtrail above
# (see enable_alb_access_logs's own description); shares the same bucket
enable_alb_access_logs = true

# Container Insights — off. Only a few testers use this environment, and
# autoscaling, alarms and the dashboard use the free AWS/ECS metrics, so it
# would only add ~$34/month of task-level metrics nobody reads.
enable_container_insights = false
