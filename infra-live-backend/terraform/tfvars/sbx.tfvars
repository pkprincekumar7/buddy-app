# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
# One /16 per region — see vpc_cidrs in variables.tf (NET-01). Subnets are
# derived in vpc.tf.
vpc_cidrs = {
  "ap-south-1" = "10.32.0.0/16"
  "eu-west-1"  = "10.33.0.0/16"
  "us-east-1"  = "10.34.0.0/16"
}
nat_gateway_count = 1

# ElastiCache (Valkey) — holds only rate-limit counters and a lock, a few MB
# to a few GB even at high traffic. The app falls back to per-task in-memory
# limits if it's unavailable, so it isn't on the critical path.
elasticache_node_type     = "cache.t4g.micro"
elasticache_replica_count = 0
elasticache_multi_az      = false

# ECS — every runtime (9 services, 8 workers, the collector) at Fargate's
# smallest size (0.25 vCPU / 512 MiB) × 1: a few testers, one process per task
# (docs/auth-users-split.md, 15.3).
runtime_sizes = {
  "http"              = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
  "auth"              = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
  "worker"            = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
  "generating-worker" = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
  "collector"         = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 1 }
}

# Application
llm_timeout_seconds = 60
llm_hourly_limit    = 50

# ECS Exec
enable_execute_command = true

# Observability — sbx: same as dev (minimal retention, no alarms, no dashboard, no email alerts)
log_retention_days         = 7
enable_basic_alarms        = false
enable_all_alarms          = false
enable_dashboard           = false
xray_default_sampling_rate = 0.05
enable_ops_email           = false

# Security — skip GuardDuty and CloudTrail on sbx to avoid ~$22/mo cost
enable_guardduty  = false
enable_cloudtrail = false

# ALB access logs — off on sbx to avoid S3 storage/PUT cost; independent of
# enable_cloudtrail above (see enable_alb_access_logs's own description)
enable_alb_access_logs = false

# Container Insights — off. Only a few testers use this environment, and
# autoscaling, alarms and the dashboard use the free AWS/ECS metrics, so it
# would only add ~$34/month of task-level metrics nobody reads.
enable_container_insights = false
