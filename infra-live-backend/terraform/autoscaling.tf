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
# App Autoscaling — API ECS service
#
# Three policies:
#   1. CPU-based TargetTracking    — catches compute-bound saturation
#   2. Memory-based TargetTracking — catches large-payload or memory-leak scenarios
#   3. ALBRequestCountPerTarget    — most proactive; fires on throughput spike
#      before CPU/memory rise
#
# ECS App Autoscaling uses whichever policy fires first for scale-out.
# Scale-in only happens when ALL three are below threshold simultaneously.
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "api" {
  min_capacity       = var.api_min_capacity
  max_capacity       = var.api_max_capacity
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
  # Implicit reference to aws_ecs_service.backend ensures correct dependency
  # ordering without depends_on — Terraform derives the graph from the attribute.
  resource_id = "service/${aws_ecs_cluster.backend.name}/${aws_ecs_service.backend.name}"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.app_name}-api-cpu-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300 # 5 minutes — scale in slowly to avoid oscillation
    scale_out_cooldown = 60  # 1 minute — scale out fast on traffic spikes
  }
}

resource "aws_appautoscaling_policy" "api_memory" {
  name               = "${var.app_name}-api-memory-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "api_alb_requests" {
  name               = "${var.app_name}-api-alb-requests-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      # resource_label is REQUIRED for ALBRequestCountPerTarget — most commonly missed field.
      # Format: "<alb-arn-suffix>/<target-group-arn-suffix>"
      resource_label = "${aws_lb.backend.arn_suffix}/${aws_lb_target_group.backend.arn_suffix}"
    }
    target_value       = 1000 # requests per task per minute
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ---------------------------------------------------------------------------
# CloudWatch alarms — API sustained saturation alerts
# Single-datapoint alarms exist in dashboards; these fire only on sustained
# load (3 consecutive 5-minute periods) to reduce alert fatigue.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_cpu_sustained" {
  alarm_name          = "${var.app_name}-api-cpu-sustained-${var.environment}"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.backend.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-api-cpu-sustained-${var.environment}"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_memory_sustained" {
  alarm_name          = "${var.app_name}-api-memory-sustained-${var.environment}"
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.backend.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-api-memory-sustained-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# App Autoscaling — Worker ECS service
#
# Two policies:
#   1. CPU-based TargetTracking  — scale-in guard; prevents premature scale-in
#      when workers are genuinely busy (LLM I/O shows as low CPU, so this
#      primarily acts as a floor for scale-in, not scale-out)
#   2. PendingJobCount StepScaling — proactive scale-out based on actual queue
#      depth. CPU alone is unreliable for workers that spend most time in I/O wait.
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "worker" {
  min_capacity       = var.worker_min_capacity
  max_capacity       = var.worker_max_capacity
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.backend.name}/${aws_ecs_service.worker.name}"
}

resource "aws_appautoscaling_policy" "worker_cpu" {
  name               = "${var.app_name}-worker-cpu-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_out_cooldown = 60
    # Scale-in is disabled here — owned by worker_scale_in step policy below.
    # Letting both policies manage scale-in simultaneously causes oscillation.
    disable_scale_in = true
  }
}

# CloudWatch alarm drives the PendingJobCount step scaling policy.
# The alarm triggers when PendingJobCount exceeds 50 — the step adjustments
# then determine how many additional tasks to add based on depth.
resource "aws_cloudwatch_metric_alarm" "worker_pending_jobs" {
  alarm_name          = "${var.app_name}-worker-pending-jobs-${var.environment}"
  metric_name         = "PendingJobCount"
  namespace           = "Buddy360/Worker"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching" # no data = queue is empty = no scale-out

  alarm_actions = [aws_appautoscaling_policy.worker_pending_jobs.arn]

  tags = {
    Name = "${var.app_name}-worker-pending-jobs-${var.environment}"
  }
}

resource "aws_appautoscaling_policy" "worker_pending_jobs" {
  name               = "${var.app_name}-worker-pending-jobs-${var.environment}"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Average"

    # Threshold is 50 (alarm threshold); metric_interval bounds are relative to it.
    step_adjustment {
      metric_interval_lower_bound = 0 # 50–100 pending jobs
      metric_interval_upper_bound = 50
      scaling_adjustment          = 2
    }
    step_adjustment {
      metric_interval_lower_bound = 50 # 100–150 pending jobs
      metric_interval_upper_bound = 100
      scaling_adjustment          = 4
    }
    step_adjustment {
      metric_interval_lower_bound = 100 # >150 pending jobs
      scaling_adjustment          = 6
    }
  }
}

# Fires when PendingJobCount stays at or below 10 for 5 consecutive minutes,
# meaning the queue is drained and idle workers can be removed.
# treat_missing_data = "breaching" so a fully empty queue (no metric emitted)
# also triggers scale-in rather than keeping tasks alive unnecessarily.
resource "aws_cloudwatch_metric_alarm" "worker_pending_jobs_low" {
  alarm_name          = "${var.app_name}-worker-pending-jobs-low-${var.environment}"
  metric_name         = "PendingJobCount"
  namespace           = "Buddy360/Worker"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5 # 5 consecutive minutes below threshold before scaling in
  threshold           = 10
  comparison_operator = "LessThanOrEqualToThreshold"
  treat_missing_data  = "breaching" # no data = empty queue = scale in

  alarm_actions = [aws_appautoscaling_policy.worker_scale_in.arn]

  tags = {
    Name = "${var.app_name}-worker-pending-jobs-low-${var.environment}"
  }
}

# Scale-in step policy — removes one task at a time to avoid killing workers
# that are mid-job. One task per step is intentionally conservative; the
# 5-minute alarm window above already ensures the queue has been quiet before
# this fires.
resource "aws_appautoscaling_policy" "worker_scale_in" {
  name               = "${var.app_name}-worker-scale-in-${var.environment}"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300 # 5 minutes between scale-in steps
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_upper_bound = 0 # <= 10 pending jobs
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu_sustained" {
  alarm_name          = "${var.app_name}-worker-cpu-sustained-${var.environment}"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    ClusterName = aws_ecs_cluster.backend.name
    ServiceName = aws_ecs_service.worker.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name = "${var.app_name}-worker-cpu-sustained-${var.environment}"
  }
}
