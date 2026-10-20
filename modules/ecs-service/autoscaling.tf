# ---------------------------------------------------------------------------
# App Autoscaling — target, policies (passed in), and alarms
#
# ECS App Autoscaling scales out on whichever policy fires first, and scales
# in only when all target-tracking policies agree. Step-scaling policies are
# each driven by their own CloudWatch alarm, defined alongside them.
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "this" {
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
  # Implicit reference to the service ensures correct dependency ordering.
  resource_id = "service/${var.cluster_name}/${aws_ecs_service.this.name}"
}

resource "aws_appautoscaling_policy" "target_tracking" {
  for_each = var.target_tracking_policies

  name               = "${var.app_name}-${var.scaling_name}-${each.key}-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  service_namespace  = aws_appautoscaling_target.this.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = each.value.metric_type
      # Required for ALBRequestCountPerTarget: "<alb-arn-suffix>/<tg-arn-suffix>".
      resource_label = each.value.resource_label
    }
    target_value       = each.value.target_value
    scale_in_cooldown  = each.value.scale_in_cooldown
    scale_out_cooldown = each.value.scale_out_cooldown
    disable_scale_in   = each.value.disable_scale_in
  }
}

resource "aws_appautoscaling_policy" "step" {
  for_each = var.step_scaling_policies

  name               = "${var.app_name}-${var.scaling_name}-${each.key}-${var.environment}"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  service_namespace  = aws_appautoscaling_target.this.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = each.value.adjustment_type
    cooldown                = each.value.cooldown
    metric_aggregation_type = each.value.metric_aggregation_type

    # Bounds are relative to the alarm threshold.
    dynamic "step_adjustment" {
      for_each = each.value.steps
      content {
        metric_interval_lower_bound = step_adjustment.value.lower_bound
        metric_interval_upper_bound = step_adjustment.value.upper_bound
        scaling_adjustment          = step_adjustment.value.adjustment
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "step" {
  for_each = var.step_scaling_policies

  alarm_name          = "${var.app_name}-${var.scaling_name}-${coalesce(each.value.alarm.name_suffix, each.key)}-${var.environment}"
  metric_name         = each.value.alarm.metric_name
  namespace           = each.value.alarm.namespace
  statistic           = each.value.alarm.statistic
  period              = each.value.alarm.period
  evaluation_periods  = each.value.alarm.evaluation_periods
  threshold           = each.value.alarm.threshold
  comparison_operator = each.value.alarm.comparison_operator
  treat_missing_data  = each.value.alarm.treat_missing_data
  dimensions          = each.value.alarm.dimensions

  alarm_actions = [aws_appautoscaling_policy.step[each.key].arn]

  tags = {
    Name = "${var.app_name}-${var.scaling_name}-${coalesce(each.value.alarm.name_suffix, each.key)}-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# Sustained-saturation alerts — fire only on 3 consecutive 5-minute periods
# above 85% (single-datapoint views live in dashboards), to limit alert fatigue.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "sustained" {
  for_each = var.enable_sustained_alarms ? var.sustained_alarms : {}

  alarm_name          = "${var.app_name}-${var.scaling_name}-${each.key}-sustained-${var.environment}"
  metric_name         = each.value
  namespace           = "AWS/ECS"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = aws_ecs_service.this.name
  }

  alarm_actions = [var.alarm_topic_arn]
  ok_actions    = [var.alarm_topic_arn]

  tags = {
    Name = "${var.app_name}-${var.scaling_name}-${each.key}-sustained-${var.environment}"
  }

  lifecycle {
    precondition {
      condition     = var.alarm_topic_arn != null
      error_message = "sustained_alarms need alarm_topic_arn."
    }
  }
}

# ---------------------------------------------------------------------------
# Immediate alerts — a single 1-minute datapoint above 85%. They complement
# the sustained alarms above: those limit alert fatigue, these fire faster for
# dashboards and incident response.
# ---------------------------------------------------------------------------

locals {
  metric_label = { CPUUtilization = "CPU", MemoryUtilization = "memory" }
}

resource "aws_cloudwatch_metric_alarm" "immediate" {
  for_each = var.enable_sustained_alarms ? var.immediate_alarms : {}

  alarm_name          = "${var.app_name}-${var.scaling_name}-${each.key}-high-${var.environment}"
  alarm_description   = "${coalesce(var.display_name, var.role)} ECS ${lookup(local.metric_label, each.value, each.value)} above 85%."
  namespace           = "AWS/ECS"
  metric_name         = each.value
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = aws_ecs_service.this.name
  }

  alarm_actions = [var.alarm_topic_arn]
  ok_actions    = [var.alarm_topic_arn]

  tags = {
    Name = "${var.app_name}-${var.scaling_name}-${each.key}-high-${var.environment}"
  }

  lifecycle {
    precondition {
      condition     = var.alarm_topic_arn != null
      error_message = "immediate_alarms need alarm_topic_arn."
    }
  }
}
