# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# app_name, mongodb_db_name, domain_name, hosted_zone_id, acm_certificate_arn,
# assets_bucket_name, subdomain_internal, cookie_domain, cors_origins,
# openai_model, anthropic_model, gemini_model
# are supplied via GitHub Actions (TF_VAR_*) — no defaults set for these in variables.tf.

# Networking
vpc_cidr              = "10.32.0.0/16"
public_subnet_1_cidr  = "10.32.1.0/24"
public_subnet_2_cidr  = "10.32.2.0/24"
private_subnet_1_cidr = "10.32.3.0/24"
private_subnet_2_cidr = "10.32.4.0/24"

# ElastiCache
elasticache_node_type = "cache.t3.small"

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
