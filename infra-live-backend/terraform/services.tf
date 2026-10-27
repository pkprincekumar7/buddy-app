# ---------------------------------------------------------------------------
# ECS runtimes — THE place to add a backend service (docs/auth-users-split.md, 15.2)
#
# The split's services: each has an HTTP runtime (public API on 8000, internal
# API on 8001 through Cloud Map) and, except shared, a worker (outbox relay,
# event consumer, and for the generating circles the LLM job worker). Plus the
# shared OpenTelemetry collector (15.5). 17 runtimes + 1 collector.
#
# From local.services, every runtime gets:
#   - an ECS service + task definition, autoscaling and alarms (ecs.tf →
#     ../../modules/ecs-service), registered in Cloud Map when it serves
#     internal endpoints;
#   - its own execution and task roles (iam.tf): its execution role reads only
#     its service's secret and signing key; its task role has only its own AWS
#     access (15.1);
#   - its own security group (security_groups.tf) and log group;
#   - an entry in the ecs_services SSM parameter, with its service's ECR
#     repository, which is how the deploy / restart / promote workflows find it.
#
# A service and its worker share one image, one ECR repository, one secret, one
# service-token key and one Valkey user (section 2): the image's CMD runs the HTTP
# apps (python -m common.serve <service>); the worker overrides the command.
#
# HTTP routing comes from shared/service-routes.json (alb.tf), the same file the
# local gateway uses. Topics and queues come from the event catalogue
# (events.tf → ../../modules/events).
#
# To add a service: add it to local.split_services (and generating_services if it
# runs LLM jobs), give it its env and permissions below, add its routes to
# shared/service-routes.json and its events to the catalogue, and list it in the
# workflows' `service` help text (scripts/check-service-lists.sh checks it).
# ---------------------------------------------------------------------------

locals {
  # Order is deploy order (the ecs_services list and the workflows' help text).
  split_services      = ["auth", "users", "children", "onboarding", "discover", "grow", "transform", "release", "shared"]
  generating_services = ["discover", "grow", "transform", "release"]
  # Services whose /internal/* API others call (13.2); shared has none.
  internal_services = [for s in local.split_services : s if s != "shared"]
  # Services with a worker (outbox relay, consumer); shared has no database.
  worker_services = [for s in local.split_services : s if s != "shared"]

  internal_dns_namespace = "${var.app_name}-${var.environment}.internal"

  # Runtime key → its service and kind.
  runtime_kinds = merge(
    { for s in local.split_services : s => { service = s, kind = "http" } },
    { for s in local.worker_services : "${s}-worker" => { service = s, kind = "worker" } },
    { "otel-collector" = { service = null, kind = "collector" } },
  )

  # Which runtime_sizes tier a runtime uses.
  runtime_tier = {
    for k, r in local.runtime_kinds : k => (
      r.kind == "collector" ? "collector" :
      r.kind == "http" ? (r.service == "auth" ? "auth" : "http") :
      contains(local.generating_services, r.service) ? "generating-worker" : "worker"
    )
  }

  # -- Environment ----------------------------------------------------------------

  # Every service runtime (not the collector).
  base_environment = {
    for s in local.split_services : s => [
      { name = "SERVICE_NAME", value = s },
      { name = "APP_NAME", value = var.app_name },
      { name = "APP_ENV", value = var.environment },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "MONGODB_DB_NAME", value = s },
      { name = "MONGODB_MAX_POOL_SIZE", value = tostring(var.mongodb_max_pool_size) },
      # IAM authentication (9.3): the client signs in as this user with a token from its task role.
      { name = "REDIS_URL", value = "rediss://${module.redis.primary_endpoint_address}:6379" },
      { name = "REDIS_USERNAME", value = module.redis.rbac_user_names[s] },
      # What the IAM token is signed for (common.valkey).
      { name = "REDIS_REPLICATION_GROUP_ID", value = module.redis.replication_group_id },
      { name = "INTERNAL_DNS_SUFFIX", value = local.internal_dns_namespace },
      { name = "INTERNAL_SIGNING_KID", value = local.signing_kid[s] },
      { name = "INTERNAL_PUBLIC_KEYS", value = jsonencode(local.internal_public_keys) },
      { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = "http://otel-collector.${local.internal_dns_namespace}:4318" },
      { name = "LOG_LEVEL", value = "INFO" },
    ]
  }

  # Token verification (9.2): every HTTP service and worker that checks users.
  jwt_environment = [
    { name = "JWT_KEY_ID", value = var.jwt_key_id },
    { name = "JWT_PUBLIC_KEYS", value = jsonencode(var.jwt_public_keys) },
    # Must equal what infra-live-edge builds the Lambda@Edge validator with.
    { name = "JWT_ISSUER", value = "${var.app_name}-${var.environment}" },
    { name = "JWT_AUDIENCE", value = "${var.app_name}-api" },
  ]

  http_environment = [
    { name = "BEHIND_PROXY", value = "true" },
    { name = "CORS_ORIGINS", value = var.cors_origins },
  ]

  llm_environment = [
    { name = "OPENAI_MODEL", value = var.openai_model },
    { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
    { name = "GEMINI_MODEL", value = var.gemini_model },
    { name = "LLM_TIMEOUT_SECONDS", value = tostring(var.llm_timeout_seconds) },
    { name = "LLM_HOURLY_LIMIT", value = tostring(var.llm_hourly_limit) },
  ]

  uploads_environment = [
    { name = "UPLOADS_BUCKET_NAME", value = var.uploads_bucket_name },
    { name = "UPLOADS_URL_TTL_SECONDS", value = tostring(var.uploads_url_ttl_seconds) },
  ]

  # Who must confirm an account deletion (10.3): all seven of common.deletion.PARTICIPANTS,
  # now that each is built (build plan 3.5, 5.5).
  deletion_participants = ["users", "children", "onboarding", "discover", "grow", "transform", "release"]
  deletion_environment  = [{ name = "DELETION_PARTICIPANTS", value = join(",", local.deletion_participants) }]

  # Per service, extra environment for its HTTP runtime and its worker.
  service_http_environment = {
    auth = concat([
      { name = "COOKIE_SECURE", value = "true" },
      { name = "COOKIE_SAMESITE", value = "lax" },
      { name = "COOKIE_DOMAIN", value = var.cookie_domain },
    ], local.deletion_environment)
    children  = local.uploads_environment
    transform = local.uploads_environment
    shared    = [{ name = "ASSETS_BUCKET_NAME", value = var.assets_bucket_name }]
  }
  service_worker_environment = {
    auth      = local.deletion_environment
    children  = local.uploads_environment
    transform = local.uploads_environment
  }

  # -- Secrets (one per service, 15.1) ---------------------------------------------

  # Keys of each service's secret JSON. LLM keys are injected only into the
  # generating workers and shared (speech-to-text) (8).
  secret_keys = {
    auth       = ["MONGODB_URI", "JWT_PRIVATE_KEY", "GOOGLE_CLIENT_ID", "EMAIL_HMAC_PEPPER"]
    users      = ["MONGODB_URI"]
    children   = ["MONGODB_URI"]
    onboarding = ["MONGODB_URI"]
    discover   = ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
    grow       = ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
    transform  = ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
    release    = ["MONGODB_URI", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
    shared     = ["OPENAI_API_KEY"]
  }
  llm_keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]

  runtime_secret_keys = {
    for k, r in local.runtime_kinds : k => (
      r.kind == "collector" ? [] :
      r.kind == "worker" ? local.secret_keys[r.service] :
      # A generating circle's HTTP runtime starts jobs but never calls an LLM.
      contains(local.generating_services, r.service) ? [for key in local.secret_keys[r.service] : key if !contains(local.llm_keys, key)] :
      local.secret_keys[r.service]
    )
  }

  # -- Permissions (15.1) -----------------------------------------------------------

  # S3 prefixes per service: they never overlap, so neither can touch the other's.
  uploads_prefix = {
    children  = "uploads/*/*/avatar/*"
    transform = "uploads/*/*/ninety-day-plan/*"
  }

  uploads_policy = {
    for s, prefix in local.uploads_prefix : s => {
      Version = "2012-10-17"
      Statement = [
        { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "arn:aws:s3:::${var.uploads_bucket_name}/${prefix}" },
        # HeadObject needs GetObject; listing is for deleting a child's objects (10.2).
        { Effect = "Allow", Action = ["s3:ListBucket"], Resource = "arn:aws:s3:::${var.uploads_bucket_name}", Condition = { StringLike = { "s3:prefix" = [prefix] } } },
        { Effect = "Allow", Action = ["s3:GetBucketLocation"], Resource = "arn:aws:s3:::${var.uploads_bucket_name}" },
      ]
    }
  }

  # Alarm and scaling metrics, each service in its own namespace (15.5). The
  # condition is the only thing limiting PutMetricData, which takes no resource.
  metrics_policy = {
    for s in local.split_services : s => {
      Version = "2012-10-17"
      Statement = [{
        Effect    = "Allow"
        Action    = ["cloudwatch:PutMetricData"]
        Resource  = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = "Superpower/${s}" } }
      }]
    }
  }

  # Valkey as the service's own RBAC user (9.3, build plan 2.3).
  valkey_policy = {
    for s in local.split_services : s => {
      Version = "2012-10-17"
      Statement = [{
        Effect   = "Allow"
        Action   = ["elasticache:Connect"]
        Resource = [module.redis.replication_group_arn, module.redis.rbac_user_arns[s]]
      }]
    }
  }

  # A worker relays to its own topic and consumes its own queue (7.2).
  events_policy = {
    for s in local.worker_services : s => {
      Version = "2012-10-17"
      Statement = concat(
        contains(keys(module.events.topic_arns), s) ? [
          { Effect = "Allow", Action = ["sns:Publish"], Resource = module.events.topic_arns[s] },
          { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = module.events.key_arn },
        ] : [],
        contains(keys(module.events.queue_arns), s) ? [
          { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], Resource = module.events.queue_arns[s] },
        ] : [],
      )
    }
  }

  task_policies = {
    for k, r in local.runtime_kinds : k => merge(
      r.kind == "collector" ? {
        xray = {
          Version = "2012-10-17"
          Statement = [{
            Effect   = "Allow"
            Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
            Resource = "*"
          }]
        }
      } : {},
      r.kind != "collector" ? { valkey = local.valkey_policy[r.service] } : {},
      r.kind != "collector" && r.service != "shared" ? { metrics = local.metrics_policy[r.service] } : {},
      contains(keys(local.uploads_policy), coalesce(r.service, "-")) ? { s3-uploads = local.uploads_policy[r.service] } : {},
      r.kind == "worker" ? { events = local.events_policy[r.service] } : {},
      r.service == "shared" ? {
        # The APK download link (13.3): the assets bucket's Android prefix only.
        s3-apk = {
          Version = "2012-10-17"
          Statement = [
            { Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::${var.assets_bucket_name}/app-assets/applications/android/*" },
            { Effect = "Allow", Action = ["s3:ListBucket"], Resource = "arn:aws:s3:::${var.assets_bucket_name}", Condition = { StringLike = { "s3:prefix" = ["app-assets/applications/android/*"] } } },
          ]
        }
      } : {},
    )
  }

  # -- Scaling (15.5) ---------------------------------------------------------------

  http_scaling = {
    cpu    = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_in_cooldown = 300, scale_out_cooldown = 60 }
    memory = { metric_type = "ECSServiceAverageMemoryUtilization", target_value = 70, scale_in_cooldown = 300, scale_out_cooldown = 60 }
    alb-requests = {
      metric_type        = "ALBRequestCountPerTarget"
      target_value       = 1000
      scale_in_cooldown  = 300
      scale_out_cooldown = 60
    }
  }

  # Workers spend most of their time waiting on I/O, so they scale on the work
  # waiting, not on CPU: queue depth for every worker, and PendingJobCount for the
  # generating ones. Missing data means "nothing to do" (an idle queue stops
  # reporting, 15.5).
  queue_step_scaling = {
    for s in local.worker_services : s => {
      queue-depth = {
        adjustment_type         = "ChangeInCapacity"
        cooldown                = 60
        metric_aggregation_type = "Average"
        steps = [
          { lower_bound = 0, upper_bound = 100, adjustment = 1 },
          { lower_bound = 100, adjustment = 3 },
        ]
        alarm = {
          metric_name = "ApproximateNumberOfMessagesVisible", namespace = "AWS/SQS", statistic = "Maximum", period = 60, evaluation_periods = 2
          threshold   = 100, comparison_operator = "GreaterThanThreshold", treat_missing_data = "notBreaching"
          dimensions  = { QueueName = "${var.app_name}-${var.environment}-${s}-events" }
        }
      }
      queue-low = {
        adjustment_type         = "ChangeInCapacity"
        cooldown                = 300
        metric_aggregation_type = "Average"
        steps                   = [{ upper_bound = 0, adjustment = -1 }]
        alarm = {
          name_suffix        = "queue-depth-low", metric_name = "ApproximateNumberOfMessagesVisible", namespace = "AWS/SQS", statistic = "Maximum", period = 60
          evaluation_periods = 5, threshold = 10, comparison_operator = "LessThanOrEqualToThreshold", treat_missing_data = "notBreaching"
          dimensions         = { QueueName = "${var.app_name}-${var.environment}-${s}-events" }
        }
      }
    }
  }

  pending_jobs_scaling = {
    for s in local.generating_services : s => {
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
          metric_name = "PendingJobCount", namespace = "Superpower/${s}", statistic = "Maximum", period = 60, evaluation_periods = 1
          threshold   = 50, comparison_operator = "GreaterThanThreshold", treat_missing_data = "notBreaching", dimensions = { Environment = var.environment }
        }
      }
    }
  }

  # Keyed by runtime ("<service>-worker"); other runtimes have no step scaling.
  worker_step_scaling = {
    for s in local.worker_services : "${s}-worker" => merge(local.queue_step_scaling[s], lookup(local.pending_jobs_scaling, s, {}))
  }

  target_tracking_by_kind = {
    http = local.http_scaling
    collector = {
      cpu = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_in_cooldown = 300, scale_out_cooldown = 60 }
    }
    # A floor: no scale-in while the worker is busy, whatever the queue says.
    worker = {
      cpu = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_out_cooldown = 60, disable_scale_in = true }
    }
  }

  # -- The runtimes ------------------------------------------------------------------

  services = {
    for k, r in local.runtime_kinds : k => {
      service      = r.service
      kind         = r.kind
      display_name = r.kind == "collector" ? "OpenTelemetry collector" : (r.kind == "worker" ? "${title(r.service)} worker" : title(r.service))
      scaling_name = k
      deploy_order = r.kind == "collector" ? 1 : 2 + index(local.split_services, r.service) * 2 + (r.kind == "worker" ? 1 : 0)

      http = r.kind == "http" ? { port = 8000, health_check_grace_period_seconds = 90 } : null
      # Registered in Cloud Map: the internal API (8001) or the collector's OTLP (4318).
      internal_port = r.kind == "collector" ? 4318 : (r.kind == "http" && contains(local.internal_services, r.service) ? 8001 : null)
      uses_valkey   = r.kind != "collector"

      cpu           = var.runtime_sizes[local.runtime_tier[k]].cpu
      memory        = var.runtime_sizes[local.runtime_tier[k]].memory
      desired_count = var.runtime_sizes[local.runtime_tier[k]].desired_count
      min_capacity  = var.runtime_sizes[local.runtime_tier[k]].min_capacity
      max_capacity  = var.runtime_sizes[local.runtime_tier[k]].max_capacity

      image   = r.kind == "collector" ? var.otel_collector_image : null # null: the service's ECR repository
      command = r.kind == "worker" ? ["python", "-m", "${r.service}.worker"] : null

      environment = r.kind == "collector" ? [
        { name = "AOT_CONFIG_CONTENT", value = local.otel_collector_config },
        ] : concat(
        local.base_environment[r.service],
        local.jwt_environment,
        r.kind == "http" ? local.http_environment : [],
        r.kind == "http" ? lookup(local.service_http_environment, r.service, []) : lookup(local.service_worker_environment, r.service, []),
        contains(local.generating_services, r.service) ? local.llm_environment : [],
        r.kind == "worker" && contains(keys(module.events.topic_arns), r.service) ? [{ name = "EVENTS_TOPIC_ARN", value = module.events.topic_arns[r.service] }] : [],
        r.kind == "worker" && contains(keys(module.events.queue_urls), r.service) ? [{ name = "EVENTS_QUEUE_URL", value = module.events.queue_urls[r.service] }] : [],
      )
      secret_keys = local.runtime_secret_keys[k]

      health_check = r.kind == "http" ? {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
        } : r.kind == "collector" ? {
        command     = ["CMD", "/healthcheck"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      } : null

      task_policies = local.task_policies[k]

      # try(): each kind's policy set is a differently shaped object.
      target_tracking_policies = try(local.target_tracking_by_kind[r.kind], {})
      step_scaling_policies    = try(local.worker_step_scaling[k], {})

      sustained_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
      immediate_alarms = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    }
  }

  # -- Derived --------------------------------------------------------------------

  http_services = { for k, s in local.services : k => s if s.http != null }

  # What the deploy / restart / promote workflows read from SSM, in deploy order.
  # ecr_repository_url is the service's repository (a worker shares its service's);
  # empty for the collector, which runs a public image.
  ecs_services_manifest = [
    for k in sort([for k, s in local.services : format("%03d-%s", s.deploy_order, k)]) : {
      name               = substr(k, 4, -1)
      service            = module.service[substr(k, 4, -1)].service_name
      family             = module.service[substr(k, 4, -1)].task_definition_family
      container          = substr(k, 4, -1)
      image_service      = local.services[substr(k, 4, -1)].service != null ? local.services[substr(k, 4, -1)].service : ""
      ecr_repository_url = local.services[substr(k, 4, -1)].service != null ? aws_ecr_repository.service[local.services[substr(k, 4, -1)].service].repository_url : ""
    }
  ]
}
