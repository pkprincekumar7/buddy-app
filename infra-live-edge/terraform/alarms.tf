# ---------------------------------------------------------------------------
# Edge alarms (production-readiness review, OBS-01) — enable_alarms (stg, prod)
#
# CloudFront publishes its metrics in us-east-1 only, so the alarms and the topic
# they notify are there too (the backend's alarm topic is in each backend region).
# The topic emails OPS_EMAIL, as the backend's does; confirm the subscription
# email SNS sends after the first apply.
#
# 5xxErrorRate is a default CloudFront metric (no extra charge). It counts every
# 5xx viewers get, whatever the cause: an origin failing, a Lambda@Edge error, or
# CloudFront itself. So it also covers the Lambda@Edge JWT check and routing.
# ---------------------------------------------------------------------------

locals {
  # Percent of requests, for 3 of 5 minutes.
  cloudfront_5xx_percent = 5
}

#trivy:ignore:AVD-AWS-0095
resource "aws_sns_topic" "edge_alerts" {
  #checkov:skip=CKV_AWS_26:SNS topic encryption deferred — no sensitive data in alarm payloads; CMK adds cost without meaningful security uplift at this scale (as the backend's alerts topic)
  count    = var.enable_alarms ? 1 : 0
  provider = aws.us_east_1
  name     = "${var.app_name}-edge-alerts-${var.environment}"

  tags = {
    Name = "${var.app_name}-edge-alerts-${var.environment}"
  }
}

resource "aws_sns_topic_subscription" "edge_ops_email" {
  count     = var.enable_alarms ? 1 : 0
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.edge_alerts[0].arn
  protocol  = "email"
  endpoint  = var.ops_email
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx" {
  count               = var.enable_alarms ? 1 : 0
  provider            = aws.us_east_1
  alarm_name          = "${var.app_name}-cloudfront-5xx-${var.environment}"
  alarm_description   = "Over ${local.cloudfront_5xx_percent}% of requests through CloudFront ended in a 5xx — check the backend alarms (ALB 5xx, healthy hosts), the Lambda@Edge logs and the origin."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = local.cloudfront_5xx_percent
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = aws_cloudfront_distribution.frontend.id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.edge_alerts[0].arn]
  ok_actions    = [aws_sns_topic.edge_alerts[0].arn]

  tags = {
    Name = "${var.app_name}-cloudfront-5xx-${var.environment}"
  }
}
