# ---------------------------------------------------------------------------
# ECS Task Execution Role
# Used by the ECS agent to pull images from ECR, write logs to CloudWatch,
# and inject secrets from Secrets Manager at container startup.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_execution_role" {
  name = "${var.app_name}-ecs-execution-role-${var.environment}-${var.aws_region}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.app_name}-ecs-execution-secrets-${var.environment}-${var.aws_region}"
  role = aws_iam_role.ecs_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.app.arn
        ]
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Task roles — one per entry in local.services (services.tf). The running
# application assumes it. Names: <app>-<iam_name>-role-<env>-<region>, with
# iam_name defaulting to "<key>-task".
# ---------------------------------------------------------------------------

resource "aws_iam_role" "task" {
  for_each = local.services

  name = "${var.app_name}-${local.service_iam_name[each.key]}-role-${var.environment}-${var.aws_region}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

locals {
  # service key + policy name part → document, flattened for for_each.
  service_task_policies = merge([
    for k, s in local.services : {
      for p, doc in s.task_policies : "${k}/${p}" => { service = k, name = p, document = doc }
    }
  ]...)

  # Least privilege for the two optional features: attach the policy only
  # when the feature is on, to every service (it's per task, not per app).
  ssm_messages_policy = {
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      Resource = "*"
    }]
  }
  xray_policy = {
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"], Resource = "*" }]
  }
}

# Each service's own permissions (local.services[*].task_policies).
resource "aws_iam_role_policy" "task" {
  for_each = local.service_task_policies

  name   = "${var.app_name}-${local.service_iam_name[each.value.service]}-${each.value.name}-${var.environment}-${var.aws_region}"
  role   = aws_iam_role.task[each.value.service].id
  policy = jsonencode(each.value.document)
}

# Required by ECS Exec (enable_execute_command). Not attached at all when exec
# is off — defense in depth over relying on the service-level flag alone.
resource "aws_iam_role_policy" "task_exec_command" {
  for_each = var.enable_execute_command ? toset(keys(local.services)) : toset([])

  name   = "${var.app_name}-${local.service_iam_name[each.key]}-exec-command-${var.environment}-${var.aws_region}"
  role   = aws_iam_role.task[each.key].id
  policy = jsonencode(local.ssm_messages_policy)
}

# Required by the ADOT sidecar (enable_adot_sidecar) to export traces to X-Ray.
resource "aws_iam_role_policy" "task_xray" {
  for_each = var.enable_adot_sidecar ? toset(keys(local.services)) : toset([])

  name   = "${var.app_name}-${local.service_iam_name[each.key]}-xray-${var.environment}-${var.aws_region}"
  role   = aws_iam_role.task[each.key].id
  policy = jsonencode(local.xray_policy)
}
