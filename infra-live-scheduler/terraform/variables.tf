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
  description = "The complete set of AWS regions passed to terraform-live-all.yml on every scheduled run. Exactly one start+stop schedule pair is created (not one per region) — terraform-live-all.yml's backend_regions must always receive the full intended set in a single dispatch, since infra-live-edge is one shared distribution per environment and a partial set would make it destroy whichever regions were left out. Controlled via workflow input target_aws_regions, not tfvars. Required — no default, so a run that doesn't pass it (TF_VAR_target_aws_regions) fails instead of silently assuming a region."
  type        = list(string)

  validation {
    condition     = length(var.target_aws_regions) > 0 && alltrue([for r in var.target_aws_regions : contains(keys(jsondecode(file("${path.module}/../../shared/routing.json")).regions), r)])
    error_message = "target_aws_regions must be a non-empty list of shared/routing.json's regions: ${join(", ", keys(jsondecode(file("${path.module}/../../shared/routing.json")).regions))}."
  }

  # An environment in routing.json's served_from has that one backend region (DEC-01), as
  # infra-live-backend and infra-live-edge require: caught here, not at the scheduled run.
  validation {
    condition = (
      lookup(lookup(jsondecode(file("${path.module}/../../shared/routing.json")), "served_from", {}), var.environment, null) == null
      || (length(var.target_aws_regions) == 1 && var.target_aws_regions[0] == lookup(lookup(jsondecode(file("${path.module}/../../shared/routing.json")), "served_from", {}), var.environment, ""))
    )
    error_message = "${var.environment} is served from one region only (shared/routing.json served_from, DEC-01): target_aws_regions must be just that region."
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
  description = "Fine-grained GitHub token for this repository only, Actions: Read and write (SEC-03), sourced from the GitHub Actions environment secret GIT_ACTIONS_PAT"
  type        = string
  sensitive   = true
}

variable "schedule_enabled" {
  description = "Enable or disable the EventBridge schedules; controlled via workflow input schedule_enabled, not tfvars."
  type        = bool
  default     = false

  # The stop schedule runs a full destroy of the environment every night —
  # never acceptable for prod. (Cross-variable validation needs Terraform >= 1.9.)
  validation {
    condition     = !(var.schedule_enabled && var.environment == "prod")
    error_message = "schedule_enabled must be false for prod: the stop schedule destroys the whole environment nightly."
  }
}

variable "start_schedule_expression" {
  description = "EventBridge cron for the daily start (6-field AWS cron, IST)"
  type        = string
  default     = "cron(0 15 * * ? *)" # 03:00 PM IST
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

variable "enable_alarms" {
  description = "Email OPS_EMAIL when the GitHub dispatcher fails: an alarm on its Errors and a failure destination with the failed event (SCH-01). true on stg (prod can't be scheduled)."
  type        = bool
  default     = false
}

variable "ops_email" {
  description = "Operator email for the scheduler's alert topic (the OPS_EMAIL GitHub environment variable). Must be set when enable_alarms = true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_alarms || length(var.ops_email) > 0
    error_message = "ops_email must be set when enable_alarms = true (the OPS_EMAIL GitHub environment variable)."
  }
}

variable "repository" {
  description = "The GitHub repository (owner/name) this stack is applied from, for the Repo default tag (L2). The workflows pass github.repository."
  type        = string
  default     = ""
}
