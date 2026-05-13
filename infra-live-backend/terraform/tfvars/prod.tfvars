# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# subdomain_internal, domain_name, hosted_zone_id, acm_certificate_arn
#   are supplied via GitHub Environment Secrets (TF_VAR_*)

app_name            = "buddy360"
backend_bucket_name = "person-backend-prod-app-bucket"
mongodb_db_name     = "buddy360-prod"

# Networking
vpc_cidr              = "10.22.0.0/16"
public_subnet_1_cidr  = "10.22.1.0/24"
public_subnet_2_cidr  = "10.22.2.0/24"
private_subnet_1_cidr = "10.22.3.0/24"
private_subnet_2_cidr = "10.22.4.0/24"

# ElastiCache
elasticache_node_type = "cache.t3.medium"

# ECS
task_cpu      = 1024
task_memory   = 2048
desired_count = 2

# Application
app_env             = "prod"
openai_model        = "gpt-5.4-mini" # valid, tested model identifier
anthropic_model     = "claude-sonnet-4-6"
gemini_model        = "gemini-1.5-pro"
llm_timeout_seconds = 90
llm_hourly_limit    = 200
default_region      = "us"

# ECS Exec
enable_execute_command = false
