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

# ---------------------------------------------------------------------------
# Worker alarms
# ---------------------------------------------------------------------------

# ProcessingJobCount > 0 for 10+ consecutive minutes means jobs are stuck in
# "processing" state (worker slots claimed them but never finished).  This
# usually indicates a worker crash-loop or a MongoDB connectivity problem.
# The alarm fires to the ops SNS topic so on-call can investigate.
resource "aws_cloudwatch_metric_alarm" "worker_processing_stuck" {
  alarm_name          = "${var.app_name}-worker-processing-stuck-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 10 # 10 × 60s = 10 minutes
  metric_name         = "ProcessingJobCount"
  namespace           = "Buddy360/Worker"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_description = "Worker jobs stuck in processing for >10 minutes — check ECS logs and MongoDB connectivity."

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-worker-processing-stuck-${var.environment}"
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  #checkov:skip=CKV_AWS_158:AWS-managed encryption is sufficient for application logs at this scale; CMK adds cost without meaningful security uplift
  #checkov:skip=CKV_AWS_338:30-day retention is intentional — sufficient for debugging and incident response at current scale; 1-year retention costs deferred

  name              = "/ecs/${var.app_name}/worker/${var.environment}"
  retention_in_days = 30

  tags = {
    Name = "${var.app_name}-worker-logs-${var.environment}"
  }
}

# PendingJobCount sustained high — jobs are not being consumed fast enough.
# Fires when more than 100 jobs remain pending for 5+ consecutive minutes,
# indicating the worker fleet may be under-provisioned or stuck.
resource "aws_cloudwatch_metric_alarm" "worker_pending_jobs_high" {
  alarm_name          = "${var.app_name}-worker-pending-jobs-high-${var.environment}"
  alarm_description   = "Job queue backlog is high — worker may need manual scaling or investigation."
  namespace           = "Buddy360/Worker"
  metric_name         = "PendingJobCount"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-worker-pending-jobs-high-${var.environment}"
  }
}
