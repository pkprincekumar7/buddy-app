variable "app_name" {
  description = "Application name — prefix of every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment. Topics and queues are \"<app>-<env>-<service>-events\" (the prefix the services' TopicArn check expects, EVENTS prefix in common.events)."
  type        = string
}

variable "catalogue_path" {
  description = "The event catalogue: producers, consumers and event types (backend/common/events/catalogue.json). The same file the services check every message against, so the two can't drift."
  type        = string
  default     = null
}

variable "services" {
  description = "The services this stack deploys. Topics, queues and subscriptions are made only for events between them; null (the default) takes every service in the catalogue."
  type        = list(string)
  default     = null
}

variable "queue_visibility_timeout_seconds" {
  description = "How long a received message stays hidden while its handler runs; it comes back after this if the handler fails. Set above the slowest handler."
  type        = number
  default     = 60

  validation {
    condition     = var.queue_visibility_timeout_seconds >= 0 && var.queue_visibility_timeout_seconds <= 43200
    error_message = "queue_visibility_timeout_seconds must be 0-43200 (12 hours)."
  }
}

variable "queue_retention_seconds" {
  description = "How long an unconsumed message is kept in a service's queue (AWS default 4 days)."
  type        = number
  default     = 345600

  validation {
    condition     = var.queue_retention_seconds >= 60 && var.queue_retention_seconds <= 1209600
    error_message = "queue_retention_seconds must be 60-1209600 (14 days)."
  }
}

variable "max_receive_count" {
  description = "Receives before a message moves to the DLQ (7.2: 5)."
  type        = number
  default     = 5

  validation {
    condition     = var.max_receive_count >= 1 && var.max_receive_count <= 1000
    error_message = "max_receive_count must be 1-1000."
  }
}

variable "enable_alarms" {
  description = "Create the DLQ-depth and oldest-message-age alarms (15.5); the root's enable_all_alarms."
  type        = bool
  default     = false
}

variable "alarm_topic_arn" {
  description = "SNS topic the alarms notify (alarm and OK). Required when enable_alarms."
  type        = string
  default     = null
}

variable "oldest_message_age_threshold_seconds" {
  description = "Alarm when a service's queue holds a message older than this: its consumer is down or stuck (15.5)."
  type        = number
  default     = 600
}
