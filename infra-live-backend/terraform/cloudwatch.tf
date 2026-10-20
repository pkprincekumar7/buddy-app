# ---------------------------------------------------------------------------
# SNS topic for operational alarms
# CloudWatch alarms publish here; subscribe an email or PagerDuty endpoint
# via the AWS console or a separate Terraform data-source after first apply.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0095
resource "aws_sns_topic" "alerts" {
  #checkov:skip=CKV_AWS_26:SNS topic encryption deferred — no sensitive data in alarm payloads; CMK adds cost without meaningful security uplift at this scale
  name = "${var.app_name}-alerts-${var.environment}"

  tags = {
    Name = "${var.app_name}-alerts-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# CloudWatch — log groups for ECS container logs
# Retention is parameterised per environment: 7 days (dev/sbx), 30 days (stg),
# 90 days (prod) via var.log_retention_days.
# ---------------------------------------------------------------------------

# One per entry in local.services (services.tf): /ecs/<app>/<key>/<env>.
resource "aws_cloudwatch_log_group" "service" {
  #checkov:skip=CKV_AWS_158:AWS-managed encryption is sufficient for application logs at this scale; CMK adds cost without meaningful security uplift
  #checkov:skip=CKV_AWS_338:Retention is parameterised per environment — 7 days (dev/sbx), 30 days (stg), 90 days (prod) via var.log_retention_days
  for_each = local.services

  name              = "/ecs/${var.app_name}/${each.key}/${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-${each.key}-logs-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# SNS email subscription — all environments
# The SNS topic itself (aws_sns_topic.alerts) is at the top of this file.
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
  namespace           = "Superpower/Worker"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_description = "Worker jobs stuck in processing for >10 minutes — check ECS logs and MongoDB connectivity."

  dimensions = {
    Environment = var.environment
  }

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
  namespace           = "Superpower/Worker"
  metric_name         = "PendingJobCount"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-worker-pending-jobs-high-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# ALB alerting alarms — enable_basic_alarms (stg + prod)
# ---------------------------------------------------------------------------

# One per HTTP service (services.tf): each has its own target group.
resource "aws_cloudwatch_metric_alarm" "alb_healthy_hosts" {
  for_each            = { for k, s in local.http_services : k => s if var.enable_basic_alarms }
  alarm_name          = "${var.app_name}-alb-healthy-hosts-${each.key}-${var.environment}"
  alarm_description   = "ALB target group for ${each.value.display_name} has no healthy targets — the ${each.value.display_name} service may be down."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    TargetGroup  = module.alb.target_group_arn_suffixes[each.key]
    LoadBalancer = module.alb.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-alb-healthy-hosts-${each.key}-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  count               = var.enable_basic_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-alb-5xx-${var.environment}"
  alarm_description   = "ALB 5XX error spike (all target groups) — check the API, Auth and Admin task logs."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = module.alb.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-alb-5xx-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# Per-service ECS alarms (sustained and immediate CPU/memory) are created by
# ../../modules/ecs-service from each service's sustained_alarms /
# immediate_alarms in services.tf. The Redis alarm below is app-wide.
# ---------------------------------------------------------------------------

# ElastiCache publishes CurrConnections per node (CacheClusterId), never per
# replication group, so the alarm sums every member node. Member ids are
# deterministic: <replication_group_id>-001, -002, ... (one per
# num_cache_clusters).
locals {
  redis_member_ids = [
    for i in range(var.elasticache_replica_count + 1) :
    format("%s-%03d", module.redis.replication_group_id, i + 1)
  ]
}

resource "aws_cloudwatch_metric_alarm" "redis_connections" {
  count               = var.enable_all_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-redis-connections-${var.environment}"
  alarm_description   = "Redis current connections (all nodes) dropped below 1 — possible cluster failure."
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  metric_query {
    id          = "total"
    expression  = "SUM(METRICS())"
    label       = "CurrConnections (all nodes)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.redis_member_ids
    content {
      id = "node${metric_query.key}"
      metric {
        namespace   = "AWS/ElastiCache"
        metric_name = "CurrConnections"
        stat        = "Minimum"
        period      = 300
        dimensions = {
          CacheClusterId = metric_query.value
        }
      }
    }
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
  count = var.enable_dashboard ? 1 : 0
  # Region-qualified: CloudWatch dashboard names are account-global, so one
  # name per env would make every region's apply overwrite the same dashboard.
  dashboard_name = "${var.app_name}-${var.environment}-${var.aws_region}"

  dashboard_body = templatefile("${path.module}/dashboard.json.tpl", {
    region              = var.aws_region
    cluster_name        = aws_ecs_cluster.backend.name
    api_service_name    = module.service["backend"].service_name
    auth_service_name   = module.service["auth"].service_name
    admin_service_name  = module.service["admin"].service_name
    worker_service_name = module.service["worker"].service_name
    alb_arn_suffix      = module.alb.arn_suffix
    tg_arn_suffix       = module.alb.target_group_arn_suffixes["backend"]
    auth_tg_arn_suffix  = module.alb.target_group_arn_suffixes["auth"]
    admin_tg_arn_suffix = module.alb.target_group_arn_suffixes["admin"]
    redis_member_ids    = local.redis_member_ids
    environment         = var.environment
  })
}
