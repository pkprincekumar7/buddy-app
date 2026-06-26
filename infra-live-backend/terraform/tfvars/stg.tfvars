# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, mongodb_db_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
vpc_cidr              = "10.12.0.0/16"
public_subnet_1_cidr  = "10.12.1.0/24"
public_subnet_2_cidr  = "10.12.2.0/24"
private_subnet_1_cidr = "10.12.3.0/24"
private_subnet_2_cidr = "10.12.4.0/24"
public_subnet_3_cidr  = "10.12.5.0/24"
private_subnet_3_cidr = "10.12.6.0/24"
nat_gateway_count     = 2

# ElastiCache
elasticache_node_type     = "cache.t4g.medium"
elasticache_replica_count = 0
elasticache_multi_az      = false

# ECS
task_cpu      = 512
task_memory   = 1024
desired_count = 1

# Application
llm_timeout_seconds = 60
llm_hourly_limit    = 100
default_region      = "us"

# ECS Exec — intentionally enabled in staging for live container debugging.
# Staging does not use production data, so shell access to running tasks is
# an acceptable trade-off. Disabled in prod via prod.tfvars.
enable_execute_command = true

# Worker ECS
worker_task_cpu              = 512
worker_task_memory           = 1024
worker_desired_count         = 1
worker_concurrency           = 3
worker_poll_interval_seconds = 3

# Autoscaling
api_min_capacity    = 2
api_max_capacity    = 10
worker_min_capacity = 1
worker_max_capacity = 5
