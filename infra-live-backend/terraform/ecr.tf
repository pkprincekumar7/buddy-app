# ---------------------------------------------------------------------------
# ECR — private Docker image registry for the backend
#
# The deploy workflow builds the backend image, tags it with the git SHA,
# pushes it here, and then updates the ECS task definition to use the new
# image URI. IMMUTABLE tags prevent overwriting an existing image tag —
# every push must use a unique tag (git SHA). The initial task definition
# in ecs.tf references :latest as a bootstrap placeholder only; the first
# deploy immediately replaces it with a SHA-tagged revision.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "backend" {
  #checkov:skip=CKV_AWS_136:AWS-managed AES-256 encryption is sufficient for container images at this scale; CMK adds cost and operational overhead without meaningful additional security

  name                 = "${var.app_name}/${var.environment}/backend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${var.app_name}-backend-ecr"
  }
}

# Lifecycle policy — keep the last 30 tagged images; remove untagged images
# older than 7 days to prevent unbounded storage growth.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

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
