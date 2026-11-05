# ---------------------------------------------------------------------------
# ECR — one repository per service (docs/auth-users-split.md, 15.2)
#
# The deploy workflow builds each selected service's image
# (docker build --build-arg SERVICE=<service>), tags it with the git SHA and
# pushes it to that service's repository; the service's worker runs the same
# image. IMMUTABLE tags: every push uses a new tag. The task definitions start on
# :latest as a bootstrap placeholder; the first deploy replaces it.
# The OpenTelemetry collector runs a public image (var.otel_collector_image).
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "service" {
  #checkov:skip=CKV_AWS_136:AWS-managed AES-256 encryption is sufficient for container images at this scale; CMK adds cost and operational overhead without meaningful additional security
  for_each = toset(local.split_services)

  name                 = "${var.app_name}/${var.environment}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name    = "${var.app_name}-${each.key}-ecr"
    Service = each.key
  }
}

# Keep the last 30 tagged images; remove untagged images after 7 days.
resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Remove untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last 30 tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 30
        }
        action = { type = "expire" }
      }
    ]
  })
}

# Pull for the accounts promote-live-backend copies to (CI-09): the promote job, in the
# target account, reads the source image by digest with crane. Read-only actions.
resource "aws_ecr_repository_policy" "promote_pull" {
  for_each = length(var.ecr_pull_account_ids) > 0 ? aws_ecr_repository.service : {}

  repository = each.value.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PromotePull"
        Effect    = "Allow"
        Principal = { AWS = [for id in var.ecr_pull_account_ids : "arn:aws:iam::${id}:root"] }
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer"
        ]
      }
    ]
  })
}
