# terraform test for the whole backend stack — mock AWS provider: no
# credentials, nothing is created. Checks that the modules (../../modules,
# TF-01) are wired together the way the pre-module stack was.
# Run from infra-live-backend/terraform:
#   terraform init -backend=false && terraform test

mock_provider "aws" {
  override_data {
    target = module.network.data.aws_availability_zones.available
    values = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
  }
  override_data {
    target = module.alb.data.aws_ec2_managed_prefix_list.cloudfront
    values = { id = "pl-cloudfront" }
  }

  # The mock's random ARNs fail the provider's own ARN validation wherever one
  # resource's ARN feeds another.
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:loadbalancer/app/superpower-backend-alb-prod/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:targetgroup/superpower-backend-tg-prod/0123456789abcdef" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:listener/app/superpower-backend-alb-prod/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/test" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:superpower/prod/backend-secrets-AbCdEf" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-alerts-prod" }
  }
  mock_resource "aws_appautoscaling_policy" {
    defaults = { arn = "arn:aws:autoscaling:ap-south-1:111111111111:scalingPolicy:00000000-0000-0000-0000-000000000000:resource/ecs/service/superpower-backend-prod/superpower-worker-prod:policyName/test" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod", id = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111111111111.dkr.ecr.ap-south-1.amazonaws.com/superpower-backend-prod" }
  }
}

mock_provider "aws" {
  alias = "ssm"
}

variables {
  aws_region  = "ap-south-1"
  app_name    = "superpower"
  environment = "prod"
  vpc_cidrs = {
    "ap-south-1" = "10.22.0.0/16"
    "eu-west-1"  = "10.23.0.0/16"
    "us-east-1"  = "10.24.0.0/16"
  }
  nat_gateway_count            = 3
  redis_auth_token             = "0123456789abcdef0123" # gitleaks:allow — fake token for the mock provider
  origin_verify_secret         = "current-secret"
  elasticache_replica_count    = 2
  elasticache_multi_az         = true
  elasticache_node_type        = "cache.r6g.4xlarge"
  subdomain_internal           = "superpower-internal"
  domain_name                  = "example.com"
  hosted_zone_id               = "Z0000000000000"
  acm_certificate_arn          = "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  assets_bucket_name           = "superpower-assets"
  uploads_bucket_name          = "superpower-uploads-ap-south-1"
  regional_logging_bucket_name = "superpower-logs-ap-south-1"
  mongodb_db_name              = "superpower-prod"
  task_cpu                     = 4096
  task_memory                  = 8192
  desired_count                = 2
  enable_execute_command       = false
  openai_model                 = "gpt-test"
  anthropic_model              = "claude-test"
  gemini_model                 = "gemini-test"
  llm_timeout_seconds          = 60
  llm_hourly_limit             = 200
  cors_origins                 = "https://superpower.example.com"
  cookie_domain                = "superpower.example.com"
  enable_all_alarms            = true
  jwt_public_keys              = { "key-v1" = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n" }
}

# Assertions use module outputs (a test can't see inside a child module);
# each module's own internals are covered by modules/*/tests.

run "prod_stack_wiring" {
  command = apply

  # -- network ----------------------------------------------------------------
  assert {
    condition     = module.network.vpc_cidr == "10.22.0.0/16" && length(module.network.private_subnet_ids) == 3 && module.network.nat_gateway_count == 3
    error_message = "This region's /16 from vpc_cidrs, three private subnets, three NATs in prod."
  }
  assert {
    condition     = length(module.network.interface_endpoint_ids) == 5
    error_message = "Prod gets the five interface endpoints."
  }
  assert {
    condition     = toset(module.network.endpoint_client_security_group_ids) == toset([for k in ["admin", "auth", "backend", "worker"] : aws_security_group.service[k].id])
    error_message = "Every task SG reaches the interface endpoints."
  }
  assert {
    condition     = aws_security_group.service["backend"].vpc_id == module.network.vpc_id && aws_security_group.service["worker"].vpc_id == module.network.vpc_id
    error_message = "Task SGs live in the module's VPC."
  }

  # -- ALB --------------------------------------------------------------------
  assert {
    condition = alltrue([
      for k in ["admin", "auth", "backend"] : aws_vpc_security_group_ingress_rule.service_from_alb[k].referenced_security_group_id == module.alb.security_group_id && aws_vpc_security_group_ingress_rule.service_from_alb[k].from_port == 8000
    ])
    error_message = "Admin, auth and API tasks accept 8000 from the ALB SG only."
  }
  assert {
    condition     = keys(module.alb.target_group_arns) == ["admin", "auth", "backend"]
    error_message = "One ALB target group per HTTP service."
  }
  assert {
    condition     = one(aws_route53_record.alb_internal.alias).name == module.alb.dns_name && one(aws_route53_record.alb_internal.alias).zone_id == module.alb.zone_id
    error_message = "Internal DNS aliases the ALB."
  }

  # -- Redis ------------------------------------------------------------------
  assert {
    condition     = toset(module.redis.client_security_group_ids) == toset([for k in ["admin", "auth", "backend"] : aws_security_group.service[k].id]) && module.redis.node_count == 3
    error_message = "Redis reachable from the admin, auth and API task SGs only; primary + 2 replicas in prod."
  }

  # -- API service ------------------------------------------------------------
  assert {
    condition     = module.service["backend"].service_name == "superpower-backend-prod" && module.service["backend"].task_definition_family == "superpower-backend-prod"
    error_message = "API service and family names unchanged."
  }
  assert {
    condition     = module.service["backend"].subnet_ids == toset(module.network.private_subnet_ids) && module.service["backend"].security_group_ids == toset([aws_security_group.service["backend"].id])
    error_message = "API tasks in the private subnets with the API task SG."
  }
  assert {
    condition     = module.service["backend"].target_group_arn == module.alb.target_group_arns["backend"]
    error_message = "API registers with its own ALB target group."
  }
  assert {
    condition     = { for e in jsondecode(module.service["backend"].container_definitions)[0].environment : e.name => e.value }["REDIS_URL"] == "rediss://${module.redis.primary_endpoint_address}:6379"
    error_message = "REDIS_URL points at the module's Redis."
  }
  assert {
    # Exactly these env var names, in order.
    condition     = [for e in jsondecode(module.service["backend"].container_definitions)[0].environment : e.name] == ["APP_COMPONENT", "MONGODB_DB_NAME", "OPENAI_MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL", "COOKIE_SECURE", "COOKIE_SAMESITE", "BEHIND_PROXY", "APP_ENV", "REDIS_URL", "LLM_TIMEOUT_SECONDS", "LLM_HOURLY_LIMIT", "ASSETS_BUCKET_NAME", "UPLOADS_BUCKET_NAME", "AWS_REGION", "UPLOADS_URL_TTL_SECONDS", "CORS_ORIGINS", "COOKIE_DOMAIN", "JWT_KEY_ID", "JWT_PUBLIC_KEYS", "JWT_ISSUER", "JWT_AUDIENCE"]
    error_message = "API container has exactly its env vars."
  }
  assert {
    condition     = { for e in jsondecode(module.service["backend"].container_definitions)[0].environment : e.name => e.value }["APP_COMPONENT"] == "api" && [for x in jsondecode(module.service["backend"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "REDIS_AUTH_TOKEN"]
    error_message = "The API is APP_COMPONENT=api and gets no JWT_PRIVATE_KEY (or GOOGLE_CLIENT_ID) — it verifies with JWT_PUBLIC_KEYS only."
  }
  assert {
    condition     = [for c in jsondecode(module.service["backend"].container_definitions) : c.name] == ["backend", "aws-otel-collector"]
    error_message = "ADOT sidecar is on by default (enable_adot_sidecar)."
  }
  assert {
    condition     = jsondecode(module.service["backend"].container_definitions)[0].secrets[0] == { name = "MONGODB_URI", valueFrom = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:superpower/prod/backend-secrets-AbCdEf:MONGODB_URI::" }
    error_message = "Secrets reference <secret ARN>:<key>::."
  }
  assert {
    condition     = jsondecode(module.service["backend"].container_definitions)[0].image == "111111111111.dkr.ecr.ap-south-1.amazonaws.com/superpower-backend-prod:latest" && jsondecode(module.service["backend"].container_definitions)[0].portMappings == [{ containerPort = 8000, protocol = "tcp" }]
    error_message = "Bootstrap image is the ECR repo's :latest, on port 8000."
  }
  assert {
    condition     = module.service["backend"].scaling_policy_names == { cpu = "superpower-api-cpu-prod", memory = "superpower-api-memory-prod", alb-requests = "superpower-api-alb-requests-prod" }
    error_message = "API keeps its three target-tracking policies with the old names."
  }
  assert {
    condition = module.service["backend"].alarm_names == {
      "sustained:cpu"    = "superpower-api-cpu-sustained-prod"
      "sustained:memory" = "superpower-api-memory-sustained-prod"
      "immediate:cpu"    = "superpower-api-cpu-high-prod"
      "immediate:memory" = "superpower-api-memory-high-prod"
    }
    error_message = "API sustained and immediate CPU/memory alarms (enable_all_alarms) with the old names."
  }

  # -- auth service -----------------------------------------------------------
  assert {
    condition     = module.service["auth"].service_name == "superpower-auth-prod" && module.service["auth"].target_group_arn == module.alb.target_group_arns["auth"]
    error_message = "Auth service registers with its own ALB target group."
  }
  assert {
    condition     = { for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name => e.value }["APP_COMPONENT"] == "auth" && [for x in jsondecode(module.service["auth"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "JWT_PRIVATE_KEY", "GOOGLE_CLIENT_ID", "REDIS_AUTH_TOKEN"]
    error_message = "Auth is APP_COMPONENT=auth and the only service with JWT_PRIVATE_KEY; no LLM keys."
  }
  assert {
    condition     = { for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name => e.value }["JWT_ISSUER"] == "superpower-prod" && { for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name => e.value }["JWT_PUBLIC_KEYS"] == jsonencode(var.jwt_public_keys)
    error_message = "Auth and the API share the same JWT settings."
  }
  assert {
    condition     = module.service["auth"].scaling_policy_names == { cpu = "superpower-auth-cpu-prod", memory = "superpower-auth-memory-prod" }
    error_message = "Auth scales on CPU and memory."
  }
  assert {
    condition     = aws_iam_role.task["auth"].name == "superpower-auth-task-role-prod-ap-south-1" && aws_security_group.service["auth"].name == "superpower-auth-sg-prod" && aws_cloudwatch_log_group.service["auth"].name == "/ecs/superpower/auth/prod"
    error_message = "Auth gets the default per-service names."
  }

  # -- admin service ----------------------------------------------------------
  assert {
    condition     = module.service["admin"].service_name == "superpower-admin-prod" && module.service["admin"].target_group_arn == module.alb.target_group_arns["admin"]
    error_message = "Admin service registers with its own ALB target group."
  }
  assert {
    condition     = { for e in jsondecode(module.service["admin"].container_definitions)[0].environment : e.name => e.value }["APP_COMPONENT"] == "admin" && [for x in jsondecode(module.service["admin"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "REDIS_AUTH_TOKEN"]
    error_message = "Admin is APP_COMPONENT=admin with only MONGODB_URI and REDIS_AUTH_TOKEN — no private key, no LLM keys."
  }
  assert {
    condition     = { for e in jsondecode(module.service["admin"].container_definitions)[0].environment : e.name => e.value }["JWT_PUBLIC_KEYS"] == jsonencode(var.jwt_public_keys)
    error_message = "Admin verifies with the same JWT_PUBLIC_KEYS as auth and the API."
  }
  assert {
    condition     = module.service["admin"].scaling_policy_names == { cpu = "superpower-admin-cpu-prod", memory = "superpower-admin-memory-prod" } && aws_iam_role.task["admin"].name == "superpower-admin-task-role-prod-ap-south-1" && aws_security_group.service["admin"].name == "superpower-admin-sg-prod"
    error_message = "Admin scales on CPU and memory and gets the default per-service names."
  }

  # -- worker service ---------------------------------------------------------
  assert {
    condition     = module.service["worker"].service_name == "superpower-worker-prod" && module.service["worker"].target_group_arn == null
    error_message = "Worker service unchanged and has no load balancer."
  }
  assert {
    condition     = jsondecode(module.service["worker"].container_definitions)[0].command == ["python", "worker.py"] && [for x in jsondecode(module.service["worker"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] && [for e in jsondecode(module.service["worker"].container_definitions)[0].environment : e.name] == ["APP_COMPONENT", "MONGODB_DB_NAME", "OPENAI_MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL", "APP_ENV", "LLM_TIMEOUT_SECONDS", "AWS_REGION", "WORKER_CONCURRENCY", "WORKER_POLL_INTERVAL_SECONDS", "WORKER_SCOPE_TO_REGION"]
    error_message = "Worker runs worker.py with its 11 env vars and 4 secrets (no JWT keys)."
  }
  assert {
    condition     = module.service["worker"].security_group_ids == toset([aws_security_group.service["worker"].id]) && module.service["worker"].subnet_ids == toset(module.network.private_subnet_ids)
    error_message = "Worker tasks use the worker SG in the private subnets."
  }
  assert {
    condition     = module.service["worker"].scaling_policy_names == { cpu = "superpower-worker-cpu-prod", pending-jobs = "superpower-worker-pending-jobs-prod", scale-in = "superpower-worker-scale-in-prod" }
    error_message = "Worker keeps its three policies with the old names."
  }
  assert {
    condition = module.service["worker"].alarm_names == {
      "step:pending-jobs" = "superpower-worker-pending-jobs-prod"
      "step:scale-in"     = "superpower-worker-pending-jobs-low-prod"
      "sustained:cpu"     = "superpower-worker-cpu-sustained-prod"
      "immediate:cpu"     = "superpower-worker-cpu-high-prod"
      "immediate:memory"  = "superpower-worker-memory-high-prod"
    }
    error_message = "Worker keeps its alarms with the old names."
  }

  # -- per-service IAM, SG, logs (services.tf) ----------------------------------
  assert {
    condition     = aws_iam_role.task["backend"].name == "superpower-ecs-task-role-prod-ap-south-1" && aws_iam_role.task["worker"].name == "superpower-worker-task-role-prod-ap-south-1"
    error_message = "Task role names unchanged (iam_name overrides)."
  }
  assert {
    condition = toset([for p in aws_iam_role_policy.task : p.name]) == toset([
      "superpower-ecs-task-s3-prod-ap-south-1",
      "superpower-ecs-task-s3-uploads-prod-ap-south-1",
      "superpower-worker-task-cloudwatch-prod-ap-south-1",
    ])
    error_message = "Each service keeps exactly its own task policies, with the old names."
  }
  assert {
    condition     = length(aws_iam_role_policy.task_xray) == 4 && aws_iam_role_policy.task_xray["worker"].name == "superpower-worker-task-xray-prod-ap-south-1" && length(aws_iam_role_policy.task_exec_command) == 0
    error_message = "X-Ray policy on every service when ADOT is on; no ECS Exec policy when exec is off."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.task["worker/cloudwatch"].policy).Statement[0].Condition.StringEquals["cloudwatch:namespace"] == "Superpower/Worker"
    error_message = "The worker's PutMetricData stays scoped to its namespace."
  }
  assert {
    condition     = aws_security_group.service["backend"].name == "superpower-ecs-task-sg-prod" && aws_security_group.service["worker"].name == "superpower-worker-sg-prod"
    error_message = "Security group names unchanged (security_group overrides)."
  }
  assert {
    condition     = keys(aws_vpc_security_group_ingress_rule.service_from_alb) == ["admin", "auth", "backend"]
    error_message = "Only the HTTP services accept traffic from the ALB."
  }
  assert {
    condition     = aws_cloudwatch_log_group.service["worker"].name == "/ecs/superpower/worker/prod" && jsondecode(module.service["worker"].container_definitions)[0].logConfiguration.options["awslogs-group"] == "/ecs/superpower/worker/prod"
    error_message = "Each service logs to its own /ecs/<app>/<key>/<env> group."
  }

  # -- SSM hand-off -----------------------------------------------------------
  assert {
    condition = jsondecode(aws_ssm_parameter.ecs_services.value) == [
      { name = "auth", service = "superpower-auth-prod", family = "superpower-auth-prod", container = "auth" },
      { name = "admin", service = "superpower-admin-prod", family = "superpower-admin-prod", container = "admin" },
      { name = "backend", service = "superpower-backend-prod", family = "superpower-backend-prod", container = "backend" },
      { name = "worker", service = "superpower-worker-prod", family = "superpower-worker-prod", container = "worker" },
    ]
    error_message = "ecs_services lists every service in deploy_order — what the deploy/restart/promote workflows read."
  }
  assert {
    condition     = aws_ssm_parameter.ecs_cluster_name.value == aws_ecs_cluster.backend.name
    error_message = "Deploy workflows still find the cluster in SSM."
  }
}

run "dev_has_no_interface_endpoints_or_sustained_alarms" {
  command = apply

  variables {
    environment               = "dev"
    vpc_cidrs                 = { "ap-south-1" = "10.2.0.0/16" }
    nat_gateway_count         = 1
    elasticache_replica_count = 0
    elasticache_multi_az      = false
    enable_all_alarms         = false
  }

  assert {
    condition     = length(module.network.interface_endpoint_ids) == 0 && module.network.nat_gateway_count == 1 && module.network.endpoint_client_security_group_ids == []
    error_message = "Dev: one NAT, no interface endpoints or endpoint rules."
  }
  assert {
    condition     = length([for k, _ in module.service["backend"].alarm_names : k if startswith(k, "sustained:")]) == 0 && length([for k, _ in module.service["worker"].alarm_names : k if startswith(k, "sustained:")]) == 0
    error_message = "Dev: no sustained alarms."
  }
  assert {
    condition     = module.redis.node_count == 1
    error_message = "Dev: single Redis node."
  }
}

run "jwt_public_keys_must_hold_the_signing_key" {
  # The API verifies with JWT_PUBLIC_KEYS only — without the current kid's key
  # it would reject every token auth issues.
  command = plan

  variables {
    jwt_public_keys = { "key-v0" = "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----\n" }
  }

  expect_failures = [var.jwt_public_keys]
}
