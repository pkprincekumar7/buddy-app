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

# 5xx as a share of requests, not a count, so it means the same at any traffic level
# (OBS-01): the services' own 5xx plus the load balancer's (502/503/504 when a target
# fails or times out), over 5 % of requests for 3 of 5 minutes. Below 20 requests a
# minute a few errors would be a large share of nothing, so those minutes count as 0.
# The 5xx counts are only published in minutes that have one, hence FILL(…, 0).
locals {
  alb_5xx_percent  = 5
  alb_min_requests = 20
  # p95 over this, for 3 of 5 minutes: most requests are reads; recordings and job
  # starts are the slowest, and still well under it.
  alb_p95_seconds = 3
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  count               = var.enable_basic_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-alb-5xx-${var.environment}"
  alarm_description   = "Over ${local.alb_5xx_percent}% of API requests failed with a 5xx (from the services or the load balancer) — check the HTTP services' task logs and the healthy-host alarms."
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = local.alb_5xx_percent
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    expression  = "IF(requests >= ${local.alb_min_requests}, 100 * (FILL(target5xx, 0) + FILL(elb5xx, 0)) / requests, 0)"
    label       = "5xx (% of requests)"
    return_data = true
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      stat        = "Sum"
      period      = 60
      dimensions  = { LoadBalancer = module.alb.arn_suffix }
    }
  }
  metric_query {
    id = "target5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      stat        = "Sum"
      period      = 60
      dimensions  = { LoadBalancer = module.alb.arn_suffix }
    }
  }
  metric_query {
    id = "elb5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      stat        = "Sum"
      period      = 60
      dimensions  = { LoadBalancer = module.alb.arn_suffix }
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-alb-5xx-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_slow" {
  count               = var.enable_basic_alarms ? 1 : 0
  alarm_name          = "${var.app_name}-alb-slow-${var.environment}"
  alarm_description   = "API responses are slow: p95 over ${local.alb_p95_seconds} s — check the services' CPU, MongoDB and Valkey."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = local.alb_p95_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = module.alb.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-alb-slow-${var.environment}"
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

# Valkey under strain (OBS-01). It holds the rate limits, the login throttle, the LLM
# hourly limits and the authz cache, so running out of CPU or memory slows or weakens
# all of them; an eviction means memory is already full. Each is over every node.
locals {
  valkey_alarms = var.enable_all_alarms ? {
    cpu = {
      metric = "EngineCPUUtilization", stat = "Maximum", combine = "MAX", threshold = 80
      what   = "Valkey's engine CPU is over 80% on a node — it's single-threaded, so requests to it queue."
    }
    memory = {
      metric = "DatabaseMemoryUsagePercentage", stat = "Maximum", combine = "MAX", threshold = 80
      what   = "Valkey memory is over 80% on a node — next it evicts keys (rate-limit counters, cached authz)."
    }
    evictions = {
      metric = "Evictions", stat = "Sum", combine = "SUM", threshold = 0
      what   = "Valkey evicted keys: its memory is full. Limits and cached authz are being lost; size the nodes up (TF-04)."
    }
  } : {}
}

resource "aws_cloudwatch_metric_alarm" "valkey" {
  for_each            = local.valkey_alarms
  alarm_name          = "${var.app_name}-valkey-${each.key}-${var.environment}"
  alarm_description   = each.value.what
  evaluation_periods  = 5
  datapoints_to_alarm = each.key == "evictions" ? 1 : 3
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "all"
    expression  = "${each.value.combine}(METRICS())"
    label       = "${each.value.metric} (all nodes)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.redis_member_ids
    content {
      id = "node${metric_query.key}"
      metric {
        namespace   = "AWS/ElastiCache"
        metric_name = each.value.metric
        stat        = each.value.stat
        period      = 60
        dimensions = {
          CacheClusterId = metric_query.value
        }
      }
    }
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = {
    Name = "${var.app_name}-valkey-${each.key}-${var.environment}"
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

# An account deletion older than 24 hours: a service hasn't confirmed it (10.3). The
# auth-worker logs `auth.deletion.stuck` for each one every 10 minutes; this counts those
# lines. The credentials are kept until every service confirms, so the account can't be
# signed into meanwhile, and the deletion resumes once the stuck service catches up.
# The relay sets aside an outbox row SNS could never take (common.events.relay), so the
# rows behind it still go; that event is lost until someone looks, so it alarms.
resource "aws_cloudwatch_log_metric_filter" "outbox_set_aside" {
  for_each = local.outbox_alarms

  name           = "${var.app_name}-${each.key}-outbox-set-aside-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.service["${each.key}-worker"].name
  pattern        = "\"outbox.row.set_aside\""

  metric_transformation {
    name          = "SetAsideOutboxRows"
    namespace     = "Superpower/${each.key}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "outbox_set_aside" {
  for_each = local.outbox_alarms

  alarm_name          = "${var.app_name}-${each.key}-outbox-set-aside-${var.environment}"
  alarm_description   = "${each.key}'s relay set aside an event SNS could never take (too large or unreadable). The ${each.key}-worker log line names the event id; the row stays in its outbox with set_aside_reason."
  namespace           = "Superpower/${each.key}"
  metric_name         = aws_cloudwatch_log_metric_filter.outbox_set_aside[each.key].metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_log_metric_filter" "deletion_stuck" {
  count = var.enable_all_alarms ? 1 : 0

  name           = "${var.app_name}-auth-deletion-stuck-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.service["auth-worker"].name
  pattern        = "\"auth.deletion.stuck\""

  metric_transformation {
    name          = "StuckDeletions"
    namespace     = "Superpower/auth"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "deletion_stuck" {
  count = var.enable_all_alarms ? 1 : 0

  alarm_name          = "${var.app_name}-auth-deletion-stuck-${var.environment}"
  alarm_description   = "An account deletion is older than 24 hours: a service hasn't sent user.data_deleted. The auth-worker log line names the user id and the services it's waiting for."
  namespace           = "Superpower/auth"
  metric_name         = aws_cloudwatch_log_metric_filter.deletion_stuck[0].metric_transformation[0].name
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------------------
# Generation and runtime alarms — enable_all_alarms (stg, prod)
# (production-readiness review: OBS-02, JOB-02, JOB-03, OBS-03)
# ---------------------------------------------------------------------------

locals {
  # A due job waiting this long: no worker is taking jobs (down, stuck or switched off).
  pending_age_alarm_seconds = 300
  # Failed generations in 15 minutes over this: the LLM provider failing, or a bug. A
  # job fails only after its retries (common.generation.jobs), so each one is a person
  # who saw an error.
  failed_jobs_alarm_per_15_minutes = 2
  all_runtime_alarms               = { for k, s in local.services : k => s if var.enable_all_alarms }
}

# OBS-02: the longest a due job has waited (published by each circle's leader).
resource "aws_cloudwatch_metric_alarm" "pending_age" {
  for_each = local.generating_alarms

  alarm_name          = "${var.app_name}-${each.key}-jobs-waiting-${var.environment}"
  alarm_description   = "A ${each.key} generation job has waited over ${local.pending_age_alarm_seconds} s for a worker: check the ${each.key}-worker tasks, the processing-stuck alarm, and the generation switch (generation_switch.tf)."
  namespace           = "Superpower/${each.key}"
  metric_name         = "OldestPendingJobAgeSeconds"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = local.pending_age_alarm_seconds
  comparison_operator = "GreaterThanThreshold"
  # pending_jobs_missing alarms on the metric stopping.
  treat_missing_data = "notBreaching"
  dimensions         = { Environment = var.environment }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = {
    Name = "${var.app_name}-${each.key}-jobs-waiting-${var.environment}"
  }
}

# JOB-02: each job a worker gives up on logs `<circle>.job id=… outcome=failed`.
resource "aws_cloudwatch_log_metric_filter" "failed_jobs" {
  for_each = local.generating_alarms

  name           = "${var.app_name}-${each.key}-failed-jobs-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.service["${each.key}-worker"].name
  pattern        = "\"outcome=failed\""

  metric_transformation {
    name          = "FailedJobs"
    namespace     = "Superpower/${each.key}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "failed_jobs" {
  for_each = local.generating_alarms

  alarm_name          = "${var.app_name}-${each.key}-failed-jobs-${var.environment}"
  alarm_description   = "Over ${local.failed_jobs_alarm_per_15_minutes} ${each.key} generations failed in 15 minutes (after their retries). The ${each.key}-worker log has each job's id and error; llm_call lines show the provider's outcome."
  namespace           = "Superpower/${each.key}"
  metric_name         = aws_cloudwatch_log_metric_filter.failed_jobs[each.key].metric_transformation[0].name
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = local.failed_jobs_alarm_per_15_minutes
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = {
    Name = "${var.app_name}-${each.key}-failed-jobs-${var.environment}"
  }
}

# JOB-03: LLM tokens per circle, from each llm_call log line (common.generation.llm),
# in every environment, so the dashboard and cost reports have them too.
locals {
  llm_token_metrics = {
    for pair in setproduct(local.generating_services, ["input", "output"]) :
    "${pair[0]}-${pair[1]}" => { service = pair[0], kind = pair[1] }
  }
}

resource "aws_cloudwatch_log_metric_filter" "llm_tokens" {
  for_each = local.llm_token_metrics

  name           = "${var.app_name}-${each.key}-llm-tokens-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.service["${each.value.service}-worker"].name
  pattern        = "{ $.llm_call.${each.value.kind}_tokens > 0 }"

  metric_transformation {
    name      = "Llm${title(each.value.kind)}Tokens"
    namespace = "Superpower/${each.value.service}"
    value     = "$.llm_call.${each.value.kind}_tokens"
    unit      = "Count"
  }
}

# Every circle's tokens together, per hour: spend running away (a loop, abuse, a
# prompt grown huge). The fix is the generation switch, then the cause.
resource "aws_cloudwatch_metric_alarm" "llm_tokens" {
  count = var.enable_all_alarms ? 1 : 0

  alarm_name          = "${var.app_name}-llm-tokens-${var.environment}"
  alarm_description   = "Over ${var.llm_tokens_alarm_per_hour} LLM tokens (input and output, every circle) in an hour. To stop spend at once, set the generation switch to false (generation_switch.tf); then look for the cause in the workers' llm_call lines."
  evaluation_periods  = 1
  threshold           = var.llm_tokens_alarm_per_hour
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "total"
    expression  = "SUM(METRICS())"
    label       = "LLM tokens (all circles)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.llm_token_metrics
    content {
      id = replace("t_${metric_query.key}", "-", "_")
      metric {
        namespace   = "Superpower/${metric_query.value.service}"
        metric_name = aws_cloudwatch_log_metric_filter.llm_tokens[metric_query.key].metric_transformation[0].name
        stat        = "Sum"
        period      = 3600
      }
    }
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = {
    Name = "${var.app_name}-llm-tokens-${var.environment}"
  }
}

# OBS-03: a runtime with no task running. ECS publishes CPUUtilization each minute
# while any task runs; when none does, the metric stops and missing counts as
# breaching. A free metric, so it works without Container Insights.
resource "aws_cloudwatch_metric_alarm" "no_tasks" {
  for_each = local.all_runtime_alarms

  alarm_name          = "${var.app_name}-${each.key}-no-tasks-${var.environment}"
  alarm_description   = "${each.value.display_name} has no running task for 3 minutes — ECS can't start it (check the service's events and its last task's stopped reason) or it was scaled to 0."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "SampleCount"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = module.service[each.key].service_name
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = {
    Name = "${var.app_name}-${each.key}-no-tasks-${var.environment}"
  }
}

# APP-04: a runtime that can't reach Valkey falls back to counting its rate limits,
# login throttle and LLM limit per task (as many times looser as there are tasks) and
# asks auth for every authz check. Each fallback logs a line with a top-level
# valkey_degraded field (common.valkey.degraded); every runtime but the collector
# counts them into one metric, in every environment.
locals {
  valkey_clients = { for k, s in local.services : k => s if s.kind != "collector" }
}

resource "aws_cloudwatch_log_metric_filter" "valkey_degraded" {
  for_each = local.valkey_clients

  name           = "${var.app_name}-${each.key}-valkey-degraded-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.service[each.key].name
  pattern        = "{ $.valkey_degraded = * }"

  metric_transformation {
    name          = "ValkeyDegraded"
    namespace     = "Superpower/valkey"
    value         = "1"
    default_value = "0"
  }
}

# Two 5-minute periods in a row, so one blip (a failover, a reconnect) doesn't alarm.
# While Valkey stays unreachable, each limiter logs again every 30 s per task.
resource "aws_cloudwatch_metric_alarm" "valkey_degraded" {
  count = var.enable_all_alarms ? 1 : 0

  alarm_name          = "${var.app_name}-valkey-degraded-${var.environment}"
  alarm_description   = "Runtimes can't reach Valkey for 10 minutes: rate limits, the login throttle and the LLM hourly limit are counted per task (looser by the number of tasks) and authz checks go to auth. Check the Valkey alarms and the services' 'Valkey unreachable' log lines (the valkey_degraded field names what fell back)."
  namespace           = "Superpower/valkey"
  metric_name         = "ValkeyDegraded"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = {
    Name = "${var.app_name}-valkey-degraded-${var.environment}"
  }
}
