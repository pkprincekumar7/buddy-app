# ---------------------------------------------------------------------------
# ECS services — THE place to add a backend service (TF-01)
#
# Every entry in local.services gets, from this one map:
#   - an ECS service + task definition, autoscaling and alarms (ecs.tf →
#     ../../modules/ecs-service)
#   - its own task IAM role and policies (iam.tf)
#   - its own security group, reaching the VPC endpoints (security_groups.tf)
#   - its own log group /ecs/<app>/<key>/<env> (cloudwatch.tf)
#   - an entry in the ecs_services SSM parameter, which is how the deploy,
#     restart and promote workflows find it (ssm_write.tf) — no workflow edits
#
# To add a service: copy the worker entry, give it a new key (lowercase,
# hyphens — it's the name you pass to the workflows' `service` input), set
# its container, sizing, permissions and scaling, add its key to the service
# list in the `service` input description of deploy-, restart- and
# promote-live-backend.yml (scripts/check-service-lists.sh checks it), apply
# terraform-live-backend, then deploy.
#
# HTTP services (`http` set) each get their own ALB target group and listener
# rule (../../modules/alb). One of them leaves path_patterns empty: the
# catch-all (backend). Any other lists the ALB path patterns it owns and a
# unique rule priority (lower is matched first). CloudFront and Lambda@Edge
# need no change — they forward /api/* to the ALB, which splits by path.
#
# All services run the same image (the backend ECR repo); `command` picks the
# entry point and APP_COMPONENT which routers it serves (backend/app/main.py).
# deploy_order is the order services are listed in (the ecs_services SSM
# list, the workflows' `service` help text). Deploy, promote and restart roll
# all selected services out in parallel, so it isn't a rollout order: every
# service must work against the previous image of the others while a deploy
# is in flight (e.g. no API change the old worker can't handle).
#
# Only auth holds JWT_PRIVATE_KEY and mints tokens. Admin and the API verify
# with JWT_PUBLIC_KEYS only, and the worker needs neither.
#
# Optional name overrides (iam_name, security_group) exist only so the two
# original services keep their AWS names; new services should leave them
# unset and get <app>-<key>-task-role-…, <app>-<key>-sg-… etc.
# ---------------------------------------------------------------------------

locals {
  # Env vars every token-verifying service (auth, admin, backend) shares.
  jwt_environment = [
    { name = "JWT_KEY_ID", value = var.jwt_key_id },
    # kid → public key map for verification (APP-02). The API verifies with
    # these keys only, so it must include jwt_key_id's (variables.tf checks).
    { name = "JWT_PUBLIC_KEYS", value = jsonencode(var.jwt_public_keys) },
    # iss / aud stamped on and required of every token (EDGE-04). Must equal
    # the jwt_issuer / jwt_audience infra-live-edge builds the Lambda@Edge
    # validator with (lambda_edge.tf) — same expressions.
    { name = "JWT_ISSUER", value = "${var.app_name}-${var.environment}" },
    { name = "JWT_AUDIENCE", value = "${var.app_name}-api" },
  ]
}

locals {
  services = {
    # -- Auth: register, login, Google, refresh, logout, me, account deletion --
    # The only service with JWT_PRIVATE_KEY. Account deletion stays here, on
    # the shared database (it removes the user's data from every collection).
    auth = {
      display_name = "Auth"
      scaling_name = "auth"
      deploy_order = 1

      # Keep in step with ALB_PATH_PATTERNS["auth"] in backend/tests/test_main.py,
      # which checks these against the auth router's real routes. /user/me is
      # exact, so /api/v1/user/<anything else> stays on the API.
      http = {
        port                              = 8000
        health_check_grace_period_seconds = 90
        path_patterns                     = ["/api/v1/auth/*", "/api/v1/user/me"]
        priority                          = 10
      }
      uses_redis = true # rate limits on login / register

      cpu           = var.auth_task_cpu
      memory        = var.auth_task_memory
      desired_count = var.auth_desired_count
      min_capacity  = var.auth_min_capacity
      max_capacity  = var.auth_max_capacity

      command = null
      environment = concat([
        { name = "APP_COMPONENT", value = "auth" },
        { name = "MONGODB_DB_NAME", value = var.mongodb_db_name },
        { name = "COOKIE_SECURE", value = "true" },
        { name = "COOKIE_SAMESITE", value = "lax" },
        { name = "BEHIND_PROXY", value = "true" },
        { name = "APP_ENV", value = var.environment },
        { name = "REDIS_URL", value = "rediss://${module.redis.primary_endpoint_address}:6379" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "CORS_ORIGINS", value = var.cors_origins },
        { name = "COOKIE_DOMAIN", value = var.cookie_domain },
      ], local.jwt_environment)
      secret_keys = ["MONGODB_URI", "JWT_PRIVATE_KEY", "GOOGLE_CLIENT_ID", "REDIS_AUTH_TOKEN"]

      health_check = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # No AWS access beyond what every service gets (logs, ECS Exec, X-Ray).
      task_policies = {}

      target_tracking_policies = {
        cpu    = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_in_cooldown = 300, scale_out_cooldown = 60 }
        memory = { metric_type = "ECSServiceAverageMemoryUtilization", target_value = 70, scale_in_cooldown = 300, scale_out_cooldown = 60 }
      }
      step_scaling_policies = {}

      sustained_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
      immediate_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    }

    # -- Admin: /api/v1/admin/* (allow-list, user lookup, lock / unlock) -------
    # Verifies tokens with JWT_PUBLIC_KEYS only; get_current_admin checks the
    # role. Touches only users, email_index and allowed_emails on the shared
    # database. Little traffic, so small; scales on CPU and memory like auth.
    admin = {
      display_name = "Admin"
      scaling_name = "admin"
      deploy_order = 2

      # Keep in step with ALB_PATH_PATTERNS in backend/tests/test_main.py.
      http = {
        port                              = 8000
        health_check_grace_period_seconds = 90
        path_patterns                     = ["/api/v1/admin/*"]
        priority                          = 20
      }
      uses_redis = true # rate limits on the admin endpoints

      cpu           = var.admin_task_cpu
      memory        = var.admin_task_memory
      desired_count = var.admin_desired_count
      min_capacity  = var.admin_min_capacity
      max_capacity  = var.admin_max_capacity

      command = null
      environment = concat([
        { name = "APP_COMPONENT", value = "admin" },
        { name = "MONGODB_DB_NAME", value = var.mongodb_db_name },
        { name = "BEHIND_PROXY", value = "true" },
        { name = "APP_ENV", value = var.environment },
        { name = "REDIS_URL", value = "rediss://${module.redis.primary_endpoint_address}:6379" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "CORS_ORIGINS", value = var.cors_origins },
      ], local.jwt_environment)
      secret_keys = ["MONGODB_URI", "REDIS_AUTH_TOKEN"]

      health_check = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # No AWS access beyond what every service gets (logs, ECS Exec, X-Ray).
      task_policies = {}

      target_tracking_policies = {
        cpu    = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_in_cooldown = 300, scale_out_cooldown = 60 }
        memory = { metric_type = "ECSServiceAverageMemoryUtilization", target_value = 70, scale_in_cooldown = 300, scale_out_cooldown = 60 }
      }
      step_scaling_policies = {}

      sustained_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
      immediate_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    }

    # -- API: everything else under /api/v1 (the ALB's catch-all) -------------
    backend = {
      display_name = "API"
      scaling_name = "api"
      deploy_order = 3
      iam_name     = "ecs-task"
      security_group = {
        name        = "ecs-task-sg"
        description = "Allow port 8000 from ALB; unrestricted egress via NAT (stg/prod: AWS services via VPC endpoints)"
      }

      # No path_patterns: the catch-all for every request no other service claims.
      http       = { port = 8000, health_check_grace_period_seconds = 90, path_patterns = [], priority = null }
      uses_redis = true

      cpu           = var.task_cpu
      memory        = var.task_memory
      desired_count = var.desired_count
      min_capacity  = var.api_min_capacity
      max_capacity  = var.api_max_capacity

      command = null
      environment = concat([
        # Verifies tokens with JWT_PUBLIC_KEYS only — no JWT_PRIVATE_KEY here.
        { name = "APP_COMPONENT", value = "api" },
        { name = "MONGODB_DB_NAME", value = var.mongodb_db_name },
        { name = "OPENAI_MODEL", value = var.openai_model },
        { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
        { name = "GEMINI_MODEL", value = var.gemini_model },
        { name = "COOKIE_SECURE", value = "true" },
        { name = "COOKIE_SAMESITE", value = "lax" },
        { name = "BEHIND_PROXY", value = "true" },
        { name = "APP_ENV", value = var.environment },
        { name = "REDIS_URL", value = "rediss://${module.redis.primary_endpoint_address}:6379" },
        { name = "LLM_TIMEOUT_SECONDS", value = tostring(var.llm_timeout_seconds) },
        { name = "LLM_HOURLY_LIMIT", value = tostring(var.llm_hourly_limit) },
        { name = "ASSETS_BUCKET_NAME", value = var.assets_bucket_name },
        { name = "UPLOADS_BUCKET_NAME", value = var.uploads_bucket_name },
        { name = "AWS_REGION", value = var.aws_region },
        # Lifetime of the S3 presigned GET URLs the API returns for photos (EDGE-05).
        { name = "UPLOADS_URL_TTL_SECONDS", value = tostring(var.uploads_url_ttl_seconds) },
        { name = "CORS_ORIGINS", value = var.cors_origins },
        { name = "COOKIE_DOMAIN", value = var.cookie_domain },
      ], local.jwt_environment)
      # Keys of the backend-secrets JSON injected as env vars.
      secret_keys = ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "REDIS_AUTH_TOKEN"]

      health_check = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # Task role policies: name part → policy document. Role policy names are
      # <app>-<iam_name>-<key>-<env>-<region>. ECS Exec and X-Ray policies are
      # added to every service automatically when those features are on.
      task_policies = {
        s3 = {
          Version = "2012-10-17"
          Statement = [
            { Effect = "Allow", Action = ["s3:ListBucket"], Resource = ["arn:aws:s3:::${var.assets_bucket_name}"] },
            { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = ["arn:aws:s3:::${var.assets_bucket_name}/*"] },
          ]
        }
        # Presigned PUT (upload) and GET (view, EDGE-05) URLs for the uploads
        # bucket. A presigned URL carries the signer's permissions, so the role
        # itself must be able to read. GetBucketLocation is needed by some SDK
        # versions to resolve the bucket endpoint when signing.
        s3-uploads = {
          Version = "2012-10-17"
          Statement = [
            { Effect = "Allow", Action = ["s3:GetBucketLocation"], Resource = "arn:aws:s3:::${var.uploads_bucket_name}" },
            { Effect = "Allow", Action = ["s3:PutObject"], Resource = "arn:aws:s3:::${var.uploads_bucket_name}/*" },
            { Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::${var.uploads_bucket_name}/uploads/*" },
          ]
        }
      }

      # Scale-out on whichever fires first, scale-in only when all are below
      # target: cpu (compute-bound), memory (large payloads / leaks),
      # alb-requests (most proactive — fires on a throughput spike before CPU
      # or memory rise; target is requests per task per minute). ecs.tf fills
      # in an ALBRequestCountPerTarget policy's resource_label with this
      # service's own target group.
      target_tracking_policies = {
        cpu    = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_in_cooldown = 300, scale_out_cooldown = 60 }
        memory = { metric_type = "ECSServiceAverageMemoryUtilization", target_value = 70, scale_in_cooldown = 300, scale_out_cooldown = 60 }
        alb-requests = {
          metric_type        = "ALBRequestCountPerTarget"
          target_value       = 1000
          scale_in_cooldown  = 300
          scale_out_cooldown = 60
        }
      }
      step_scaling_policies = {}

      sustained_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
      immediate_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    }

    # -- Worker: async LLM jobs, no endpoints ----------------------------------
    worker = {
      display_name   = "Worker"
      scaling_name   = "worker"
      deploy_order   = 4
      iam_name       = "worker-task"
      security_group = { name = "worker-sg", description = "Worker: no inbound, unrestricted egress for LLM APIs and MongoDB" }

      http       = null
      uses_redis = false # rate limiting is API-side

      cpu           = var.worker_task_cpu
      memory        = var.worker_task_memory
      desired_count = var.worker_desired_count
      min_capacity  = var.worker_min_capacity
      max_capacity  = var.worker_max_capacity

      command = ["python", "worker.py"]
      environment = [
        # Neither mints nor verifies tokens — no JWT keys at all.
        { name = "APP_COMPONENT", value = "worker" },
        { name = "MONGODB_DB_NAME", value = var.mongodb_db_name },
        { name = "OPENAI_MODEL", value = var.openai_model },
        { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
        { name = "GEMINI_MODEL", value = var.gemini_model },
        { name = "APP_ENV", value = var.environment },
        { name = "LLM_TIMEOUT_SECONDS", value = tostring(var.llm_timeout_seconds) },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "WORKER_CONCURRENCY", value = tostring(var.worker_concurrency) },
        { name = "WORKER_POLL_INTERVAL_SECONDS", value = tostring(var.worker_poll_interval_seconds) },
        # Each regional worker only processes its own region's locations (see worker.py)
        { name = "WORKER_SCOPE_TO_REGION", value = "true" },
      ]
      secret_keys  = ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
      health_check = null

      task_policies = {
        # PendingJobCount emission. PutMetricData needs Resource = "*" (no
        # resource-level ARNs), but the cloudwatch:namespace condition IS
        # enforced for it — the only thing stopping the worker writing to
        # arbitrary namespaces. Don't remove it as "ineffective".
        cloudwatch = {
          Version = "2012-10-17"
          Statement = [{
            Effect    = "Allow"
            Action    = ["cloudwatch:PutMetricData"]
            Resource  = "*"
            Condition = { StringEquals = { "cloudwatch:namespace" = "Superpower/Worker" } }
          }]
        }
      }

      # Scaling on queue depth, not CPU: workers spend most time in LLM I/O
      # wait, so CPU is unreliable for them.
      #   cpu          — scale-in disabled: a floor that stops scale-in while
      #                  workers are genuinely busy
      #   pending-jobs — step scale-out on PendingJobCount > 50 (bounds are
      #                  relative to it: 50–100 → +2, 100–150 → +4, >150 → +6)
      #   scale-in     — −1 task per 5 minutes once PendingJobCount ≤ 10 for 5
      #                  minutes; one at a time so mid-job workers aren't all killed
      # treat_missing_data = notBreaching on both alarms: no data = empty queue,
      # and during the ~60 s start-up no metric exists yet — treating that as
      # breaching would scale in before the first job, causing a restart loop.
      target_tracking_policies = {
        cpu = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_out_cooldown = 60, disable_scale_in = true }
      }
      step_scaling_policies = {
        pending-jobs = {
          adjustment_type         = "ChangeInCapacity"
          cooldown                = 60
          metric_aggregation_type = "Average"
          steps = [
            { lower_bound = 0, upper_bound = 50, adjustment = 2 },
            { lower_bound = 50, upper_bound = 100, adjustment = 4 },
            { lower_bound = 100, adjustment = 6 },
          ]
          alarm = {
            metric_name = "PendingJobCount", namespace = "Superpower/Worker", statistic = "Average", period = 60, evaluation_periods = 1
            threshold   = 50, comparison_operator = "GreaterThanThreshold", treat_missing_data = "notBreaching", dimensions = { Environment = var.environment }
          }
        }
        scale-in = {
          adjustment_type         = "ChangeInCapacity"
          cooldown                = 300
          metric_aggregation_type = "Average"
          steps                   = [{ upper_bound = 0, adjustment = -1 }]
          alarm = {
            name_suffix        = "pending-jobs-low", metric_name = "PendingJobCount", namespace = "Superpower/Worker", statistic = "Average", period = 60
            evaluation_periods = 5, threshold = 10, comparison_operator = "LessThanOrEqualToThreshold", treat_missing_data = "notBreaching", dimensions = { Environment = var.environment }
          }
        }
      }

      sustained_alarms = { cpu = "CPUUtilization" }
      immediate_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    }
  }

  # -- Derived ------------------------------------------------------------------

  # Per-service names, applying the optional overrides above.
  service_iam_name = { for k, s in local.services : k => coalesce(try(s.iam_name, null), "${k}-task") }

  # Services behind the ALB, each with its own target group and rule.
  http_services = { for k, s in local.services : k => s if s.http != null }

  # What the deploy / restart / promote workflows read from SSM, in rollout
  # order. container = the container whose image a deploy replaces.
  ecs_services_manifest = [
    for k in sort([for k, s in local.services : format("%03d-%s", s.deploy_order, k)]) : {
      name      = substr(k, 4, -1)
      service   = module.service[substr(k, 4, -1)].service_name
      family    = module.service[substr(k, 4, -1)].task_definition_family
      container = substr(k, 4, -1)
    }
  ]
}
