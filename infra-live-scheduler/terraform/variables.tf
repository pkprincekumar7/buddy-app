variable "app_name" {
  description = "Application name — used as a prefix for all resource names"
  type        = string
}

variable "aws_region" {
  description = "AWS region where EventBridge Scheduler resources are provisioned"
  type        = string
  default     = "us-east-1"
}

variable "target_aws_regions" {
  description = "AWS regions passed to terraform-live-all.yml for application deployment; one start+stop schedule pair is created per region"
  type        = list(string)

  validation {
    condition     = length(var.target_aws_regions) > 0 && alltrue([for r in var.target_aws_regions : contains(["ap-south-1", "us-east-1", "eu-west-1"], r)])
    error_message = "target_aws_regions must be a non-empty list of valid regions: ap-south-1, us-east-1, eu-west-1."
  }
}

variable "environment" {
  description = "Deployment environment (dev, sbx, stg, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "sbx", "stg", "prod"], var.environment)
    error_message = "environment must be one of: dev, sbx, stg, prod."
  }
}

variable "github_repo_owner" {
  description = "GitHub repository owner (organisation or user)"
  type        = string
}

variable "github_repo_name" {
  description = "GitHub repository name"
  type        = string
}

variable "github_default_branch" {
  description = "Branch that EventBridge targets when triggering workflow_dispatch"
  type        = string
  default     = "main"
}

variable "github_workflow_file" {
  description = "Filename of the GitHub Actions workflow triggered by EventBridge via workflow_dispatch"
  type        = string
  default     = "terraform-live-all.yml"
}

variable "github_pat" {
  description = "GitHub PAT with repo + workflow scopes, sourced from GitHub Actions environment secret GIT_ACTIONS_PAT"
  type        = string
  sensitive   = true
}

variable "schedule_enabled" {
  description = "Enable or disable the EventBridge schedules; controlled via workflow input schedule_enabled, not tfvars."
  type        = bool
  default     = false
}

variable "start_schedule_expression" {
  description = "EventBridge cron for the daily start (6-field AWS cron, IST)"
  type        = string
  default     = "cron(0 14 * * ? *)" # 02:00 PM IST
}

variable "stop_schedule_expression" {
  description = "EventBridge cron for the daily stop (6-field AWS cron, IST)"
  type        = string
  default     = "cron(0 22 * * ? *)" # 10:00 PM IST
}

variable "schedule_timezone" {
  description = "IANA timezone for EventBridge schedule expressions (e.g. Asia/Kolkata, America/New_York)"
  type        = string
}
