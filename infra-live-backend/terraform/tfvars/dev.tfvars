# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, mongodb_db_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
# One /16 per region — see vpc_cidrs in variables.tf (NET-01). Subnets are
# derived in vpc.tf.
vpc_cidrs = {
  "ap-south-1" = "10.2.0.0/16"
  "eu-west-1"  = "10.3.0.0/16"
  "us-east-1"  = "10.4.0.0/16"
}
nat_gateway_count = 1

# ElastiCache
elasticache_node_type     = "cache.t3.micro"
elasticache_replica_count = 0
elasticache_multi_az      = false

# ECS — every service runs at Fargate's smallest size (0.25 vCPU / 512 MiB):
# a few testers, one process per task, and no ADOT sidecar here
# (enable_adot_sidecar = false below — the ecs-service module refuses a
# sidecar on tasks this small). Each process is ~65–85 MB after import.
task_cpu      = 256
task_memory   = 512
desired_count = 1

# Application
llm_timeout_seconds = 60
llm_hourly_limit    = 50

# ECS Exec
enable_execute_command = true

# Worker ECS
worker_task_cpu              = 256
worker_task_memory           = 512
worker_desired_count         = 1
worker_concurrency           = 2
worker_poll_interval_seconds = 5

# Auth ECS (login/register are bcrypt-bound — scales on CPU)
auth_task_cpu      = 256
auth_task_memory   = 512
auth_desired_count = 1

# Admin ECS (/api/v1/admin/* — low traffic)
admin_task_cpu      = 256
admin_task_memory   = 512
admin_desired_count = 1

# Autoscaling
api_min_capacity    = 1
api_max_capacity    = 3
worker_min_capacity = 1
worker_max_capacity = 2
auth_min_capacity   = 1
auth_max_capacity   = 2
admin_min_capacity  = 1
admin_max_capacity  = 2

# Observability — dev: minimal retention, no alarms, no dashboard, no email alerts
log_retention_days         = 7
enable_basic_alarms        = false
enable_all_alarms          = false
enable_dashboard           = false
enable_xray_error_rule     = false
xray_default_sampling_rate = 0.05
enable_ops_email           = false

# Security — skip GuardDuty and CloudTrail on dev to avoid ~$22/mo cost
enable_guardduty  = false
enable_cloudtrail = false

# ALB access logs — off on dev to avoid S3 storage/PUT cost; independent of
# enable_cloudtrail above (see enable_alb_access_logs's own description)
enable_alb_access_logs = false

# ADOT sidecar — optional on dev to save cost
enable_adot_sidecar = false
