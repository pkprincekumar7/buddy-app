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
  mock_resource "aws_service_discovery_service" {
    defaults = {
      arn = "arn:aws:servicediscovery:ap-south-1:111111111111:service/srv-0123456789abcdef"
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

# ── Cloud Map registration and the internal port (docs/auth-users-split.md, 13.2) ──

run "registered_service_with_an_internal_port" {
  command = apply

  variables {
    role               = "children"
    scaling_name       = "children"
    security_group_ids = ["sg-children", "sg-internal-callers"]
    internal_port      = 8001
    service_discovery  = { namespace_id = "ns-superpower-prod" }
    container = {
      name              = "children"
      image             = "repo/children:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-children-prod"
      log_stream_prefix = "children"
    }
    load_balancer = { target_group_arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:targetgroup/superpower-children-prod-abcd/0123456789abcdef", container_port = 8000 }
  }

  assert {
    condition = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].portMappings == [
      { containerPort = 8000, protocol = "tcp" },
      { containerPort = 8001, protocol = "tcp" },
    ]
    error_message = "The public port for the ALB, then the internal one."
  }
  assert {
    condition     = aws_service_discovery_service.this[0].name == "children" && one(one(aws_service_discovery_service.this[0].dns_config).dns_records).type == "A"
    error_message = "Registered as <role> with A records (task IPs)."
  }
  assert {
    condition     = one(aws_service_discovery_service.this[0].dns_config).routing_policy == "MULTIVALUE" && one(one(aws_service_discovery_service.this[0].dns_config).dns_records).ttl == 10
    error_message = "Multivalue answers with a 10-second TTL, so a stopped task drops out quickly."
  }
  assert {
    condition     = one(aws_service_discovery_service.this[0].dns_config).namespace_id == "ns-superpower-prod" && length(aws_service_discovery_service.this[0].health_check_custom_config) == 1
    error_message = "In the environment's namespace, with health reported by ECS (the container health check)."
  }
  assert {
    condition     = one(aws_ecs_service.this.service_registries).registry_arn == aws_service_discovery_service.this[0].arn && length(aws_ecs_service.this.load_balancer) == 1
    error_message = "The ECS service registers its tasks, and still sits behind the ALB."
  }
  assert {
    condition     = output.service_discovery_arn == aws_service_discovery_service.this[0].arn && output.service_discovery_name == "children" && output.internal_port == 8001
    error_message = "The registration is exposed for the callers' configuration."
  }
}

run "the_otel_collector_registers_on_4318_without_a_public_port" {
  command = apply

  variables {
    role               = "otel-collector"
    scaling_name       = "otel"
    security_group_ids = ["sg-otel"]
    internal_port      = 4318
    service_discovery  = { namespace_id = "ns-superpower-prod", name = "otel-collector", dns_ttl = 30 }
    container = {
      name              = "otel-collector"
      image             = "public.ecr.aws/aws-observability/aws-otel-collector:latest"
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-otel-collector-prod"
      log_stream_prefix = "otel"
    }
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].portMappings == [{ containerPort = 4318, protocol = "tcp" }]
    error_message = "Only the internal OTLP port; no ALB target."
  }
  assert {
    condition     = aws_service_discovery_service.this[0].name == "otel-collector" && one(one(aws_service_discovery_service.this[0].dns_config).dns_records).ttl == 30 && length(aws_ecs_service.this.load_balancer) == 0
    error_message = "A custom name and TTL; no load balancer."
  }
}

run "unregistered_service_has_no_cloud_map_entry" {
  command = apply

  variables {
    role               = "shared"
    scaling_name       = "shared"
    security_group_ids = ["sg-shared"]
    container = {
      name              = "shared"
      image             = "repo/shared:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-shared-prod"
      log_stream_prefix = "shared"
    }
  }

  assert {
    condition     = length(aws_service_discovery_service.this) == 0 && length(aws_ecs_service.this.service_registries) == 0
    error_message = "No service_discovery: nothing in Cloud Map."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].portMappings == [{ containerPort = 8000, protocol = "tcp" }]
    error_message = "Only the public port without internal_port."
  }
  assert {
    condition     = output.service_discovery_arn == null && output.service_discovery_name == null && output.internal_port == null
    error_message = "The outputs are null without a registration."
  }
}

run "registration_needs_an_internal_port" {
  command = plan

  variables {
    role               = "children"
    scaling_name       = "children"
    security_group_ids = ["sg-children"]
    service_discovery  = { namespace_id = "ns-superpower-prod" }
    container = {
      name              = "children"
      image             = "repo/children:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-children-prod"
      log_stream_prefix = "children"
    }
  }

  expect_failures = [aws_ecs_service.this]
}

run "the_internal_port_must_differ_from_the_public_one" {
  command = plan

  variables {
    role               = "children"
    scaling_name       = "children"
    security_group_ids = ["sg-children"]
    internal_port      = 8000
    container = {
      name              = "children"
      image             = "repo/children:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-children-prod"
      log_stream_prefix = "children"
    }
  }

  expect_failures = [aws_ecs_service.this]
}

run "registration_name_must_be_a_dns_label" {
  command = plan

  variables {
    role               = "children"
    scaling_name       = "children"
    security_group_ids = ["sg-children"]
    internal_port      = 8001
    service_discovery  = { namespace_id = "ns-superpower-prod", name = "Children_Service" }
    container = {
      name              = "children"
      image             = "repo/children:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-children-prod"
      log_stream_prefix = "children"
    }
  }

  expect_failures = [var.service_discovery]
}

run "registration_ttl_is_bounded" {
  command = plan

  variables {
    role               = "children"
    scaling_name       = "children"
    security_group_ids = ["sg-children"]
    internal_port      = 8001
    service_discovery  = { namespace_id = "ns-superpower-prod", dns_ttl = 3600 }
    container = {
      name              = "children"
      image             = "repo/children:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-children-prod"
      log_stream_prefix = "children"
    }
  }

  expect_failures = [var.service_discovery]
}

run "internal_port_must_be_a_tcp_port" {
  command = plan

  variables {
    role               = "children"
    scaling_name       = "children"
    security_group_ids = ["sg-children"]
    internal_port      = 70000
    container = {
      name              = "children"
      image             = "repo/children:latest"
      port              = 8000
      environment       = []
      secrets           = []
      log_group_name    = "/ecs/superpower-children-prod"
      log_stream_prefix = "children"
    }
  }

  expect_failures = [var.internal_port]
}
