# terraform test for the whole backend stack — mock AWS provider: no
# credentials, nothing is created. Checks that the modules (../../modules,
# TF-01) are wired together for the split's runtimes (services.tf,
# docs/auth-users-split.md 15). The service-token public keys are mocked SSM reads:
# scripts/service-token-keys.sh makes the pairs outside Terraform (SEC-01).
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
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n" }
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
    defaults = { arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:superpower/prod/service-secrets-AbCdEf" }
  }
  mock_resource "aws_ssm_parameter" {
    defaults = { arn = "arn:aws:ssm:ap-south-1:111111111111:parameter/superpower/prod/backend/ap-south-1/service/internal_signing_key" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-events" }
  }
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-events" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:ap-south-1:111111111111:key/00000000-0000-0000-0000-000000000000", key_id = "00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_appautoscaling_policy" {
    defaults = { arn = "arn:aws:autoscaling:ap-south-1:111111111111:scalingPolicy:00000000-0000-0000-0000-000000000000:resource/ecs/service/superpower-backend-prod/superpower-users-prod:policyName/test" }
  }
  mock_resource "aws_service_discovery_service" {
    defaults = { arn = "arn:aws:servicediscovery:ap-south-1:111111111111:service/srv-0123456789abcdef" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod", id = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111111111111.dkr.ecr.ap-south-1.amazonaws.com/superpower/prod/service" }
  }
}

mock_provider "aws" {
  alias = "ssm"
}

# The Atlas side of the PrivateLink endpoint (atlas.tf, DEC-02).
mock_provider "mongodbatlas" {
  mock_resource "mongodbatlas_privatelink_endpoint" {
    defaults = {
      endpoint_service_name = "com.amazonaws.vpce.ap-south-1.vpce-svc-0123456789abcdef0"
      private_link_id       = "65f0a1b2c3d4e5f6a7b8c9d0"
    }
  }
}

variables {
  aws_region       = "ap-south-1"
  app_name         = "superpower"
  environment      = "prod"
  atlas_project_id = "0123456789abcdef01234567"
  vpc_cidrs = {
    "ap-south-1" = "10.22.0.0/16"
    "eu-west-1"  = "10.23.0.0/16"
    "us-east-1"  = "10.24.0.0/16"
  }
  nat_gateway_count            = 3
  origin_verify_secret         = "current-secret"
  elasticache_replica_count    = 1
  elasticache_multi_az         = true
  elasticache_node_type        = "cache.t4g.medium"
  subdomain_internal           = "superpower-internal"
  domain_name                  = "example.com"
  hosted_zone_id               = "Z0000000000000"
  acm_certificate_arn          = "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  assets_bucket_name           = "superpower-assets"
  uploads_bucket_name          = "superpower-uploads-ap-south-1"
  regional_logging_bucket_name = "superpower-logs-ap-south-1"
  runtime_sizes = {
    "http"              = { cpu = 1024, memory = 2048, desired_count = 2, min_capacity = 2, max_capacity = 25 }
    "auth"              = { cpu = 2048, memory = 4096, desired_count = 3, min_capacity = 3, max_capacity = 30 }
    "worker"            = { cpu = 512, memory = 1024, desired_count = 1, min_capacity = 1, max_capacity = 5 }
    "generating-worker" = { cpu = 1024, memory = 2048, desired_count = 1, min_capacity = 1, max_capacity = 10 }
    "collector"         = { cpu = 512, memory = 1024, desired_count = 2, min_capacity = 2, max_capacity = 4 }
  }
  enable_execute_command = false
  # These sizes peak at 290 Mongo tasks x (5 + 6) = 3190 connections (TF-03).
  mongodb_connection_budget = 3190
  openai_model              = "gpt-test"
  anthropic_model           = "claude-test"
  gemini_model              = "gemini-test"
  llm_timeout_seconds       = 60
  llm_hourly_limit          = 200
  cookie_domain             = "superpower.example.com"
  enable_all_alarms         = true
  enable_basic_alarms       = true
  jwt_public_keys           = { "key-v1" = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n" }
}

# Assertions use module outputs (a test can't see inside a child module);
# each module's own internals are covered by modules/*/tests.

run "prod_stack_wiring" {
  command = apply

  # -- the runtimes -------------------------------------------------------------
  assert {
    condition = toset(keys(local.services)) == toset([
      "auth", "users", "children", "onboarding", "discover", "grow", "transform", "release", "shared",
      "auth-worker", "users-worker", "children-worker", "onboarding-worker", "discover-worker", "grow-worker", "transform-worker", "release-worker",
      "otel-collector",
    ])
    error_message = "9 HTTP services, 8 workers (none for shared) and the collector."
  }
  assert {
    condition = alltrue([
      for k, s in local.services : s.kind == "worker" ? (
        jsondecode(module.service[k].container_definitions)[0].stopTimeout == 90 &&
        strcontains(jsondecode(module.service[k].container_definitions)[0].healthCheck.command[1], "worker-heartbeat")
      ) : !contains(keys(jsondecode(module.service[k].container_definitions)[0]), "stopTimeout")
    ])
    error_message = "Every worker gets llm_timeout_seconds + 30 to stop (APP-06) and a heartbeat health check; HTTP services and the collector keep ECS's default."
  }
  assert {
    condition     = module.service["users"].service_name == "superpower-users-prod" && module.service["users-worker"].task_definition_family == "superpower-users-worker-prod"
    error_message = "ECS names are <app>-<runtime>-<env>."
  }

  # -- network ----------------------------------------------------------------
  assert {
    condition     = module.network.vpc_cidr == "10.22.0.0/16" && length(module.network.private_subnet_ids) == 3 && module.network.nat_gateway_count == 3
    error_message = "This region's /16 from vpc_cidrs, three private subnets, three NATs in prod."
  }
  assert {
    condition     = length(module.network.interface_endpoint_ids) == 5 && toset(module.network.endpoint_client_security_group_ids) == toset([for k, _ in local.services : aws_security_group.service[k].id])
    error_message = "Prod gets the five interface endpoints, reachable from every task SG."
  }

  # -- ALB --------------------------------------------------------------------
  assert {
    condition     = toset(keys(module.alb.target_group_arns)) == toset(["auth", "users", "children", "onboarding", "discover", "grow", "transform", "release", "shared"])
    error_message = "One ALB target group per HTTP service; none for workers or the collector."
  }
  assert {
    condition = alltrue([
      for k, r in aws_vpc_security_group_ingress_rule.service_from_alb : r.referenced_security_group_id == module.alb.security_group_id && r.from_port == 8000
    ]) && toset(keys(aws_vpc_security_group_ingress_rule.service_from_alb)) == toset(keys(module.alb.target_group_arns))
    error_message = "Only the HTTP services accept 8000, from the ALB SG only."
  }
  assert {
    condition     = module.service["grow"].target_group_arn == module.alb.target_group_arns["grow"] && module.service["grow-worker"].target_group_arn == null
    error_message = "A service registers with its own target group; its worker has none."
  }
  assert {
    condition     = one(aws_route53_record.alb_internal.alias).name == module.alb.dns_name && one(aws_route53_record.alb_internal.alias).zone_id == module.alb.zone_id
    error_message = "Internal DNS aliases the ALB."
  }

  # -- service discovery (13.2) -------------------------------------------------
  assert {
    condition     = aws_service_discovery_private_dns_namespace.internal.name == "superpower-prod.internal" && aws_service_discovery_private_dns_namespace.internal.vpc == module.network.vpc_id
    error_message = "One private Cloud Map namespace on the stack's VPC."
  }
  assert {
    condition     = module.service["users"].service_discovery_name == "users" && module.service["users"].internal_port == 8001 && module.service["otel-collector"].service_discovery_name == "otel-collector" && module.service["otel-collector"].internal_port == 4318
    error_message = "HTTP services register as <service> on 8001; the collector as otel-collector on 4318."
  }
  assert {
    condition     = module.service["shared"].service_discovery_name == null && module.service["users-worker"].service_discovery_name == null
    error_message = "Platform (no internal API) and the workers don't register."
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.internal_from_callers)) == toset(["auth", "users", "children", "onboarding", "discover", "grow", "transform", "release", "otel-collector"]) && alltrue([for r in aws_vpc_security_group_ingress_rule.internal_from_callers : r.referenced_security_group_id == aws_security_group.internal_callers.id])
    error_message = "Registered runtimes admit their internal port from the internal-callers group only."
  }
  assert {
    condition     = module.service["users-worker"].security_group_ids == toset([aws_security_group.service["users-worker"].id, aws_security_group.internal_callers.id]) && module.service["otel-collector"].security_group_ids == toset([aws_security_group.service["otel-collector"].id])
    error_message = "Every service runtime joins internal-callers; the collector calls no one."
  }

  # -- Redis ------------------------------------------------------------------
  assert {
    condition     = toset(module.redis.client_security_group_ids) == toset([for k, s in local.services : aws_security_group.service[k].id if k != "otel-collector"]) && module.redis.node_count == 2
    error_message = "Valkey reachable from every service runtime but not the collector; primary + 1 replica in prod."
  }
  assert {
    condition     = toset(keys(module.redis.rbac_user_names)) == toset(["auth", "users", "children", "onboarding", "discover", "grow", "transform", "release", "shared"])
    error_message = "One Valkey RBAC user per service."
  }

  # -- auth --------------------------------------------------------------------
  assert {
    # Exactly these env var names, in order.
    condition = [for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name] == [
      "SERVICE_NAME", "APP_NAME", "APP_ENV", "AWS_REGION", "MONGODB_DB_NAME", "MONGODB_MAX_POOL_SIZE", "REDIS_URL", "REDIS_USERNAME", "REDIS_REPLICATION_GROUP_ID",
      "INTERNAL_DNS_SUFFIX", "INTERNAL_SIGNING_KID", "INTERNAL_PUBLIC_KEYS", "OTEL_EXPORTER_OTLP_ENDPOINT", "LOG_LEVEL", "PUBLIC_ORIGINS",
      "JWT_KEY_ID", "JWT_PUBLIC_KEYS", "JWT_ISSUER", "JWT_AUDIENCE", "BEHIND_PROXY", "HTTP_KEEP_ALIVE_SECONDS", "COOKIE_SECURE", "COOKIE_SAMESITE",
      "DELETION_PARTICIPANTS",
    ]
    error_message = "Auth's HTTP container has exactly its env vars."
  }
  assert {
    condition     = [for x in jsondecode(module.service["auth"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "JWT_PRIVATE_KEY", "GOOGLE_CLIENT_ID", "EMAIL_HMAC_PEPPER", "INTERNAL_SIGNING_KEY"]
    error_message = "Auth is the only service with JWT_PRIVATE_KEY; no LLM keys."
  }
  assert {
    condition     = jsondecode(module.service["auth"].container_definitions)[0].secrets[0] == { name = "MONGODB_URI", valueFrom = "${aws_secretsmanager_secret.service["auth"].arn}:MONGODB_URI::" } && jsondecode(module.service["auth"].container_definitions)[0].secrets[4].valueFrom == "arn:aws:ssm:ap-south-1:111111111111:parameter/superpower/prod/backend/ap-south-1/auth/service_token/auth-v1/private"
    error_message = "Secrets reference <secret ARN>:<key>::; the signing key comes from SSM."
  }
  assert {
    condition = { for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name => e.value }["REDIS_URL"] == "rediss://${module.redis.primary_endpoint_address}:6379" && { for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name => e.value }["REDIS_USERNAME"] == module.redis.rbac_user_names["auth"] && {
      for e in jsondecode(module.service["auth"].container_definitions)[0].environment : e.name => e.value
    }["MONGODB_DB_NAME"] == "auth"
    error_message = "Each service connects to Valkey as its own user and to its own database."
  }
  assert {
    condition     = module.service["auth"].scaling_policy_names == { cpu = "superpower-auth-cpu-prod", memory = "superpower-auth-memory-prod", alb-requests = "superpower-auth-alb-requests-prod" }
    error_message = "HTTP services scale on CPU, memory and requests per target."
  }
  assert {
    condition = module.service["auth"].alarm_names == {
      "sustained:cpu"    = "superpower-auth-cpu-sustained-prod"
      "sustained:memory" = "superpower-auth-memory-sustained-prod"
      "immediate:cpu"    = "superpower-auth-cpu-high-prod"
      "immediate:memory" = "superpower-auth-memory-high-prod"
    }
    error_message = "Sustained and immediate CPU/memory alarms (enable_all_alarms)."
  }

  assert {
    condition     = { for e in jsondecode(module.service["auth-worker"].container_definitions)[0].environment : e.name => e.value }["DELETION_PARTICIPANTS"] == "users,children,onboarding,discover,grow,transform,release"
    error_message = "auth and its worker wait for the participants deployed so far (users), not all seven (build plan 3.5)."
  }
  assert {
    condition     = aws_cloudwatch_log_metric_filter.deletion_stuck[0].log_group_name == aws_cloudwatch_log_group.service["auth-worker"].name && aws_cloudwatch_metric_alarm.deletion_stuck[0].namespace == "Superpower/auth"
    error_message = "A deletion stuck over 24 h alarms, from the auth-worker's log line."
  }

  # -- the generating circles -------------------------------------------------------
  assert {
    condition     = [for x in jsondecode(module.service["discover"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "INTERNAL_SIGNING_KEY"]
    error_message = "A generating circle's HTTP runtime gets no LLM keys: only its worker calls an LLM."
  }
  assert {
    condition     = [for x in jsondecode(module.service["discover-worker"].container_definitions)[0].secrets : x.name] == ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "INTERNAL_SIGNING_KEY"]
    error_message = "The generating worker gets the LLM keys."
  }
  assert {
    condition     = jsondecode(module.service["discover-worker"].container_definitions)[0].command == ["python", "-m", "discover.worker"] && lookup(jsondecode(module.service["discover"].container_definitions)[0], "command", null) == null
    error_message = "A worker overrides its service image's command; the HTTP runtime keeps the image's CMD."
  }
  assert {
    condition     = jsondecode(module.service["discover-worker"].container_definitions)[0].image == "${aws_ecr_repository.service["discover"].repository_url}:latest" && jsondecode(module.service["discover"].container_definitions)[0].image == "${aws_ecr_repository.service["discover"].repository_url}:latest"
    error_message = "A service and its worker share one ECR repository; bootstrap image is :latest."
  }
  assert {
    condition     = module.service["discover-worker"].scaling_policy_names == { cpu = "superpower-discover-worker-cpu-prod", queue-depth = "superpower-discover-worker-queue-depth-prod", queue-low = "superpower-discover-worker-queue-low-prod", pending-jobs = "superpower-discover-worker-pending-jobs-prod" }
    error_message = "Generating workers scale on queue depth and PendingJobCount, with a CPU floor."
  }
  assert {
    condition     = module.service["users-worker"].scaling_policy_names == { cpu = "superpower-users-worker-cpu-prod", queue-depth = "superpower-users-worker-queue-depth-prod", queue-low = "superpower-users-worker-queue-low-prod" }
    error_message = "Other workers scale on queue depth only, with a CPU floor."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.task["discover-worker/metrics"].policy).Statement[0].Condition.StringEquals["cloudwatch:namespace"] == "Superpower/discover"
    error_message = "PutMetricData is scoped to the service's own namespace."
  }

  # -- events (7.2) ---------------------------------------------------------------
  assert {
    condition = alltrue([
      for s in keys(module.events.queue_urls) : { for e in jsondecode(module.service["${s}-worker"].container_definitions)[0].environment : e.name => e.value }["EVENTS_QUEUE_URL"] == module.events.queue_urls[s]
    ])
    error_message = "Each consuming worker gets its own queue's URL."
  }
  assert {
    condition = alltrue([
      for s in keys(module.events.topic_arns) : { for e in jsondecode(module.service["${s}-worker"].container_definitions)[0].environment : e.name => e.value }["EVENTS_TOPIC_ARN"] == module.events.topic_arns[s]
    ])
    error_message = "Each producing worker gets its own topic's ARN."
  }
  assert {
    condition     = toset([for k, _ in aws_iam_role_policy.task : split("/", k)[0] if endswith(k, "/events")]) == toset([for s in ["auth", "users", "children", "onboarding", "discover", "grow", "transform", "release"] : "${s}-worker"])
    error_message = "Only the workers get an events policy."
  }

  # -- shared and the collector ----------------------------------------------------
  assert {
    condition     = [for x in jsondecode(module.service["shared"].container_definitions)[0].secrets : x.name] == ["OPENAI_API_KEY", "INTERNAL_SIGNING_KEY"] && { for e in jsondecode(module.service["shared"].container_definitions)[0].environment : e.name => e.value }["ASSETS_BUCKET_NAME"] == "superpower-assets"
    error_message = "Platform has no database: only its speech-to-text key, and the assets bucket for the APK link."
  }
  assert {
    condition     = toset([for k, _ in aws_iam_role_policy.task : split("/", k)[1] if startswith(k, "shared/")]) == toset(["valkey", "s3-apk"])
    error_message = "Platform's task role: Valkey and the APK prefix only."
  }
  assert {
    condition     = jsondecode(module.service["otel-collector"].container_definitions)[0].image == var.otel_collector_image && [for e in jsondecode(module.service["otel-collector"].container_definitions)[0].environment : e.name] == ["AOT_CONFIG_CONTENT"] && length(jsondecode(module.service["otel-collector"].container_definitions)[0].secrets) == 0
    error_message = "The collector runs the pinned ADOT image with its config and no secrets."
  }
  assert {
    condition     = yamldecode(local.otel_collector_config).processors.tail_sampling.policies[2].probabilistic.sampling_percentage == 5 && yamldecode(local.otel_collector_config).service.pipelines.traces.exporters == ["awsxray"]
    error_message = "Tail sampling keeps xray_default_sampling_rate (default 5%) of ordinary traces and exports to X-Ray."
  }
  assert {
    condition     = toset([for k, _ in aws_iam_role_policy.task : split("/", k)[1] if startswith(k, "otel-collector/")]) == toset(["xray"]) && !contains(keys(aws_iam_role_policy.execution_secrets), "otel-collector")
    error_message = "The collector's only AWS access is X-Ray; its execution role reads no secrets."
  }

  # -- isolation (15.1) -----------------------------------------------------------
  assert {
    condition     = jsondecode(aws_iam_role_policy.execution_secrets["users-worker"].policy).Statement[0].Resource == [aws_secretsmanager_secret.service["users"].arn] && jsondecode(aws_iam_role_policy.execution_secrets["users-worker"].policy).Statement[1].Resource == ["arn:aws:ssm:ap-south-1:111111111111:parameter/superpower/prod/backend/ap-south-1/users/service_token/users-v1/private"]
    error_message = "A runtime's execution role reads only its own service's secret and signing key."
  }
  assert {
    condition     = toset([for k, _ in aws_iam_role_policy.task : k if endswith(k, "/s3-uploads")]) == toset(["children/s3-uploads", "children-worker/s3-uploads", "transform/s3-uploads", "transform-worker/s3-uploads"])
    error_message = "Only children and transform touch the uploads bucket."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.task["children/s3-uploads"].policy).Statement[0].Resource == "arn:aws:s3:::superpower-uploads-ap-south-1/uploads/*/*/avatar/*"
    error_message = "Children's uploads access is its avatar prefix only."
  }
  assert {
    condition     = length(aws_iam_role_policy.task_exec_command) == 0 && aws_iam_role.task["onboarding-worker"].name == "superpower-onboarding-worker-task-role-prod-ap-south-1"
    error_message = "No ECS Exec policy when exec is off; per-runtime role names."
  }
  assert {
    condition     = toset(keys(aws_secretsmanager_secret.service)) == toset(keys(aws_ecr_repository.service)) && length(aws_secretsmanager_secret.service) == 9 && aws_secretsmanager_secret.service["grow"].name == "superpower/prod/grow-secrets"
    error_message = "One secret and one ECR repository per service."
  }
  assert {
    condition     = aws_cloudwatch_log_group.service["grow-worker"].name == "/ecs/superpower/grow-worker/prod" && jsondecode(module.service["grow-worker"].container_definitions)[0].logConfiguration.options["awslogs-group"] == "/ecs/superpower/grow-worker/prod"
    error_message = "Each runtime logs to its own /ecs/<app>/<runtime>/<env> group."
  }
  assert {
    condition     = one([for x in aws_ecs_cluster.backend.setting : x.value if x.name == "containerInsights"]) == "enabled"
    error_message = "Prod: Container Insights on (enable_container_insights defaults to true)."
  }

  # -- service tokens (13.2) --------------------------------------------------------
  assert {
    condition     = local.signing_kid["auth"] == "auth-v1" && toset(keys(local.internal_public_keys)) == toset(keys(aws_ecr_repository.service)) && keys(local.internal_public_keys["users"]) == ["users-v1"]
    error_message = "Each service signs with kid <service>-v1 by default; every runtime gets every public key."
  }
  assert {
    condition     = data.aws_ssm_parameter.service_token_public["users"].name == "/superpower/prod/backend/ap-south-1/users/service_token/users-v1/public" && startswith(local.internal_public_keys["users"]["users-v1"], "-----BEGIN PUBLIC KEY-----")
    error_message = "Each public key is read from the key script's String parameter (SEC-01)."
  }
  assert {
    condition     = jsondecode(aws_ssm_parameter.internal_public_keys.value) == local.internal_public_keys
    error_message = "The public-key map is published to SSM."
  }

  # -- SSM hand-off -----------------------------------------------------------
  assert {
    condition     = [for e in jsondecode(aws_ssm_parameter.ecs_services.value) : e.name] == ["otel-collector", "auth", "auth-worker", "users", "users-worker", "children", "children-worker", "onboarding", "onboarding-worker", "discover", "discover-worker", "grow", "grow-worker", "transform", "transform-worker", "release", "release-worker", "shared"]
    error_message = "ecs_services lists every runtime in deploy_order (the collector first) — what the deploy/restart/promote workflows read."
  }
  assert {
    condition = jsondecode(aws_ssm_parameter.ecs_services.value)[2] == {
      name = "auth-worker", service = "superpower-auth-worker-prod", family = "superpower-auth-worker-prod", container = "auth-worker", image_service = "auth", ecr_repository_url = aws_ecr_repository.service["auth"].repository_url
    } && jsondecode(aws_ssm_parameter.ecs_services.value)[0].image_service == "" && jsondecode(aws_ssm_parameter.ecs_services.value)[0].ecr_repository_url == ""
    error_message = "A worker's entry names its service's image; the collector's names none."
  }
  assert {
    condition     = aws_ssm_parameter.ecs_cluster_name.value == aws_ecs_cluster.backend.name
    error_message = "Deploy workflows still find the cluster in SSM."
  }

  # -- alarms (OBS-01) ------------------------------------------------------------
  assert {
    condition = (
      one([for q in aws_cloudwatch_metric_alarm.alb_5xx[0].metric_query : q.expression if coalesce(q.return_data, false)]) == "IF(requests >= 20, 100 * (FILL(target5xx, 0) + FILL(elb5xx, 0)) / requests, 0)" &&
      toset([for q in aws_cloudwatch_metric_alarm.alb_5xx[0].metric_query : one(q.metric).metric_name if length(q.metric) > 0]) == toset(["RequestCount", "HTTPCode_Target_5XX_Count", "HTTPCode_ELB_5XX_Count"]) &&
      aws_cloudwatch_metric_alarm.alb_5xx[0].threshold == 5
    )
    error_message = "ALB 5xx is a rate of all requests, the services' and the load balancer's 5xx together, over 5%."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.alb_slow[0].extended_statistic == "p95" && aws_cloudwatch_metric_alarm.alb_slow[0].threshold == 3
    error_message = "A p95 response-time alarm on the ALB, over 3 s."
  }
  assert {
    condition = (
      toset(keys(aws_cloudwatch_metric_alarm.valkey)) == toset(["cpu", "memory", "evictions"]) &&
      alltrue([for k, a in aws_cloudwatch_metric_alarm.valkey : length(a.metric_query) == length(local.redis_member_ids) + 1]) &&
      one([for q in aws_cloudwatch_metric_alarm.valkey["evictions"].metric_query : q.expression if coalesce(q.return_data, false)]) == "SUM(METRICS())"
    )
    error_message = "Valkey CPU, memory and eviction alarms, each over every node."
  }

  # -- generation and runtime alarms (OBS-02, JOB-02, JOB-03, OBS-03) -------------
  assert {
    condition = (
      toset(keys(aws_cloudwatch_metric_alarm.pending_age)) == toset(local.generating_services) &&
      alltrue([for k, a in aws_cloudwatch_metric_alarm.pending_age : a.metric_name == "OldestPendingJobAgeSeconds" && a.namespace == "Superpower/${k}"])
    )
    error_message = "A jobs-waiting alarm per generating service (OBS-02)."
  }
  assert {
    condition = (
      toset(keys(aws_cloudwatch_log_metric_filter.failed_jobs)) == toset(local.generating_services) &&
      alltrue([for k, f in aws_cloudwatch_log_metric_filter.failed_jobs : f.pattern == "\"outcome=failed\"" && f.log_group_name == aws_cloudwatch_log_group.service["${k}-worker"].name]) &&
      length(aws_cloudwatch_metric_alarm.failed_jobs) == length(local.generating_services)
    )
    error_message = "Failed jobs counted from each generating worker's log, with an alarm (JOB-02)."
  }
  assert {
    condition = (
      length(aws_cloudwatch_log_metric_filter.llm_tokens) == 2 * length(local.generating_services) &&
      aws_cloudwatch_log_metric_filter.llm_tokens["grow-output"].pattern == "{ $.llm_call.output_tokens > 0 }" &&
      one(aws_cloudwatch_log_metric_filter.llm_tokens["grow-output"].metric_transformation).value == "$.llm_call.output_tokens" &&
      length(aws_cloudwatch_metric_alarm.llm_tokens[0].metric_query) == 2 * length(local.generating_services) + 1 &&
      aws_cloudwatch_metric_alarm.llm_tokens[0].threshold == var.llm_tokens_alarm_per_hour
    )
    error_message = "LLM input and output tokens per circle, and one hourly spend alarm over them all (JOB-03)."
  }
  assert {
    condition = (
      aws_ssm_parameter.generation_switch.name == "/superpower/prod/backend/ap-south-1/llm_generation_enabled" &&
      aws_ssm_parameter.generation_switch.value == "true" &&
      alltrue([for k, s in local.services : (
        contains(local.generating_services, coalesce(s.service, "-")) ==
        contains([for e in jsondecode(module.service[k].container_definitions)[0].environment : e.name], "LLM_SWITCH_PARAMETER")
      ) if s.kind != "collector"]) &&
      alltrue([for k, r in local.runtime_kinds : contains(keys(local.task_policies[k]), "generation-switch") == contains(local.generating_services, coalesce(r.service, "-"))])
    )
    error_message = "The generation switch: one parameter, given (and readable) to the generating services only (JOB-03)."
  }
  assert {
    condition = (
      toset(keys(aws_cloudwatch_metric_alarm.no_tasks)) == toset(keys(local.services)) &&
      alltrue([for k, a in aws_cloudwatch_metric_alarm.no_tasks : a.treat_missing_data == "breaching" && a.dimensions.ServiceName == module.service[k].service_name])
    )
    error_message = "A no-running-task alarm for every runtime, missing data breaching (OBS-03)."
  }
  assert {
    condition = anytrue([for s in jsondecode(aws_s3_bucket_policy.regional_logging[0].policy).Statement : (
      s.Effect == "Deny" && s.Principal == "*" && s.Action == "s3:*" &&
      s.Condition.Bool["aws:SecureTransport"] == "false" &&
      toset(s.Resource) == toset(["arn:aws:s3:::superpower-logs-ap-south-1", "arn:aws:s3:::superpower-logs-ap-south-1/*"])
    )])
    error_message = "The regional logging bucket refuses plain HTTP, on the bucket and its objects (TF-05)."
  }
  assert {
    condition = (
      toset(keys(aws_cloudwatch_log_metric_filter.valkey_degraded)) == toset([for k, s in local.services : k if s.kind != "collector"]) &&
      alltrue([for k, f in aws_cloudwatch_log_metric_filter.valkey_degraded : (
        f.log_group_name == aws_cloudwatch_log_group.service[k].name &&
        f.metric_transformation[0].name == "ValkeyDegraded" && f.metric_transformation[0].namespace == "Superpower/valkey"
      )]) &&
      aws_cloudwatch_metric_alarm.valkey_degraded[0].metric_name == "ValkeyDegraded" &&
      aws_cloudwatch_metric_alarm.valkey_degraded[0].evaluation_periods == 2
    )
    error_message = "Every runtime but the collector counts its Valkey fallbacks into one ValkeyDegraded metric, with one alarm (APP-04)."
  }
  assert {
    condition = (
      toset(keys(aws_cloudwatch_log_metric_filter.index_problems)) == toset([for k, s in local.services : k if s.kind != "collector"]) &&
      alltrue([for k, f in aws_cloudwatch_log_metric_filter.index_problems : (
        f.log_group_name == aws_cloudwatch_log_group.service[k].name && f.pattern == "{ $.index_problem = * }" &&
        f.metric_transformation[0].name == "IndexProblems" && f.metric_transformation[0].namespace == "Superpower/mongo"
      )]) &&
      aws_cloudwatch_metric_alarm.index_problems[0].metric_name == "IndexProblems" &&
      aws_cloudwatch_metric_alarm.index_problems[0].threshold == 1
    )
    error_message = "Every runtime but the collector counts its index build problems into one IndexProblems metric, with one alarm (DB-03)."
  }
  assert {
    condition = alltrue([for k, s in local.services : contains(
      [for e in jsondecode(module.service[k].container_definitions)[0].environment : "${e.name}=${e.value}"],
      "PUBLIC_ORIGINS=https://superpower.example.com"
    ) if s.kind != "collector"])
    error_message = "Every runtime gets the web app's origin, for the cross-site cookie check (AUTH-05)."
  }
  assert {
    condition = (
      aws_cloudwatch_log_metric_filter.security_events.log_group_name == aws_cloudwatch_log_group.service["auth"].name &&
      aws_cloudwatch_log_metric_filter.security_events.pattern == "{ $.security_event = * }" &&
      aws_cloudwatch_metric_alarm.security_events[0].metric_name == "SecurityEvents" &&
      aws_cloudwatch_metric_alarm.security_events[0].namespace == "Superpower/auth"
    )
    error_message = "auth's security events (a reused refresh token) are counted, with an alarm (AUTH-02)."
  }
  assert {
    condition     = toset(one(aws_s3_bucket_cors_configuration.uploads.cors_rule).allowed_methods) == toset(["POST", "GET"])
    error_message = "Uploads are form POSTs (their policy limits the size), not PUTs (APP-07)."
  }
  assert {
    condition     = length(aws_ecr_repository_policy.promote_pull) == 0
    error_message = "No ecr_pull_account_ids: no repository policy (CI-09)."
  }
  assert {
    condition = one(jsondecode(aws_s3_bucket_policy.uploads.policy).Statement) == {
      Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*"
      Resource  = ["arn:aws:s3:::superpower-uploads-ap-south-1", "arn:aws:s3:::superpower-uploads-ap-south-1/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }
    error_message = "The uploads bucket refuses plain HTTP, and grants nothing (TF-05)."
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
    enable_basic_alarms       = false
    enable_container_insights = false
    ecr_pull_account_ids      = ["222222222222"]
    atlas_project_id          = "" # dev: Atlas M0, the public endpoint
    runtime_sizes = {
      "http"              = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
      "auth"              = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
      "worker"            = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
      "generating-worker" = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
      "collector"         = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 1 }
    }
  }

  assert {
    condition     = one([for x in aws_ecs_cluster.backend.setting : x.value if x.name == "containerInsights"]) == "disabled"
    error_message = "Dev: Container Insights off (enable_container_insights = false)."
  }
  assert {
    condition     = length(module.network.interface_endpoint_ids) == 0 && module.network.nat_gateway_count == 1 && module.network.endpoint_client_security_group_ids == []
    error_message = "Dev: one NAT, no interface endpoints or endpoint rules."
  }
  assert {
    condition     = alltrue([for k, _ in local.services : length([for a, _ in module.service[k].alarm_names : a if startswith(a, "sustained:")]) == 0])
    error_message = "Dev: no sustained alarms."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.outbox_stale) == 0 && length(aws_cloudwatch_metric_alarm.pending_jobs_high) == 0 && length(aws_cloudwatch_metric_alarm.deletion_stuck) == 0
    error_message = "Dev: no job or outbox alarms (enable_all_alarms)."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.valkey) == 0 && length(aws_cloudwatch_metric_alarm.alb_5xx) == 0 && length(aws_cloudwatch_metric_alarm.alb_slow) == 0
    error_message = "Dev: no Valkey or ALB alarms."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.pending_age) + length(aws_cloudwatch_metric_alarm.failed_jobs) + length(aws_cloudwatch_metric_alarm.llm_tokens) + length(aws_cloudwatch_metric_alarm.no_tasks) + length(aws_cloudwatch_metric_alarm.valkey_degraded) + length(aws_cloudwatch_metric_alarm.index_problems) + length(aws_cloudwatch_metric_alarm.security_events) == 0
    error_message = "Dev: no generation, runtime, Valkey-fallback or index alarms."
  }
  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.llm_tokens) == 2 * length(local.generating_services)
    error_message = "Dev still counts LLM tokens (for its own reports)."
  }
  assert {
    condition     = module.redis.node_count == 1
    error_message = "Dev: single Valkey node."
  }
  assert {
    condition     = length(aws_vpc_endpoint.atlas) == 0 && length(mongodbatlas_privatelink_endpoint.atlas) == 0
    error_message = "Dev (M0): no Atlas PrivateLink endpoint (DEC-02)."
  }
  assert {
    condition = keys(aws_ecr_repository_policy.promote_pull) == keys(aws_ecr_repository.service) && alltrue([
      for p in aws_ecr_repository_policy.promote_pull : jsondecode(p.policy).Statement[0].Principal.AWS == ["arn:aws:iam::222222222222:root"]
      && !anytrue([for a in jsondecode(p.policy).Statement[0].Action : contains(["ecr:PutImage", "ecr:InitiateLayerUpload"], a)])
    ])
    error_message = "ecr_pull_account_ids: every service repository grants those accounts pull only (CI-09)."
  }
}

run "tf03_deploys_spot_and_the_connection_budget" {
  command = plan

  assert {
    condition     = local.mongo_peak_connections == 3190 && !contains(keys(local.mongo_peak_tasks), "otel-collector")
    error_message = "Peak Mongo connections: every runtime but the collector at max_capacity, times pool 5 + 6 monitoring (TF-03)."
  }
  assert {
    condition     = local.services["users"].deployment_maximum_percent == 150 && local.services["auth"].deployment_maximum_percent == 150 && local.services["users-worker"].deployment_maximum_percent == 200
    error_message = "A deploy surges 150% where the desired count is 2+, else 200% (one extra task)."
  }
  assert {
    condition = jsonencode(local.services["grow-worker"].capacity_provider_strategy) == jsonencode([
      { base = 1, capacity_provider = "FARGATE", weight = 1 },
      { base = 0, capacity_provider = "FARGATE_SPOT", weight = 3 },
    ]) && length(local.services["users"].capacity_provider_strategy) == 0 && length(local.services["otel-collector"].capacity_provider_strategy) == 0
    error_message = "Workers: one on-demand task, then mostly Spot; HTTP services and the collector on demand only."
  }
  assert {
    condition     = contains(aws_ecs_cluster_capacity_providers.backend.capacity_providers, "FARGATE_SPOT")
    error_message = "The cluster offers FARGATE_SPOT for the workers."
  }
  assert {
    condition     = contains(local.http_environment, { name = "HTTP_KEEP_ALIVE_SECONDS", value = "65" }) && module.alb.idle_timeout_seconds == 60
    error_message = "uvicorn keeps idle connections 5 s longer than the ALB's 60 s idle timeout (TF-03)."
  }
}

run "connections_over_the_budget_fail_the_plan" {
  command = plan

  variables {
    mongodb_connection_budget = 3189
  }

  expect_failures = [aws_ecs_cluster.backend]
}

run "spot_off_runs_workers_on_demand" {
  command = plan

  variables {
    worker_spot = { on_demand_base = 1, spot_weight = 0 }
  }

  assert {
    condition     = length(local.services["grow-worker"].capacity_provider_strategy) == 0
    error_message = "spot_weight 0: workers on demand only, with the FARGATE launch type."
  }
}

run "jwt_public_keys_must_hold_the_signing_key" {
  # Services verify with JWT_PUBLIC_KEYS only — without the current kid's key
  # they would reject every token auth issues.
  command = plan

  variables {
    jwt_public_keys = { "key-v0" = "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----\n" }
  }

  expect_failures = [var.jwt_public_keys]
}

run "runtime_sizes_needs_every_tier" {
  command = plan

  variables {
    runtime_sizes = {
      "http" = { cpu = 256, memory = 512, desired_count = 1, min_capacity = 1, max_capacity = 2 }
    }
  }

  expect_failures = [var.runtime_sizes]
}

# The region allow-list is shared/routing.json's regions (TF-01), the same list the
# workflows check typed regions against.
run "a_region_outside_routing_json_is_refused" {
  command = plan

  variables {
    aws_region = "us-west-2"
  }

  expect_failures = [var.aws_region]
}

# DEC-01 A: prod is served from ap-south-1 only (shared/routing.json served_from).
run "prod_outside_its_served_region_is_refused" {
  command = plan

  variables {
    aws_region = "eu-west-1"
  }

  expect_failures = [var.aws_region]
}

# DEC-02: stg and prod reach Atlas through PrivateLink, made end to end by Terraform.
run "prod_reaches_atlas_through_privatelink" {
  command = apply

  assert {
    condition = (
      mongodbatlas_privatelink_endpoint.atlas[0].region == "ap-south-1"
      && aws_vpc_endpoint.atlas[0].service_name == "com.amazonaws.vpce.ap-south-1.vpce-svc-0123456789abcdef0"
      && aws_vpc_endpoint.atlas[0].vpc_endpoint_type == "Interface"
      && mongodbatlas_privatelink_endpoint_service.atlas[0].provider_name == "AWS"
    )
    error_message = "Atlas's endpoint service, the VPC interface endpoint to it, and Atlas accepting it."
  }
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.atlas_endpoint_from_tasks[0].from_port == 1024
      && aws_vpc_security_group_ingress_rule.atlas_endpoint_from_tasks[0].to_port == 65535
      && aws_vpc_security_group_ingress_rule.atlas_endpoint_from_tasks[0].referenced_security_group_id == aws_security_group.internal_callers.id
    )
    error_message = "The endpoint admits Atlas's ports from the service tasks only."
  }
}

run "prod_without_an_atlas_project_is_refused" {
  command = plan

  variables {
    atlas_project_id = ""
  }

  expect_failures = [var.atlas_project_id]
}

# CI-03: cosign's signature and attestation tags don't count against the 30 kept releases.
run "signatures_have_their_own_lifecycle_rule" {
  command = plan

  assert {
    condition     = [for r in jsondecode(aws_ecr_lifecycle_policy.service["auth"].policy).rules : r.selection.countNumber] == [7, 60, 30] && jsondecode(aws_ecr_lifecycle_policy.service["auth"].policy).rules[1].selection.tagPrefixList == ["sha256-"]
    error_message = "Untagged after 7 days, then the newest 60 sha256-* signature items, then the newest 30 releases."
  }
}
