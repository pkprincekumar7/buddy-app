# ---------------------------------------------------------------------------
# ECS — Fargate cluster, task definition, service
#
# Tasks run in PRIVATE subnets with assign_public_ip = false. Outbound
# internet access goes via NAT Gateway. In stg/prod, AWS service traffic
# (ECR, Secrets Manager, CloudWatch Logs, X-Ray) routes via VPC Interface
# Endpoints and never reaches NAT. In dev/sbx (no Interface Endpoints),
# all outbound traffic including AWS service calls traverses NAT.
# Tasks have no public IP and are not internet-reachable.
#
# Task definition uses :latest as the initial image. The deploy workflow
# (deploy-live-backend.yml) manages image updates; Terraform is not involved
# after the initial apply (ignore_changes = [task_definition, desired_count]).
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "backend" {
  name = "${var.app_name}-backend-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.app_name}-backend-cluster-${var.environment}"
  }
}

resource "aws_ecs_cluster_capacity_providers" "backend" {
  cluster_name       = aws_ecs_cluster.backend.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.app_name}-backend-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]

      # Non-sensitive config — embedded directly in the task definition.
      environment = [
        { name = "MONGODB_DB_NAME", value = var.mongodb_db_name },
        { name = "OPENAI_MODEL", value = var.openai_model },
        { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
        { name = "GEMINI_MODEL", value = var.gemini_model },
        { name = "COOKIE_SECURE", value = "true" },
        { name = "COOKIE_SAMESITE", value = "lax" },
        { name = "BEHIND_PROXY", value = "true" },
        { name = "APP_ENV", value = var.environment },
        { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379" },
        { name = "LLM_TIMEOUT_SECONDS", value = tostring(var.llm_timeout_seconds) },
        { name = "LLM_HOURLY_LIMIT", value = tostring(var.llm_hourly_limit) },
        { name = "DEFAULT_LOCATION", value = var.default_location },
        { name = "DEFAULT_REGION", value = var.default_region },
        { name = "ASSETS_BUCKET_NAME", value = var.assets_bucket_name },
        { name = "JWT_KEY_ID", value = var.jwt_key_id },
        { name = "CORS_ORIGINS", value = var.cors_origins },
        { name = "COOKIE_DOMAIN", value = var.cookie_domain },
      ]

      # Sensitive values — injected by the ECS agent from Secrets Manager.
      # Format: "<secret_arn>:<json_key>::"
      secrets = [
        { name = "MONGODB_URI", valueFrom = "${aws_secretsmanager_secret.app.arn}:MONGODB_URI::" },
        { name = "JWT_PRIVATE_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_PRIVATE_KEY::" },
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.app.arn}:GOOGLE_CLIENT_ID::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:OPENAI_API_KEY::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:ANTHROPIC_API_KEY::" },
        { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:GEMINI_API_KEY::" },
        { name = "REDIS_AUTH_TOKEN", valueFrom = "${aws_secretsmanager_secret.app.arn}:REDIS_AUTH_TOKEN::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "backend"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${var.app_name}-backend-task-${var.environment}"
  }
}

resource "aws_ecs_service" "backend" {
  name            = "${var.app_name}-backend-${var.environment}"
  cluster         = aws_ecs_cluster.backend.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = var.enable_execute_command

  network_configuration {
    subnets = [
      aws_subnet.private_1.id,
      aws_subnet.private_2.id,
      aws_subnet.private_3.id,
    ]
    security_groups  = [aws_security_group.ecs_task_sg.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 8000
  }

  health_check_grace_period_seconds = 90

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  depends_on = [aws_lb_listener.https]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = {
    Name = "${var.app_name}-backend-service-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# Worker ECS task definition + service
#
# Uses the same ECR image as the API service. The `command` override runs
# worker.py instead of uvicorn. No port mappings — the worker exposes no
# endpoints. Managed by deploy-live-backend.yml (ignore_changes on
# task_definition so Terraform does not overwrite workflow-pinned revisions).
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.app_name}-worker-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_task_cpu
  memory                   = var.worker_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.worker_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true
      command   = ["python", "worker.py"]

      # No portMappings — worker has no HTTP endpoints

      environment = [
        { name = "MONGODB_DB_NAME", value = var.mongodb_db_name },
        { name = "OPENAI_MODEL", value = var.openai_model },
        { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
        { name = "GEMINI_MODEL", value = var.gemini_model },
        { name = "APP_ENV", value = var.environment },
        { name = "DEFAULT_LOCATION", value = var.default_location },
        { name = "LLM_TIMEOUT_SECONDS", value = tostring(var.llm_timeout_seconds) },
        { name = "AWS_DEFAULT_REGION", value = var.aws_region },
        { name = "WORKER_CONCURRENCY", value = tostring(var.worker_concurrency) },
        { name = "WORKER_POLL_INTERVAL_SECONDS", value = tostring(var.worker_poll_interval_seconds) },
        # CORS_ORIGINS and COOKIE_* not needed — worker has no HTTP server
        # REDIS_URL not needed — worker does not use Redis (rate limiting is API-side)
      ]

      secrets = [
        { name = "MONGODB_URI", valueFrom = "${aws_secretsmanager_secret.app.arn}:MONGODB_URI::" },
        { name = "JWT_PRIVATE_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_PRIVATE_KEY::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:OPENAI_API_KEY::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:ANTHROPIC_API_KEY::" },
        { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:GEMINI_API_KEY::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  tags = {
    Name = "${var.app_name}-worker-task-${var.environment}"
  }
}

resource "aws_ecs_service" "worker" {
  name            = "${var.app_name}-worker-${var.environment}"
  cluster         = aws_ecs_cluster.backend.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  enable_execute_command = var.enable_execute_command

  network_configuration {
    subnets = [
      aws_subnet.private_1.id,
      aws_subnet.private_2.id,
      aws_subnet.private_3.id,
    ]
    security_groups  = [aws_security_group.worker_sg.id]
    assign_public_ip = false
  }

  # No load_balancer block — worker exposes no endpoints

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = {
    Name = "${var.app_name}-worker-service-${var.environment}"
  }
}
