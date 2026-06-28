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
# ECS Task Role
# Used by the running application container.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task_role" {
  name = "${var.app_name}-ecs-task-role-${var.environment}-${var.aws_region}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.app_name}-ecs-task-s3-${var.environment}-${var.aws_region}"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = ["arn:aws:s3:::${var.assets_bucket_name}"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["arn:aws:s3:::${var.assets_bucket_name}/*"]
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Worker Task Role
# Separate from the API task role — workers do not need S3 access (downloads)
# but do need CloudWatch PutMetricData for PendingJobCount emission.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "worker_task_role" {
  name = "${var.app_name}-worker-task-role-${var.environment}-${var.aws_region}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "worker_task_cloudwatch" {
  name = "${var.app_name}-worker-task-cloudwatch-${var.environment}-${var.aws_region}"
  role = aws_iam_role.worker_task_role.id

  # PutMetricData requires Resource = "*" (CloudWatch does not support
  # resource-level ARNs for this action), but the Condition key
  # "cloudwatch:namespace" IS enforced by the service for PutMetricData,
  # effectively scoping this permission to the Buddy360/Worker namespace only.
  # Do NOT remove the Condition block assuming it is ineffective — it is the
  # only constraint preventing the worker from writing to arbitrary namespaces.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Buddy360/Worker"
          }
        }
      }
    ]
  })
}

# Required by ECS Exec (enable_execute_command). Gated on var.enable_execute_command to
# match intent — the API-side ecs_task_exec_command policy omits this gate and relies on
# the service-level flag, but defense-in-depth means we shouldn't attach the policy at all
# when exec is not needed.
resource "aws_iam_role_policy" "worker_task_exec_command" {
  count = var.enable_execute_command ? 1 : 0
  name  = "${var.app_name}-worker-task-exec-command-${var.environment}-${var.aws_region}"
  role  = aws_iam_role.worker_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      }
    ]
  })
}

# Required by ECS Exec (enable_execute_command). Gated on var.enable_execute_command
# so the policy is not attached at all when exec is not needed — mirrors the
# worker_task_exec_command gate added in the same change.
resource "aws_iam_role_policy" "ecs_task_exec_command" {
  count = var.enable_execute_command ? 1 : 0
  name  = "${var.app_name}-ecs-task-exec-command-${var.environment}-${var.aws_region}"
  role  = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# X-Ray — API task role
# Required by the ADOT sidecar to export traces to X-Ray. Kept separate from
# the S3 uploads policy so each policy has a single purpose.
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "ecs_task_xray" {
  count = var.enable_adot_sidecar ? 1 : 0
  name  = "${var.app_name}-ecs-task-xray-${var.environment}-${var.aws_region}"
  role  = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# X-Ray — worker task role
# Same actions as the API role; added here once ADOT sidecar is attached to
# the worker task definition via var.enable_adot_sidecar.
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "worker_task_xray" {
  count = var.enable_adot_sidecar ? 1 : 0
  name  = "${var.app_name}-worker-task-xray-${var.environment}-${var.aws_region}"
  role  = aws_iam_role.worker_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# S3 uploads — API task role
# Grants the API task permission to generate pre-signed PUT URLs for the
# uploads bucket. Kept separate from ecs_task_s3 (which targets the assets
# bucket) so each policy remains single-purpose.
# s3:GetBucketLocation is required by some AWS SDK versions when signing
# pre-signed URLs to resolve the bucket's endpoint correctly.
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "ecs_task_s3_uploads" {
  name = "${var.app_name}-ecs-task-s3-uploads-${var.environment}-${var.aws_region}"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = "arn:aws:s3:::${var.uploads_bucket_name}"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "arn:aws:s3:::${var.uploads_bucket_name}/*"
      }
    ]
  })
}
