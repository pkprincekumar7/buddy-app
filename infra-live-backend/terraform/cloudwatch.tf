# ---------------------------------------------------------------------------
# CloudWatch — log group for ECS container logs
# Retention: 30 days (enough for debugging; adjust as needed).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "backend" {
  #checkov:skip=CKV_AWS_158:AWS-managed encryption is sufficient for application logs at this scale; CMK adds cost without meaningful security uplift
  #checkov:skip=CKV_AWS_338:30-day retention is intentional — sufficient for debugging and incident response at current scale; 1-year retention costs deferred

  name              = "/ecs/${var.app_name}/backend/${var.environment}"
  retention_in_days = 30

  tags = {
    Name = "${var.app_name}-backend-logs-${var.environment}"
  }
}
