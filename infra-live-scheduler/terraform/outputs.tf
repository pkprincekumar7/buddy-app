output "github_pat_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the GitHub PAT for this environment"
  value       = aws_secretsmanager_secret.github_pat.arn
}

output "api_destination_arn" {
  description = "ARN of the EventBridge API destination pointing to GitHub"
  value       = aws_cloudwatch_event_api_destination.github_dispatch.arn
}

output "schedule_group_name" {
  description = "Name of the EventBridge Scheduler schedule group"
  value       = aws_scheduler_schedule_group.main.name
}

output "scheduler_role_arn" {
  description = "ARN of the IAM role used by EventBridge Scheduler"
  value       = aws_iam_role.scheduler.arn
}
