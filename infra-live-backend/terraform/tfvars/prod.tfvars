# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
# One /16 per region — see vpc_cidrs in variables.tf (NET-01). Subnets are
# derived in vpc.tf.
vpc_cidrs = {
  "ap-south-1" = "10.22.0.0/16"
  "eu-west-1"  = "10.23.0.0/16"
  "us-east-1"  = "10.24.0.0/16"
}
nat_gateway_count = 3

# ElastiCache (Valkey) — holds only rate-limit counters and a lock, a few MB
# to a few GB even at high traffic. The app falls back to per-task in-memory
# limits if it's unavailable, so it isn't on the critical path.
# Primary + 1 replica across AZs for automatic failover. Move to
# cache.r7g.large when sustained load needs dedicated (non-burstable) CPU.
elasticache_node_type     = "cache.t4g.medium"
elasticache_replica_count = 1
elasticache_multi_az      = true

# ECS — lean workers (docs/auth-users-split.md, 15.3): HTTP services keep two
# tasks for availability, workers one each (SQS holds messages while a task is
# replaced). desired_count is only used on the first apply; autoscaling owns it after.
runtime_sizes = {
  "http"              = { cpu = 1024, memory = 2048, desired_count = 2, min_capacity = 2, max_capacity = 25 }
  "auth"              = { cpu = 2048, memory = 4096, desired_count = 3, min_capacity = 3, max_capacity = 30 }
  "worker"            = { cpu = 512, memory = 1024, desired_count = 1, min_capacity = 1, max_capacity = 5 }
  "generating-worker" = { cpu = 1024, memory = 2048, desired_count = 1, min_capacity = 1, max_capacity = 10 }
  "collector"         = { cpu = 512, memory = 1024, desired_count = 2, min_capacity = 2, max_capacity = 4 }
}

# Application
llm_timeout_seconds = 90
llm_hourly_limit    = 200

# ECS Exec
enable_execute_command = false

# Observability — prod: 90-day retention, all alarms, dashboard enabled, email alerts on
log_retention_days         = 90
enable_basic_alarms        = true
enable_all_alarms          = true
enable_dashboard           = true
xray_default_sampling_rate = 0.01
enable_ops_email           = true

# Security — GuardDuty and CloudTrail always enabled on prod
# regional_logging_bucket_name is set via TF_VAR_regional_logging_bucket_name
# GitHub secret (REGIONAL_LOGGING_BUCKET_NAME_AP_SOUTH_1) — do not set here
enable_guardduty  = true
enable_cloudtrail = true

# ALB access logs always enabled on prod — independent of enable_cloudtrail
# above (see enable_alb_access_logs's own description); shares the same bucket
enable_alb_access_logs = true

# Container Insights — on in prod only: task-level metrics, task counts and
# performance log events for investigating incidents (~$34/month per cluster).
enable_container_insights = true
