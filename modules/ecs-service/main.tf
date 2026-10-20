# ---------------------------------------------------------------------------
# ecs-service — one Fargate service: task definition, service, autoscaling
# target and policies, and its alarms (TF-01). Used once per entry in
# infra-live-backend's services.tf (auth, admin, the API and the worker), so
# they can't drift apart in deployment, logging or scaling plumbing; what
# differs (container, load balancer, scaling policies) is passed in.
#
# Tasks run in private subnets with no public IP. The task definition starts
# on the image given (":latest" at bootstrap); after that the deploy workflow
# (deploy-live-backend.yml) owns the running revision and the desired count —
# hence ignore_changes = [task_definition, desired_count].
# ---------------------------------------------------------------------------

locals {
  family = "${var.app_name}-${var.role}-${var.environment}"

  # Optional parts are merged in, not set to null, so the task definition
  # JSON has no `"command": null`-style keys (they'd show up as a diff).
  main_container = merge(
    {
      name        = var.container.name
      image       = var.container.image
      essential   = true
      environment = var.container.environment
      secrets     = var.container.secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.container.log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = var.container.log_stream_prefix
        }
      }
    },
    var.container.command != null ? { command = var.container.command } : {},
    var.container.port != null ? { portMappings = [{ containerPort = var.container.port, protocol = "tcp" }] } : {},
    var.container.health_check != null ? { healthCheck = var.container.health_check } : {},
  )

  # ADOT collector sidecar — exports X-Ray traces and CloudWatch metrics.
  # essential = false so a sidecar crash does not kill the app container.
  # Uses the AWS-managed ECS default config which auto-discovers the X-Ray and
  # CloudWatch Logs exporters without a custom config file.
  # What the sidecar reserves out of the task. The app container needs at least
  # as much again, so a task with the sidecar must be ≥ 2× this (see the
  # precondition on the task definition).
  adot_cpu    = 256
  adot_memory = 512

  adot_sidecar = {
    name      = "aws-otel-collector"
    image     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.40.0"
    essential = false
    command   = ["--config=/etc/ecs/ecs-default-config.yaml"]
    cpu       = local.adot_cpu
    memory    = local.adot_memory
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.container.log_group_name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "adot"
      }
    }
  }
}

resource "aws_ecs_task_definition" "this" {
  #checkov:skip=CKV_AWS_336:Containers write temporary files at runtime (Python bytecode cache, uvicorn/worker scratch files); a read-only root filesystem would break execution
  family                   = local.family
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode(concat(
    [local.main_container],
    var.enable_adot_sidecar ? [local.adot_sidecar] : [],
  ))

  tags = {
    Name = "${var.app_name}-${var.role}-task-${var.environment}"
  }

  lifecycle {
    # The sidecar's fixed 256 CPU / 512 MiB would take the whole of a
    # 256 / 512 task, leaving the app nothing (ECS rejects it or starves it).
    precondition {
      condition     = !var.enable_adot_sidecar || (var.cpu >= 2 * local.adot_cpu && var.memory >= 2 * local.adot_memory)
      error_message = "${local.family}: the ADOT sidecar takes ${local.adot_cpu} CPU / ${local.adot_memory} MiB of the task, so with enable_adot_sidecar the task needs at least ${2 * local.adot_cpu} CPU / ${2 * local.adot_memory} MiB (it has ${var.cpu} / ${var.memory}). Raise the service's task size in the tfvars, or turn the sidecar off."
    }
  }
}

resource "aws_ecs_service" "this" {
  name            = local.family
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = var.enable_execute_command

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.load_balancer != null ? [var.load_balancer] : []
    content {
      target_group_arn = load_balancer.value.target_group_arn
      container_name   = var.container.name
      container_port   = load_balancer.value.container_port
    }
  }

  health_check_grace_period_seconds = var.health_check_grace_period_seconds

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
    Name = "${var.app_name}-${var.role}-service-${var.environment}"
  }
}
