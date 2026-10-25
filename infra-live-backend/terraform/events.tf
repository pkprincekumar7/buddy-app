# ---------------------------------------------------------------------------
# Events — SNS topics, SQS queues, DLQs and subscriptions from the event
# catalogue (../../modules/events, docs/auth-users-split.md 7.2)
#
# One topic per producing service and one queue per consuming service, in this
# region, for the services in local.split_services. The workers get their own topic's ARN and queue's URL (services.tf), and
# their task roles may publish to and consume from only those (iam.tf). The DLQ
# and message-age alarms follow enable_all_alarms.
# ---------------------------------------------------------------------------

module "events" {
  source = "../../modules/events"

  app_name    = var.app_name
  environment = var.environment

  # The catalogue also holds hello's demo event; only the split's services here.
  services = local.split_services

  # A failed handler's message comes back after this; above the slowest handler.
  queue_visibility_timeout_seconds = 60

  enable_alarms   = var.enable_all_alarms
  alarm_topic_arn = aws_sns_topic.alerts.arn
}
