# ---------------------------------------------------------------------------
# CloudWatch — log groups for ECS container logs
# Retention is parameterised per environment: 7 days (dev/sbx), 30 days (stg),
# 90 days (prod) via var.log_retention_days.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "backend" {
  #checkov:skip=CKV_AWS_158:AWS-managed encryption is sufficient for application logs at this scale; CMK adds cost without meaningful security uplift
  #checkov:skip=CKV_AWS_338:Retention is parameterised per environment — 7 days (dev/sbx), 30 days (stg), 90 days (prod) via var.log_retention_days

  name              = "/ecs/${var.app_name}/backend/${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-backend-logs-${var.environment}"
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  #checkov:skip=CKV_AWS_158:AWS-managed encryption is sufficient for application logs at this scale; CMK adds cost without meaningful security uplift
  #checkov:skip=CKV_AWS_338:Retention is parameterised per environment — 7 days (dev/sbx), 30 days (stg), 90 days (prod) via var.log_retention_days

  name              = "/ecs/${var.app_name}/worker/${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-worker-logs-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# SNS email subscription — all environments
# The SNS topic itself (aws_sns_topic.alerts) lives in autoscaling.tf.
# After apply, AWS sends a confirmation email — subscription is inactive
# until the operator clicks the confirmation link.
# ---------------------------------------------------------------------------

resource "aws_sns_topic_subscription" "ops_email" {
  count     = var.enable_ops_email ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.ops_email
}

# ---------------------------------------------------------------------------
# Worker alerting alarms — enable_all_alarms (prod only)
# ---------------------------------------------------------------------------

# ProcessingJobCount > 0 for 10+ consecutive minutes means jobs are stuck in
# "processing" state (worker slots claimed them but never finished). This
# usually indicates a worker crash-loop or a MongoDB connectivity problem.
resource "aws_cloudwatch_metric_alarm" "worker_processing_stuck" {
  count               = var.enable_all_alarms ? 1 : 0
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

# PendingJobCount sustained high — jobs are not being consumed fast enough.
resource "aws_cloudwatch_metric_alarm" "worker_pending_jobs_high" {
  count               = var.enable_all_alarms ? 1 : 0
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

# ---------------------------------------------------------------------------
# ALB alerting alarms — enable_basic_alarms (stg + prod)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_healthy_hosts" {
  count               = var.enable_basic_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-alb-healthy-hosts-${var.environment}"
  alarm_description   = "ALB has no healthy targets — API service may be down."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    TargetGroup  = aws_lb_target_group.backend.arn_suffix
    LoadBalancer = aws_lb.backend.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-alb-healthy-hosts-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  count               = var.enable_basic_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-alb-5xx-${var.environment}"
  alarm_description   = "ALB 5XX error spike — check API task logs."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.backend.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-alb-5xx-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# ECS and Redis alerting alarms — enable_all_alarms (prod only)
# These are single-datapoint (immediate) alarms complementing the sustained
# alarms in autoscaling.tf. The sustained alarms reduce alert fatigue;
# these fire faster for dashboards and incident response.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_cpu_high" {
  count               = var.enable_all_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-api-cpu-high-${var.environment}"
  alarm_description   = "API ECS CPU above 85%."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.backend.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-api-cpu-high-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_memory_high" {
  count               = var.enable_all_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-api-memory-high-${var.environment}"
  alarm_description   = "API ECS memory above 85%."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.backend.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-api-memory-high-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu_high" {
  count               = var.enable_all_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-worker-cpu-high-${var.environment}"
  alarm_description   = "Worker ECS CPU above 85%."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.worker.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-worker-cpu-high-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_memory_high" {
  count               = var.enable_all_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-worker-memory-high-${var.environment}"
  alarm_description   = "Worker ECS memory above 85%."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.worker.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-worker-memory-high-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_connections" {
  count               = var.enable_all_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-redis-connections-${var.environment}"
  alarm_description   = "Redis current connections dropped below 1 — possible cluster failure."
  namespace           = "AWS/ElastiCache"
  metric_name         = "CurrConnections"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.main.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-redis-connections-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# X-Ray sampling rules
# dev/sbx/stg: 1 rule at var.xray_default_sampling_rate (5%)
# prod:        1 rule at var.xray_default_sampling_rate (1%) + 1 error rule at 100%
# ---------------------------------------------------------------------------

resource "aws_xray_sampling_rule" "default" {
  rule_name      = "${var.app_name}-default-${var.environment}"
  priority       = 9999
  version        = 1
  reservoir_size = 1
  fixed_rate     = var.xray_default_sampling_rate
  host           = "*"
  http_method    = "*"
  url_path       = "*"
  service_name   = "*"
  service_type   = "*"
  resource_arn   = "*"

  tags = {
    Name = "${var.app_name}-xray-default-${var.environment}"
  }
}

# Captures 100% of traces where X-Ray detects an error/fault response.
# Priority 1 means it is evaluated before the default rule.
resource "aws_xray_sampling_rule" "errors" {
  count          = var.enable_xray_error_rule ? 1 : 0
  rule_name      = "${var.app_name}-errors-${var.environment}"
  priority       = 1
  version        = 1
  reservoir_size = 5
  fixed_rate     = 1.0
  host           = "*"
  http_method    = "*"
  url_path       = "*"
  service_name   = "*"
  service_type   = "*"
  resource_arn   = "*"

  tags = {
    Name = "${var.app_name}-xray-errors-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# CloudWatch dashboard — enable_dashboard (prod, optional stg)
# Template file lives alongside this module as dashboard.json.tpl.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  count          = var.enable_dashboard ? 1 : 0
  dashboard_name = "${var.app_name}-${var.environment}"

  dashboard_body = templatefile("${path.module}/dashboard.json.tpl", {
    region                  = var.aws_region
    cluster_name            = aws_ecs_cluster.backend.name
    api_service_name        = aws_ecs_service.backend.name
    worker_service_name     = aws_ecs_service.worker.name
    alb_arn_suffix          = aws_lb.backend.arn_suffix
    tg_arn_suffix           = aws_lb_target_group.backend.arn_suffix
    redis_replication_group = aws_elasticache_replication_group.main.id
  })
}
