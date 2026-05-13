# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# subdomain_internal, domain_name, hosted_zone_id, acm_certificate_arn
#   are supplied via GitHub Environment Secrets (TF_VAR_*)

app_name            = "buddy360"
backend_bucket_name = "person-backend-stg-app-bucket"
mongodb_db_name     = "buddy360-stg"

# Networking
vpc_cidr              = "10.12.0.0/16"
public_subnet_1_cidr  = "10.12.1.0/24"
public_subnet_2_cidr  = "10.12.2.0/24"
private_subnet_1_cidr = "10.12.3.0/24"
private_subnet_2_cidr = "10.12.4.0/24"

# ElastiCache
elasticache_node_type = "cache.t3.small"

# ECS
task_cpu      = 512
task_memory   = 1024
desired_count = 1

# Application
app_env             = "stg"
openai_model        = "gpt-5.4-mini" # valid, tested model identifier
anthropic_model     = "claude-sonnet-4-6"
gemini_model        = "gemini-1.5-pro"
llm_timeout_seconds = 60
llm_hourly_limit    = 100
default_region      = "us"

# ECS Exec — intentionally enabled in staging for live container debugging.
# Staging does not use production data, so shell access to running tasks is
# an acceptable trade-off. Disabled in prod via prod.tfvars.
enable_execute_command = true
