# ---------------------------------------------------------------------------
# CloudWatch — log group for ECS container logs
# Retention: 30 days (enough for debugging; adjust as needed).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.app_name}/backend/${var.environment}"
  retention_in_days = 30

  tags = {
    Name = "${var.app_name}-backend-logs-${var.environment}"
  }
}
