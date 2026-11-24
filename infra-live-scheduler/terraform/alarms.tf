# ---------------------------------------------------------------------------
# Dispatcher alerts (production-readiness review, SCH-01) — enable_alarms (stg)
#
# A failed dispatch means the environment didn't start or stop on schedule, and
# it isn't retried (lambda.tf). Two ways it reaches OPS_EMAIL, through one topic:
#   - an alarm on the function's Errors (an exception or a timeout);
#   - its on_failure destination, which publishes the failed invocation: the
#     schedule's event (action, environment, regions) and the error.
# Confirm the subscription email SNS sends after the first apply.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0095
resource "aws_sns_topic" "scheduler_alerts" {
  #checkov:skip=CKV_AWS_26:SNS topic encryption deferred — no sensitive data in the alerts (the dispatch inputs, no PAT); CMK adds cost without meaningful security uplift at this scale (as the backend's and edge's alert topics)
  count = var.enable_alarms ? 1 : 0
  name  = "${var.app_name}-scheduler-alerts-${var.environment}"

  tags = {
    Name = "${var.app_name}-scheduler-alerts-${var.environment}"
  }
}

resource "aws_sns_topic_subscription" "scheduler_ops_email" {
  count     = var.enable_alarms ? 1 : 0
  topic_arn = aws_sns_topic.scheduler_alerts[0].arn
  protocol  = "email"
  endpoint  = var.ops_email
}

resource "aws_cloudwatch_metric_alarm" "dispatcher_errors" {
  count               = var.enable_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-scheduler-dispatch-failed-${var.environment}"
  alarm_description   = "The scheduler's GitHub dispatch failed, so ${var.environment} didn't start or stop on schedule (it isn't retried). The function's log (/${var.app_name}/${var.environment}/scheduler/github-dispatcher) has GitHub's answer; run terraform-live-all by hand if the environment must change now."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.dispatcher.function_name
  }

  alarm_actions = [aws_sns_topic.scheduler_alerts[0].arn]
  ok_actions    = [aws_sns_topic.scheduler_alerts[0].arn]
}
