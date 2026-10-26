variable "app_name" {
  description = "Application name — prefix of every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment — suffix of every resource name."
  type        = string
}

variable "aws_region" {
  description = "Region for the awslogs driver."
  type        = string
}

variable "role" {
  description = "Service role in resource names: task family and service are \"<app>-<role>-<env>\", tags \"<app>-<role>-task-<env>\" / \"<app>-<role>-service-<env>\" (e.g. \"backend\", \"worker\")."
  type        = string
}

variable "scaling_name" {
  description = "Name used in autoscaling policy and alarm names: \"<app>-<scaling_name>-<policy>-<env>\" (e.g. \"api\", \"worker\")."
  type        = string
}

# -- Task definition ------------------------------------------------------------

variable "cpu" {
  description = "Task CPU units."
  type        = number
}

variable "memory" {
  description = "Task memory (MiB)."
  type        = number
}

variable "execution_role_arn" {
  description = "ECS task execution role (image pull, logs, Secrets Manager)."
  type        = string
}

variable "task_role_arn" {
  description = "Role the application code runs as."
  type        = string
}

variable "container" {
  description = "The main container. `command`, `port` and `health_check` are left out of the task definition entirely when null."
  type = object({
    name              = string
    image             = string
    command           = optional(list(string))
    port              = optional(number)
    environment       = list(object({ name = string, value = string }))
    secrets           = list(object({ name = string, valueFrom = string }))
    log_group_name    = string
    log_stream_prefix = string
    health_check = optional(object({
      command     = list(string)
      interval    = number
      timeout     = number
      retries     = number
      startPeriod = number
    }))
  })
}

variable "enable_adot_sidecar" {
  description = "Add the AWS Distro for OpenTelemetry collector sidecar (X-Ray traces, CloudWatch metrics). Logs to the same group with stream prefix \"adot\"."
  type        = bool
  default     = false
}

# -- Service ----------------------------------------------------------------------

variable "cluster_id" {
  description = "ECS cluster ID."
  type        = string
}

variable "cluster_name" {
  description = "ECS cluster name (autoscaling resource ID and alarm dimensions)."
  type        = string
}

variable "desired_count" {
  description = "Initial task count. Ignored after creation — deploys and autoscaling own it."
  type        = number
}

variable "enable_execute_command" {
  description = "Enable ECS Exec."
  type        = bool
}

variable "subnet_ids" {
  description = "Private subnets the tasks run in."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security groups for the tasks."
  type        = list(string)
}

variable "load_balancer" {
  description = "Target group to register the main container with, or null for a service with no endpoints (the worker)."
  type = object({
    target_group_arn = string
    container_port   = number
  })
  default = null
}

variable "internal_port" {
  description = "A second container port for internal traffic, reached through Cloud Map rather than the ALB: 8001 for a service's /internal/* API, 4318 for the OpenTelemetry collector (docs/auth-users-split.md, 13.2, 15.5). Null for none."
  type        = number
  default     = null

  validation {
    condition     = var.internal_port == null || (var.internal_port >= 1 && var.internal_port <= 65535 && floor(coalesce(var.internal_port, 0)) == coalesce(var.internal_port, 0))
    error_message = "internal_port must be a TCP port (1-65535)."
  }
}

variable "service_discovery" {
  description = <<-EOT
    Register each task's IP in Cloud Map (13.2), or null for a service with no
    internal endpoints (workers, shared). Callers resolve
    "<name>.<namespace>" and get up to 8 healthy task IPs (multivalue A records);
    only tasks whose container health check passes are answered.
      namespace_id — the private DNS namespace ({app}-{env}.internal, 2.5)
      name         — the DNS label; defaults to role
      dns_ttl      — seconds; 10 so a stopped task drops out quickly
  EOT
  type = object({
    namespace_id = string
    name         = optional(string)
    dns_ttl      = optional(number, 10)
  })
  default = null

  validation {
    condition     = var.service_discovery == null || can(regex("^[a-z][a-z0-9-]{0,62}$", coalesce(try(var.service_discovery.name, null), "x")))
    error_message = "service_discovery.name must be a DNS label: lowercase letters, digits and hyphens."
  }
  validation {
    condition     = var.service_discovery == null || (try(var.service_discovery.dns_ttl, 10) >= 1 && try(var.service_discovery.dns_ttl, 10) <= 300)
    error_message = "service_discovery.dns_ttl must be 1-300 seconds."
  }
}

variable "health_check_grace_period_seconds" {
  description = "Grace period before load balancer health checks count. Only meaningful with load_balancer."
  type        = number
  default     = null
}

# -- Autoscaling ------------------------------------------------------------------

variable "min_capacity" {
  description = "Autoscaling minimum task count."
  type        = number
}

variable "max_capacity" {
  description = "Autoscaling maximum task count."
  type        = number
}

variable "target_tracking_policies" {
  description = "Target-tracking policies, keyed by the name part in \"<app>-<scaling_name>-<key>-<env>\" (e.g. \"cpu\", \"memory\", \"alb-requests\")."
  type = map(object({
    metric_type        = string
    target_value       = number
    resource_label     = optional(string)
    scale_in_cooldown  = optional(number)
    scale_out_cooldown = optional(number)
    disable_scale_in   = optional(bool)
  }))
  default = {}
}

variable "step_scaling_policies" {
  description = "Step-scaling policies, each driven by its own CloudWatch alarm. Keyed by the name part of the policy; the alarm uses alarm.name_suffix if set, else the same key."
  type = map(object({
    adjustment_type         = string
    cooldown                = number
    metric_aggregation_type = string
    steps = list(object({
      lower_bound = optional(number)
      upper_bound = optional(number)
      adjustment  = number
    }))
    alarm = object({
      name_suffix         = optional(string)
      metric_name         = string
      namespace           = string
      statistic           = string
      period              = number
      evaluation_periods  = number
      threshold           = number
      comparison_operator = string
      treat_missing_data  = string
      dimensions          = map(string)
    })
  }))
  default = {}
}

# -- Alerting ---------------------------------------------------------------------

variable "sustained_alarms" {
  description = "AWS/ECS metrics to alert on when above 85% for 3×5 minutes, keyed by the name part in \"<app>-<scaling_name>-<key>-sustained-<env>\" (e.g. { cpu = \"CPUUtilization\" }). Created only when enable_sustained_alarms."
  type        = map(string)
  default     = {}
}

variable "immediate_alarms" {
  description = "AWS/ECS metrics to alert on as soon as one 1-minute datapoint is above 85%, keyed by the name part in \"<app>-<scaling_name>-<key>-high-<env>\" (e.g. { cpu = \"CPUUtilization\" }). Faster than sustained_alarms, for dashboards and incident response. Created only when enable_sustained_alarms."
  type        = map(string)
  default     = {}
}

variable "display_name" {
  description = "Human-readable service name for alarm descriptions (e.g. \"API\", \"Worker\")."
  type        = string
  default     = null
}

variable "enable_sustained_alarms" {
  description = "Create the sustained_alarms and immediate_alarms (the root's enable_all_alarms)."
  type        = bool
  default     = false
}

variable "alarm_topic_arn" {
  description = "SNS topic the sustained alarms notify (alarm and OK)."
  type        = string
  default     = null
}
