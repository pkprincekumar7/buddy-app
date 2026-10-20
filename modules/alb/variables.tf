variable "app_name" {
  description = "Application name — prefix of every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment — suffix of every resource name."
  type        = string
}

variable "vpc_id" {
  description = "VPC the ALB, target group and security group live in."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets the ALB is placed in (one per AZ)."
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate for the HTTPS listener — must cover the internal ALB hostname."
  type        = string
}

variable "origin_verify_values" {
  description = "Accepted X-Origin-Verify header values (OR-matched): the current secret, plus the incoming one during a rotation. Requests without one of them get the listener's fixed 403."
  type        = list(string)
  sensitive   = true

  validation {
    condition     = length(var.origin_verify_values) > 0
    error_message = "At least one origin-verify value is required — otherwise the ALB forwards nothing."
  }
}

variable "targets" {
  description = <<-EOT
    HTTP services behind the ALB, keyed by service (services.tf) — one target
    group and one listener rule each.
      port              — container port (plain HTTP inside the VPC)
      path_patterns     — ALB path patterns this service owns ('*' wildcard).
                          Exactly one target leaves it empty: the catch-all.
      priority          — listener rule priority (1-49999, unique), required
                          when path_patterns is set; lower is evaluated first
      health_check_path — target group health check path
  EOT
  type = map(object({
    port              = number
    path_patterns     = optional(list(string), [])
    priority          = optional(number)
    health_check_path = optional(string, "/health")
  }))

  validation {
    condition     = length([for t in values(var.targets) : t if length(t.path_patterns) == 0]) == 1
    error_message = "Exactly one target must have no path_patterns (the catch-all for everything else)."
  }
  validation {
    condition = alltrue([
      for t in values(var.targets) : length(t.path_patterns) == 0 || (coalesce(t.priority, 0) >= 1 && coalesce(t.priority, 0) < 50000)
    ])
    error_message = "Every target with path_patterns needs a priority between 1 and 49999 (50000 is the catch-all's)."
  }
  validation {
    condition = length(distinct([for t in values(var.targets) : t.priority if length(t.path_patterns) > 0])) == length([
      for t in values(var.targets) : t if length(t.path_patterns) > 0
    ])
    error_message = "Listener rule priorities must be unique."
  }
  validation {
    condition     = alltrue([for k in keys(var.targets) : can(regex("^[a-z0-9-]+$", k))])
    error_message = "Target keys become target group names: lowercase letters, digits and hyphens only."
  }
}

variable "enable_access_logs" {
  description = "Write ALB access logs to access_logs_bucket (prefix alb-logs)."
  type        = bool
  default     = false
}

variable "access_logs_bucket" {
  description = "S3 bucket for ALB access logs. Required when enable_access_logs."
  type        = string
  default     = ""
}
