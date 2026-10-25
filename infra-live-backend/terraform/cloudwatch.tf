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
# Job and event alarms — enable_all_alarms (docs/auth-users-split.md, 15.5)
#
# Each service publishes its metrics to its own namespace, Superpower/<service>,
# with an Environment dimension:
#   - PendingJobCount and OldestRunningJobAgeSeconds (the 4 generating services,
#     from one leader per region in the HTTP runtime);
#   - OldestUnpublishedOutboxAgeSeconds (the 8 data services' relays, 0 when idle).
# ---------------------------------------------------------------------------

locals {
  alarm_actions     = [aws_sns_topic.alerts.arn]
  generating_alarms = var.enable_all_alarms ? toset(local.generating_services) : toset([])
  outbox_alarms     = var.enable_all_alarms ? toset(local.worker_services) : toset([])
}

# Jobs waiting faster than workers take them.
resource "aws_cloudwatch_metric_alarm" "pending_jobs_high" {
  for_each = local.generating_alarms

  alarm_name          = "${var.app_name}-${each.key}-pending-jobs-high-${var.environment}"
  alarm_description   = "${each.key}'s generation backlog is over 100 for 5 minutes: its worker may need more tasks, or is failing."
  namespace           = "Superpower/${each.key}"
  metric_name         = "PendingJobCount"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { Environment = var.environment }
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# A job running this long means a hung job or worker.
resource "aws_cloudwatch_metric_alarm" "processing_stuck" {
  for_each = local.generating_alarms

  alarm_name          = "${var.app_name}-${each.key}-processing-stuck-${var.environment}"
  alarm_description   = "A ${each.key} job has been running over 10 minutes: a hung job or worker; check the worker's logs."
  namespace           = "Superpower/${each.key}"
  metric_name         = "OldestRunningJobAgeSeconds"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 600
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { Environment = var.environment }
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# The leader stopped publishing PendingJobCount: scaling has lost its signal.
resource "aws_cloudwatch_metric_alarm" "pending_jobs_missing" {
  for_each = local.generating_alarms

  alarm_name          = "${var.app_name}-${each.key}-pending-jobs-missing-${var.environment}"
  alarm_description   = "No PendingJobCount from ${each.key} for 10 minutes: its HTTP runtime's metrics leader is down, so the worker can't scale on its backlog."
  namespace           = "Superpower/${each.key}"
  metric_name         = "PendingJobCount"
  statistic           = "SampleCount"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  dimensions          = { Environment = var.environment }
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# The relay publishes 0 every minute when idle, so missing data means a dead relay.
resource "aws_cloudwatch_metric_alarm" "outbox_stale" {
  for_each = local.outbox_alarms

  alarm_name          = "${var.app_name}-${each.key}-outbox-stale-${var.environment}"
  alarm_description   = "${each.key}'s oldest unpublished event is over 10 minutes old, or its relay stopped reporting: events aren't reaching other services."
  namespace           = "Superpower/${each.key}"
  metric_name         = "OldestUnpublishedOutboxAgeSeconds"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 600
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  dimensions          = { Environment = var.environment }
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
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
  alarm_description   = "ALB 5XX error spike (all target groups) — check the HTTP services' task logs."
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
# CloudWatch dashboard — enable_dashboard (prod, optional stg)
#
# Built from the runtime list, so a new service appears without editing it:
# CPU and memory per runtime, requests and 5XX per HTTP service, the job and
# outbox metrics, event-queue age and Valkey connections. (X-Ray sampling is the
# collector's tail sampling now, otel_collector.tf, so there are no sampling rules.)
# ---------------------------------------------------------------------------

locals {
  dashboard_runtimes = sort(keys(local.services))
  dashboard_widgets = [
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "CPU by runtime", region = var.aws_region, stat = "Average", period = 300
        metrics = [for k in local.dashboard_runtimes : ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.backend.name, "ServiceName", module.service[k].service_name, { label = k }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "Memory by runtime", region = var.aws_region, stat = "Average", period = 300
        metrics = [for k in local.dashboard_runtimes : ["AWS/ECS", "MemoryUtilization", "ClusterName", aws_ecs_cluster.backend.name, "ServiceName", module.service[k].service_name, { label = k }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "Requests per target", region = var.aws_region, stat = "Sum", period = 60
        metrics = [for k in sort(keys(local.http_services)) : ["AWS/ApplicationELB", "RequestCountPerTarget", "TargetGroup", module.alb.target_group_arn_suffixes[k], "LoadBalancer", module.alb.arn_suffix, { label = k }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "5XX by service", region = var.aws_region, stat = "Sum", period = 60
        metrics = [for k in sort(keys(local.http_services)) : ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "TargetGroup", module.alb.target_group_arn_suffixes[k], "LoadBalancer", module.alb.arn_suffix, { label = k }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "Pending generation jobs", region = var.aws_region, stat = "Maximum", period = 60
        metrics = [for s in local.generating_services : ["Superpower/${s}", "PendingJobCount", "Environment", var.environment, { label = s }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "Oldest unpublished event (s)", region = var.aws_region, stat = "Maximum", period = 60
        metrics = [for s in local.worker_services : ["Superpower/${s}", "OldestUnpublishedOutboxAgeSeconds", "Environment", var.environment, { label = s }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "Oldest event waiting in each queue (s)", region = var.aws_region, stat = "Maximum", period = 300
        metrics = [for s in sort(keys(module.events.queue_urls)) : ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", "${var.app_name}-${var.environment}-${s}-events", { label = s }]]
      }
    },
    {
      type = "metric", width = 12, height = 6
      properties = {
        title   = "Valkey connections", region = var.aws_region, stat = "Maximum", period = 300
        metrics = [for id in local.redis_member_ids : ["AWS/ElastiCache", "CurrConnections", "CacheClusterId", id]]
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "main" {
  count = var.enable_dashboard ? 1 : 0
  # Region-qualified: dashboard names are account-global.
  dashboard_name = "${var.app_name}-${var.environment}-${var.aws_region}"
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}
