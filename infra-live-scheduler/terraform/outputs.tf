output "github_pat_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the GitHub PAT for this environment"
  value       = aws_secretsmanager_secret.github_pat.arn
}

output "lambda_function_arn" {
  description = "ARN of the Lambda dispatcher function"
  value       = aws_lambda_function.dispatcher.arn
}

output "lambda_function_name" {
  description = "Name of the Lambda dispatcher function"
  value       = aws_lambda_function.dispatcher.function_name
}

output "schedule_group_name" {
  description = "Name of the EventBridge Scheduler schedule group"
  value       = aws_scheduler_schedule_group.main.name
}

output "scheduler_role_arn" {
  description = "ARN of the IAM role used by EventBridge Scheduler"
  value       = aws_iam_role.scheduler.arn
}
