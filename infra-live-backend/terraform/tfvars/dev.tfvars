# aws_region and environment are supplied via workflow inputs (TF_VAR_*)
# state_bucket and db_state_key are supplied via secrets/workflow (TF_VAR_*)

app_name            = "buddy360"
db_name             = "buddy360"
backend_bucket_name = "person-backend-dev-app-bucket"

# Networking — must not overlap with database VPC (dev: 10.1.x.x)
vpc_cidr              = "10.2.0.0/16"
public_subnet_1_cidr  = "10.2.1.0/24"
public_subnet_2_cidr  = "10.2.2.0/24"
private_subnet_1_cidr = "10.2.3.0/24"
private_subnet_2_cidr = "10.2.4.0/24"

# ElastiCache
elasticache_node_type = "cache.t3.micro"

# ECS
task_cpu      = 256
task_memory   = 512
desired_count = 1

# Application
app_env                     = "dev"
openai_model                = "gpt-5.4-mini"
anthropic_model             = "claude-haiku-4-5"
gemini_model                = "gemini-1.5-flash"
llm_timeout_seconds         = 60
llm_hourly_limit            = 50
postgres_pool_size          = 3
postgres_max_overflow       = 5
default_region              = "us"
reconciler_interval_minutes = 5
