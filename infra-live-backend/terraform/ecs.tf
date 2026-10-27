# ---------------------------------------------------------------------------
# ECS — Fargate cluster plus one service per entry in local.services
# (services.tf), each built from ../../modules/ecs-service (TF-01): task
# definition, service, autoscaling and alarms.
#
# Tasks run in PRIVATE subnets with assign_public_ip = false. Outbound
# internet access goes via NAT Gateway. In stg/prod, AWS service traffic
# (ECR, Secrets Manager, CloudWatch Logs, X-Ray) routes via VPC Interface
# Endpoints and never reaches NAT. In dev/sbx (no Interface Endpoints),
# all outbound traffic including AWS service calls traverses NAT.
#
# Task definitions use the service's repository at :latest as the initial image
# (the collector: var.otel_collector_image). The deploy workflow
# (deploy-live-backend.yml) manages image updates; Terraform is not involved
# after the initial apply (ignore_changes = [task_definition, desired_count]
# in the module).
#
# A runtime with an internal port registers in Cloud Map (service_discovery.tf),
# and every service runtime joins the internal-callers group (13.2).
# ---------------------------------------------------------------------------

# Container Insights is per environment (var.enable_container_insights): on in
# prod, off in dev/sbx/stg. Nothing in this stack reads its ECS/ContainerInsights
# metrics: autoscaling, alarms and the dashboard use the free AWS/ECS and
# AWS/ApplicationELB metrics, which ECS publishes either way.
#trivy:ignore:AVD-AWS-0034
resource "aws_ecs_cluster" "backend" {
  #checkov:skip=CKV_AWS_65:Container Insights is set per environment via var.enable_container_insights — on in prod; off in dev/sbx/stg, which only a few testers use and where autoscaling, alarms and the dashboard rely on the free AWS/ECS metrics (~$34/month per cluster saved)
  name = "${var.app_name}-backend-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }

  tags = {
    Name = "${var.app_name}-backend-cluster-${var.environment}"
  }
}

resource "aws_ecs_cluster_capacity_providers" "backend" {
  cluster_name       = aws_ecs_cluster.backend.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

module "service" {
  source   = "../../modules/ecs-service"
  for_each = local.services

  app_name     = var.app_name
  environment  = var.environment
  aws_region   = var.aws_region
  role         = each.key
  scaling_name = each.value.scaling_name
  display_name = each.value.display_name

  cpu                = each.value.cpu
  memory             = each.value.memory
  execution_role_arn = aws_iam_role.execution[each.key].arn
  task_role_arn      = aws_iam_role.task[each.key].arn

  container = {
    name        = each.key
    image       = each.value.image != null ? each.value.image : "${aws_ecr_repository.service[each.value.service].repository_url}:latest"
    command     = each.value.command
    port        = try(each.value.http.port, null)
    environment = each.value.environment
    # "<secret ARN>:<JSON key>::" — the ECS agent injects each key of the
    # service's secret JSON as an env var, plus the service-token signing key.
    secrets = concat(
      [for k in each.value.secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.service[each.value.service].arn}:${k}::" }],
      each.value.service != null ? [{ name = "INTERNAL_SIGNING_KEY", valueFrom = aws_ssm_parameter.signing_key[each.value.service].arn }] : [],
    )
    log_group_name    = aws_cloudwatch_log_group.service[each.key].name
    log_stream_prefix = each.key
    health_check      = each.value.health_check
  }

  cluster_id             = aws_ecs_cluster.backend.id
  cluster_name           = aws_ecs_cluster.backend.name
  desired_count          = each.value.desired_count
  enable_execute_command = var.enable_execute_command
  subnet_ids             = module.network.private_subnet_ids
  security_group_ids = concat(
    [aws_security_group.service[each.key].id],
    each.value.service != null ? [aws_security_group.internal_callers.id] : [],
  )

  internal_port     = each.value.internal_port
  service_discovery = each.value.internal_port != null ? { namespace_id = aws_service_discovery_private_dns_namespace.internal.id, name = each.value.service != null ? each.value.service : each.key } : null

  load_balancer                     = each.value.http != null ? { target_group_arn = module.alb.target_group_arns[each.key], container_port = each.value.http.port } : null
  health_check_grace_period_seconds = try(each.value.http.health_check_grace_period_seconds, null)

  min_capacity = each.value.min_capacity
  max_capacity = each.value.max_capacity
  # An ALBRequestCountPerTarget policy tracks this service's own target group.
  # Filled in here, not in services.tf: the ALB's targets come from
  # local.services, so referencing its outputs there would be a cycle.
  target_tracking_policies = {
    for name, p in each.value.target_tracking_policies : name => merge(p, {
      resource_label = p.metric_type == "ALBRequestCountPerTarget" ? "${module.alb.arn_suffix}/${module.alb.target_group_arn_suffixes[each.key]}" : null
    })
  }
  step_scaling_policies = each.value.step_scaling_policies

  sustained_alarms        = each.value.sustained_alarms
  immediate_alarms        = each.value.immediate_alarms
  enable_sustained_alarms = var.enable_all_alarms
  alarm_topic_arn         = aws_sns_topic.alerts.arn

  # An HTTP service registers with the target group, which must already be
  # attached to the HTTPS listener.
  depends_on = [module.alb]
}
