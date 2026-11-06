output "topic_arns" {
  description = "Each producing service's own topic ARN, keyed by service: its EVENTS_TOPIC_ARN, and the only one its task role may sns:Publish to."
  value       = { for k, t in aws_sns_topic.producer : k => t.arn }
}

output "queue_urls" {
  description = "Each consuming service's queue URL, keyed by service: its EVENTS_QUEUE_URL."
  value       = { for k, q in aws_sqs_queue.consumer : k => q.id }
}

output "queue_arns" {
  description = "Each consuming service's queue ARN, for its task role (sqs:ReceiveMessage, DeleteMessage, ChangeMessageVisibility)."
  value       = { for k, q in aws_sqs_queue.consumer : k => q.arn }
}

output "dlq_arns" {
  description = "Each consuming service's DLQ ARN, keyed by service."
  value       = { for k, q in aws_sqs_queue.dlq : k => q.arn }
}

output "subscriptions" {
  description = "Each \"<consumer>:<producer>\" subscription and the event types it takes: the plan common.events.topology.plan() prints, for comparing the two."
  value       = { for k, s in local.subscriptions : k => s.event_types }
}

output "key_arn" {
  description = "The topics' KMS key: each publisher's task role needs kms:GenerateDataKey and kms:Decrypt on it."
  value       = aws_kms_key.events.arn
}

output "prefix" {
  description = "\"<app>-<env>\": the services' events prefix (topic and queue names, the TopicArn check)."
  value       = local.prefix
}
