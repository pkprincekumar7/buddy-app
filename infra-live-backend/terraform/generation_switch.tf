# ---------------------------------------------------------------------------
# The generation kill switch (production-readiness review, JOB-03)
#
# One SSM parameter per backend stack (environment and region). The generating
# services (discover, grow, transform, release) read it about once a minute
# (backend/common/generation/switch.py). To stop LLM spend, with no deploy:
#
#   aws ssm put-parameter --overwrite --region <region> --type String \
#     --name /<app>/<env>/backend/<region>/llm_generation_enabled --value false
#
# New generations then get 503 generation_paused and the workers stop claiming
# jobs; `true` turns it back on. Terraform creates it as `true` and never resets
# it (ignore_changes), so a switch someone turned off stays off across applies.
# ---------------------------------------------------------------------------

locals {
  generation_switch_parameter = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/llm_generation_enabled"

  # Read access to the switch for the generating services' runtimes (services.tf).
  generation_switch_policy = {
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = [aws_ssm_parameter.generation_switch.arn]
    }]
  }
}

resource "aws_ssm_parameter" "generation_switch" {
  #checkov:skip=CKV2_AWS_34:Non-secret flag (true or false) — encryption not required; SecureString would add kms:Decrypt for every reader without security benefit
  name        = local.generation_switch_parameter
  description = "LLM generation on (true) or paused (false) for ${var.app_name} ${var.environment} in ${var.aws_region}. Read by the generating services about once a minute."
  type        = "String"
  value       = "true"

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name = "${var.app_name}-generation-switch-${var.environment}"
  }
}
