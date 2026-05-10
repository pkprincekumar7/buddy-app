# aws_region and environment are supplied via workflow inputs (TF_VAR_*)
# state_bucket and db_state_key are supplied via secrets/workflow (TF_VAR_*)

app_name            = "buddy360"
db_name             = "buddy360"
backend_bucket_name = "person-backend-prod-app-bucket"

# Networking — must not overlap with database VPC (prod: 10.21.x.x)
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
app_env                     = "prod"
openai_model                = "gpt-5.4-mini"
anthropic_model             = "claude-sonnet-4-6"
gemini_model                = "gemini-1.5-pro"
llm_timeout_seconds         = 90
llm_hourly_limit            = 200
postgres_pool_size          = 10
postgres_max_overflow       = 20
default_region              = "us"
reconciler_interval_minutes = 5
