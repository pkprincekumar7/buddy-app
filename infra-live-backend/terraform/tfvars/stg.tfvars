# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

# subdomain_internal, domain_name, hosted_zone_id, acm_certificate_arn_ap_south_1
#   are supplied via GitHub Environment Secrets (TF_VAR_*)
# backend_bucket_name is read from SSM (written by infra-live-bucket)

app_name        = "buddy360"
mongodb_db_name = "buddy360"

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
app_env                     = "stg"
openai_model                = "gpt-5.4-mini"
anthropic_model             = "claude-sonnet-4-6"
gemini_model                = "gemini-1.5-flash"
llm_timeout_seconds         = 60
llm_hourly_limit            = 100
default_region              = "us"

# ECS Exec
enable_execute_command = true
