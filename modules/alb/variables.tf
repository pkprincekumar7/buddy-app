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
    group each.
      port              — container port (plain HTTP inside the VPC)
      path_patterns     — ALB path patterns this service owns ('*' wildcard,
                          also mid-path: /api/v1/children/*/onboarding*).
                          At most one target leaves it empty: the catch-all.
                          With no catch-all, unknown paths get a fixed 404.
                          Leave empty on every target when using routes.
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

  # The checks that also read var.routes are preconditions on the target groups
  # (main.tf): two variables' validations can't refer to each other.
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

variable "routes" {
  description = <<-EOT
    Path rules, when a service needs several (docs/auth-users-split.md, 13.1):
    shared has /api/v1/speech/* and /api/v1/downloads/* at 130 and /api/health
    at 140. Mirrors shared/service-routes.json, which the stack reads. There's no
    catch-all: an unknown path gets the fixed 404 at priority 50000.
      priority      — 1-49999, unique; lower is evaluated first
      target        — a key of targets
      path_patterns — 1-3 ALB path patterns
  EOT
  type = list(object({
    priority      = number
    target        = string
    path_patterns = list(string)
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.routes : r.priority >= 1 && r.priority < 50000 && floor(r.priority) == r.priority])
    error_message = "Route priorities must be whole numbers from 1 to 49999 (50000 is the fixed 404)."
  }
  validation {
    condition     = length(distinct([for r in var.routes : r.priority])) == length(var.routes)
    error_message = "Route priorities must be unique."
  }
  validation {
    condition     = alltrue([for r in var.routes : contains(keys(var.targets), r.target)])
    error_message = "Every route's target must be a key of targets."
  }
  validation {
    condition     = alltrue([for r in var.routes : length(r.path_patterns) >= 1 && length(r.path_patterns) <= 3])
    error_message = "Each route has 1-3 path patterns (AWS allows 5 condition values per rule; 2 go to X-Origin-Verify)."
  }
}

variable "deregistration_delay_seconds" {
  description = "How long the ALB waits for a deregistering target's in-flight requests to finish (it sends it no new ones, and finishes sooner once none are left). Set it a little above the longest request the services serve. AWS's default is 300 s, which every rolling deploy can wait through for old tasks."
  type        = number
  default     = 300

  validation {
    condition     = var.deregistration_delay_seconds >= 0 && var.deregistration_delay_seconds <= 3600 && floor(var.deregistration_delay_seconds) == var.deregistration_delay_seconds
    error_message = "deregistration_delay_seconds must be a whole number of seconds from 0 to 3600."
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
