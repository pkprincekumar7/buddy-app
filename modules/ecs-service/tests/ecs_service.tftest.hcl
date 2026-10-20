# terraform test — mock AWS provider: no credentials, nothing is created.
# Run from modules/ecs-service: terraform init && terraform test

mock_provider "aws" {
  # The mock's random ARNs fail the provider's own ARN validation where one
  # resource's ARN feeds another (scaling policy → alarm action).
  mock_resource "aws_appautoscaling_policy" {
    defaults = {
      arn = "arn:aws:autoscaling:ap-south-1:111111111111:scalingPolicy:00000000-0000-0000-0000-000000000000:resource/ecs/service/superpower-backend-prod/superpower-worker-prod:policyName/test"
    }
  }
}

variables {
  app_name               = "superpower"
  environment            = "prod"
  aws_region             = "ap-south-1"
  cpu                    = 4096
  memory                 = 8192
  execution_role_arn     = "arn:aws:iam::111111111111:role/exec"
  task_role_arn          = "arn:aws:iam::111111111111:role/task"
  cluster_id             = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod"
  cluster_name           = "superpower-backend-prod"
  desired_count          = 2
  enable_execute_command = false
  subnet_ids             = ["subnet-1", "subnet-2", "subnet-3"]
  min_capacity           = 2
  max_capacity           = 200
  alarm_topic_arn        = "arn:aws:sns:ap-south-1:111111111111:alerts"
}

run "api_like_service" {
  command = apply

  variables {
    role               = "backend"
    scaling_name       = "api"
    security_group_ids = ["sg-api"]
    container = {
      name              = "backend"
      image             = "repo/backend:latest"
      port              = 8000
      environment       = [{ name = "APP_ENV", value = "prod" }]
      secrets           = [{ name = "MONGODB_URI", valueFrom = "arn:secret:MONGODB_URI::" }]
      log_group_name    = "/ecs/superpower-backend-prod"
      log_stream_prefix = "backend"
      health_check = {
        command     = ["CMD-SHELL", "exit 0"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
    load_balancer                     = { target_group_arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:targetgroup/superpower-backend-tg-prod/0123456789abcdef", container_port = 8000 }
    health_check_grace_period_seconds = 90
    target_tracking_policies = {
      cpu          = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_in_cooldown = 300, scale_out_cooldown = 60 }
      alb-requests = { metric_type = "ALBRequestCountPerTarget", target_value = 1000, resource_label = "app/alb/1/targetgroup/tg/2", scale_in_cooldown = 300, scale_out_cooldown = 60 }
    }
    sustained_alarms        = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    immediate_alarms        = { cpu = "CPUUtilization", memory = "MemoryUtilization" }
    display_name            = "API"
    enable_sustained_alarms = true
    enable_adot_sidecar     = true
  }

  assert {
    condition     = aws_ecs_task_definition.this.family == "superpower-backend-prod" && aws_ecs_service.this.name == "superpower-backend-prod"
    error_message = "Family and service name are <app>-<role>-<env>."
  }
  assert {
    condition     = aws_ecs_task_definition.this.tags.Name == "superpower-backend-task-prod" && aws_ecs_service.this.tags.Name == "superpower-backend-service-prod"
    error_message = "Name tags must match the pre-module ones."
  }
  assert {
    condition = jsondecode(aws_ecs_task_definition.this.container_definitions)[0] == {
      name             = "backend"
      image            = "repo/backend:latest"
      essential        = true
      portMappings     = [{ containerPort = 8000, protocol = "tcp" }]
      environment      = [{ name = "APP_ENV", value = "prod" }]
      secrets          = [{ name = "MONGODB_URI", valueFrom = "arn:secret:MONGODB_URI::" }]
      logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = "/ecs/superpower-backend-prod", "awslogs-region" = "ap-south-1", "awslogs-stream-prefix" = "backend" } }
      healthCheck      = { command = ["CMD-SHELL", "exit 0"], interval = 30, timeout = 5, retries = 3, startPeriod = 60 }
    }
    error_message = "API container JSON must match the pre-module one exactly — no command key, no nulls."
  }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 2 && jsondecode(aws_ecs_task_definition.this.container_definitions)[1].name == "aws-otel-collector" && jsondecode(aws_ecs_task_definition.this.container_definitions)[1].logConfiguration.options["awslogs-stream-prefix"] == "adot"
    error_message = "ADOT sidecar is appended when enabled."
  }
  assert {
    condition     = one(aws_ecs_service.this.load_balancer).container_name == "backend" && one(aws_ecs_service.this.load_balancer).container_port == 8000 && aws_ecs_service.this.health_check_grace_period_seconds == 90
    error_message = "Load balancer and grace period are wired."
  }
  assert {
    condition     = one(aws_ecs_service.this.network_configuration).assign_public_ip == false
    error_message = "Tasks never get a public IP."
  }
  assert {
    condition     = aws_appautoscaling_target.this.resource_id == "service/superpower-backend-prod/superpower-backend-prod" && aws_appautoscaling_target.this.max_capacity == 200
    error_message = "Autoscaling target points at the service."
  }
  assert {
    condition     = aws_appautoscaling_policy.target_tracking["alb-requests"].name == "superpower-api-alb-requests-prod" && one(one(aws_appautoscaling_policy.target_tracking["alb-requests"].target_tracking_scaling_policy_configuration).predefined_metric_specification).resource_label == "app/alb/1/targetgroup/tg/2"
    error_message = "Policy names are <app>-<scaling_name>-<key>-<env>; ALB policy carries its resource label."
  }
  assert {
    condition     = keys(aws_cloudwatch_metric_alarm.sustained) == ["cpu", "memory"] && aws_cloudwatch_metric_alarm.sustained["memory"].alarm_name == "superpower-api-memory-sustained-prod" && aws_cloudwatch_metric_alarm.sustained["cpu"].dimensions.ServiceName == "superpower-backend-prod"
    error_message = "Sustained alarms are named and scoped to the service."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.immediate["memory"].alarm_name == "superpower-api-memory-high-prod" && aws_cloudwatch_metric_alarm.immediate["cpu"].alarm_description == "API ECS CPU above 85%." && aws_cloudwatch_metric_alarm.immediate["cpu"].period == 60
    error_message = "Immediate alarms match the pre-module names and descriptions."
  }
}

run "worker_like_service" {
  command = apply

  variables {
    role               = "worker"
    scaling_name       = "worker"
    security_group_ids = ["sg-worker"]
    container = {
      name              = "worker"
      image             = "repo/backend:latest"
      command           = ["python", "worker.py"]
      environment       = [{ name = "APP_ENV", value = "prod" }]
      secrets           = []
      log_group_name    = "/ecs/superpower-worker-prod"
      log_stream_prefix = "worker"
    }
    target_tracking_policies = {
      cpu = { metric_type = "ECSServiceAverageCPUUtilization", target_value = 60, scale_out_cooldown = 60, disable_scale_in = true }
    }
    step_scaling_policies = {
      pending-jobs = {
        adjustment_type         = "ChangeInCapacity"
        cooldown                = 60
        metric_aggregation_type = "Average"
        steps = [
          { lower_bound = 0, upper_bound = 50, adjustment = 2 },
          { lower_bound = 100, adjustment = 6 },
        ]
        alarm = {
          metric_name = "PendingJobCount", namespace = "Superpower/Worker", statistic = "Average", period = 60, evaluation_periods = 1
          threshold   = 50, comparison_operator = "GreaterThanThreshold", treat_missing_data = "notBreaching", dimensions = { Environment = "prod" }
        }
      }
      scale-in = {
        adjustment_type         = "ChangeInCapacity"
        cooldown                = 300
        metric_aggregation_type = "Average"
        steps                   = [{ upper_bound = 0, adjustment = -1 }]
        alarm = {
          name_suffix        = "pending-jobs-low", metric_name = "PendingJobCount", namespace = "Superpower/Worker", statistic = "Average", period = 60
          evaluation_periods = 5, threshold = 10, comparison_operator = "LessThanOrEqualToThreshold", treat_missing_data = "notBreaching", dimensions = { Environment = "prod" }
        }
      }
    }
    sustained_alarms        = { cpu = "CPUUtilization" }
    enable_sustained_alarms = false
  }

  assert {
    condition = jsondecode(aws_ecs_task_definition.this.container_definitions) == [{
      name             = "worker"
      image            = "repo/backend:latest"
      essential        = true
      command          = ["python", "worker.py"]
      environment      = [{ name = "APP_ENV", value = "prod" }]
      secrets          = []
      logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = "/ecs/superpower-worker-prod", "awslogs-region" = "ap-south-1", "awslogs-stream-prefix" = "worker" } }
    }]
    error_message = "Worker container JSON: command, no portMappings, no healthCheck, no sidecar."
  }
  assert {
    condition     = length(aws_ecs_service.this.load_balancer) == 0 && aws_ecs_service.this.health_check_grace_period_seconds == null
    error_message = "A service without load_balancer has no LB block or grace period."
  }
  assert {
    condition     = one(aws_appautoscaling_policy.target_tracking["cpu"].target_tracking_scaling_policy_configuration).disable_scale_in == true
    error_message = "Worker CPU policy leaves scale-in to the step policy."
  }
  assert {
    condition     = aws_appautoscaling_policy.step["scale-in"].name == "superpower-worker-scale-in-prod" && aws_cloudwatch_metric_alarm.step["scale-in"].alarm_name == "superpower-worker-pending-jobs-low-prod" && aws_cloudwatch_metric_alarm.step["pending-jobs"].alarm_name == "superpower-worker-pending-jobs-prod"
    error_message = "Step policy and alarm names match the pre-module ones (alarm name_suffix override)."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.step["scale-in"].alarm_actions == toset([aws_appautoscaling_policy.step["scale-in"].arn])
    error_message = "Each step alarm triggers its own policy."
  }
  assert {
    condition     = length(one(aws_appautoscaling_policy.step["pending-jobs"].step_scaling_policy_configuration).step_adjustment) == 2
    error_message = "Every step is rendered."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.sustained) == 0
    error_message = "Sustained alarms are off unless enable_sustained_alarms."
  }
}

# -- ADOT sidecar vs task size ------------------------------------------------
# The sidecar reserves 256 CPU / 512 MiB, so a task carrying it needs at least
# 512 / 1024. dev/sbx run 256 / 512 tasks with the sidecar off.

run "smallest_task_without_sidecar_is_fine" {
  command = plan

  variables {
    role                = "admin"
    scaling_name        = "admin"
    security_group_ids  = ["sg-admin"]
    cpu                 = 256
    memory              = 512
    enable_adot_sidecar = false
    container = {
      name              = "admin"
      image             = "repo/backend:latest"
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower/admin/dev"
      log_stream_prefix = "admin"
    }
  }

  assert {
    condition     = aws_ecs_task_definition.this.cpu == "256" && aws_ecs_task_definition.this.memory == "512" && length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 1
    error_message = "A 256 / 512 task without the sidecar has just the app container."
  }
}

run "sidecar_on_the_smallest_task_is_refused" {
  command = plan

  variables {
    role                = "admin"
    scaling_name        = "admin"
    security_group_ids  = ["sg-admin"]
    cpu                 = 256
    memory              = 512
    enable_adot_sidecar = true
    container = {
      name              = "admin"
      image             = "repo/backend:latest"
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower/admin/dev"
      log_stream_prefix = "admin"
    }
  }

  expect_failures = [aws_ecs_task_definition.this]
}

run "sidecar_needs_enough_memory_too" {
  command = plan

  variables {
    role                = "admin"
    scaling_name        = "admin"
    security_group_ids  = ["sg-admin"]
    cpu                 = 512
    memory              = 512
    enable_adot_sidecar = true
    container = {
      name              = "admin"
      image             = "repo/backend:latest"
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower/admin/dev"
      log_stream_prefix = "admin"
    }
  }

  expect_failures = [aws_ecs_task_definition.this]
}

run "sidecar_fits_from_512_1024" {
  command = plan

  variables {
    role                = "admin"
    scaling_name        = "admin"
    security_group_ids  = ["sg-admin"]
    cpu                 = 512
    memory              = 1024
    enable_adot_sidecar = true
    container = {
      name              = "admin"
      image             = "repo/backend:latest"
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower/admin/stg"
      log_stream_prefix = "admin"
    }
  }

  assert {
    condition     = [for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.name] == ["admin", "aws-otel-collector"]
    error_message = "512 / 1024 is the smallest task that takes the sidecar."
  }
}
