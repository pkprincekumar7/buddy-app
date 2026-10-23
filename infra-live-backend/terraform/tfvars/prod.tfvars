# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, mongodb_db_name, domain_name, hosted_zone_id, acm_certificate_arn,
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

# ElastiCache
elasticache_node_type     = "cache.r6g.4xlarge"
elasticache_replica_count = 2
elasticache_multi_az      = true

# ECS — API. One uvicorn process per task (backend/Dockerfile), so ~1 vCPU is
# all it can use: scale out with more tasks, not bigger ones (TF-03).
task_cpu      = 1024
task_memory   = 2048
desired_count = 15 # = api_min_capacity; only used on the first apply

# Application
llm_timeout_seconds = 90
llm_hourly_limit    = 200

# ECS Exec
enable_execute_command = false

# Worker ECS
# One asyncio process, I/O-bound on LLM calls — same sizing reasoning as the API.
worker_task_cpu              = 1024
worker_task_memory           = 2048
worker_desired_count         = 5 # = worker_min_capacity
worker_concurrency           = 5
worker_poll_interval_seconds = 2

# Auth ECS (login/register are bcrypt-bound — scales on CPU)
auth_task_cpu      = 2048
auth_task_memory   = 4096
auth_desired_count = 3 # = auth_min_capacity

# Admin ECS (/api/v1/admin/* — low traffic)
admin_task_cpu      = 512
admin_task_memory   = 1024
admin_desired_count = 1

# Autoscaling
api_min_capacity    = 15
api_max_capacity    = 200
worker_min_capacity = 5
worker_max_capacity = 50
auth_min_capacity   = 3
auth_max_capacity   = 30
admin_min_capacity  = 1
admin_max_capacity  = 3

# Observability — prod: 90-day retention, all alarms, dashboard enabled, email alerts on
log_retention_days         = 90
enable_basic_alarms        = true
enable_all_alarms          = true
enable_dashboard           = true
enable_xray_error_rule     = true
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

# ADOT sidecar — off. The backend has no OpenTelemetry/X-Ray instrumentation,
# so a collector would receive nothing, and Container Insights (cluster
# setting) already provides CPU/memory metrics. The app now gets the whole task
# (the sidecar reserved 256 CPU / 512 MiB of it); task size, and so cost, are
# unchanged. Tracing plan: docs/auth-users-split.md section 15.5.
enable_adot_sidecar = false
