# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, mongodb_db_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
vpc_cidr              = "10.2.0.0/16"
public_subnet_1_cidr  = "10.2.1.0/24"
public_subnet_2_cidr  = "10.2.2.0/24"
private_subnet_1_cidr = "10.2.3.0/24"
private_subnet_2_cidr = "10.2.4.0/24"
public_subnet_3_cidr  = "10.2.5.0/24"
private_subnet_3_cidr = "10.2.6.0/24"
nat_gateway_count     = 1

# ElastiCache
elasticache_node_type     = "cache.t4g.micro"
elasticache_replica_count = 0
elasticache_multi_az      = false

# ECS
task_cpu      = 512
task_memory   = 1024
desired_count = 1

# Application
llm_timeout_seconds = 60
llm_hourly_limit    = 50
default_region      = "us"

# ECS Exec
enable_execute_command = true

# Worker ECS
worker_task_cpu              = 512
worker_task_memory           = 1024
worker_desired_count         = 1
worker_concurrency           = 2
worker_poll_interval_seconds = 5

# Autoscaling
api_min_capacity    = 1
api_max_capacity    = 3
worker_min_capacity = 1
worker_max_capacity = 2

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

# ADOT sidecar — optional on dev to save cost
enable_adot_sidecar = false
