# The AWS mock for the per-environment tests (tests/envs): the ARNs the provider's
# validation needs.

mock_resource "aws_lambda_function" {
  defaults = { arn = "arn:aws:lambda:us-east-1:111111111111:function:dispatcher", function_name = "dispatcher" }
}
mock_resource "aws_sns_topic" {
  defaults = { arn = "arn:aws:sns:us-east-1:111111111111:scheduler-alerts" }
}
mock_resource "aws_iam_role" {
  defaults = { arn = "arn:aws:iam::111111111111:role/test" }
}
mock_resource "aws_secretsmanager_secret" {
  defaults = { arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:github-actions-pat-AbCdEf" }
}
mock_resource "aws_cloudwatch_log_group" {
  defaults = { arn = "arn:aws:logs:us-east-1:111111111111:log-group:/superpower/test/scheduler/github-dispatcher" }
}
