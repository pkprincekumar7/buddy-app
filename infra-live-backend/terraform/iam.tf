# ---------------------------------------------------------------------------
# IAM — one execution role and one task role per runtime (services.tf, 15.1)
#
# Execution role: used by the ECS agent to pull the image, write logs and inject
# secrets. Each reads only its own service's secret and service-token signing key,
# so no runtime can start with another service's credentials.
#
# Task role: what the running application may do in AWS. Each holds only its own
# runtime's policies (local.services[*].task_policies), plus ECS Exec when on.
# Names: <app>-<runtime>-{exec,task}-role-<env>-<region>.
# ---------------------------------------------------------------------------

locals {
  ecs_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role" "execution" {
  for_each = local.services

  name               = "${var.app_name}-${each.key}-exec-role-${var.environment}-${var.aws_region}"
  assume_role_policy = local.ecs_assume_role_policy

  lifecycle {
    precondition {
      condition     = length("${var.app_name}-${each.key}-exec-role-${var.environment}-${var.aws_region}") <= 64
      error_message = "IAM role name for ${each.key} is over 64 characters."
    }
  }
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  for_each = local.services

  role       = aws_iam_role.execution[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Its own service's secret and signing key only (the collector has neither).
resource "aws_iam_role_policy" "execution_secrets" {
  for_each = { for k, s in local.services : k => s if s.service != null }

  name = "${var.app_name}-${each.key}-exec-secrets-${var.environment}-${var.aws_region}"
  role = aws_iam_role.execution[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
        Resource = [aws_secretsmanager_secret.service[each.value.service].arn]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = [aws_ssm_parameter.signing_key[each.value.service].arn]
      },
    ]
  })
}

resource "aws_iam_role" "task" {
  for_each = local.services

  name               = "${var.app_name}-${each.key}-task-role-${var.environment}-${var.aws_region}"
  assume_role_policy = local.ecs_assume_role_policy
}

locals {
  # runtime + policy name part → document, flattened for for_each.
  service_task_policies = merge([
    for k, s in local.services : {
      for p, doc in s.task_policies : "${k}/${p}" => { runtime = k, name = p, document = doc }
    }
  ]...)

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
}

resource "aws_iam_role_policy" "task" {
  for_each = local.service_task_policies

  name   = "${var.app_name}-${each.value.runtime}-${each.value.name}-${var.environment}-${var.aws_region}"
  role   = aws_iam_role.task[each.value.runtime].id
  policy = jsonencode(each.value.document)
}

# ECS Exec (enable_execute_command). Not attached at all when exec is off.
resource "aws_iam_role_policy" "task_exec_command" {
  for_each = var.enable_execute_command ? toset(keys(local.services)) : toset([])

  name   = "${var.app_name}-${each.key}-exec-command-${var.environment}-${var.aws_region}"
  role   = aws_iam_role.task[each.key].id
  policy = jsonencode(local.ssm_messages_policy)
}
