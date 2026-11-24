# The AWS mock for the per-environment tests (tests/envs): the same data and ARNs as
# tests/stack.tftest.hcl's, which the provider's ARN validation needs.

override_data {
  target = module.network.data.aws_availability_zones.available
  values = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
}
override_data {
  target = module.alb.data.aws_ec2_managed_prefix_list.cloudfront
  values = { id = "pl-cloudfront" }
}
mock_data "aws_iam_policy_document" {
  defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
}
mock_data "aws_caller_identity" {
  defaults = { account_id = "111111111111" }
}
mock_data "aws_ssm_parameter" {
  defaults = { value = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n" }
}

# The mock's random ARNs fail the provider's own ARN validation wherever one
# resource's ARN feeds another.
mock_resource "aws_lb" {
  defaults = { arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:loadbalancer/app/superpower-backend-alb-prod/0123456789abcdef" }
}
mock_resource "aws_lb_target_group" {
  defaults = { arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:targetgroup/superpower-backend-tg-prod/0123456789abcdef" }
}
mock_resource "aws_lb_listener" {
  defaults = { arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:listener/app/superpower-backend-alb-prod/0123456789abcdef/0123456789abcdef" }
}
mock_resource "aws_iam_role" {
  defaults = { arn = "arn:aws:iam::111111111111:role/test" }
}
mock_resource "aws_secretsmanager_secret" {
  defaults = { arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:superpower/prod/service-secrets-AbCdEf" }
}
mock_resource "aws_ssm_parameter" {
  defaults = { arn = "arn:aws:ssm:ap-south-1:111111111111:parameter/superpower/prod/backend/ap-south-1/service/internal_signing_key" }
}
mock_resource "aws_sns_topic" {
  defaults = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-events" }
}
mock_resource "aws_sqs_queue" {
  defaults = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-events" }
}
mock_resource "aws_kms_key" {
  defaults = { arn = "arn:aws:kms:ap-south-1:111111111111:key/00000000-0000-0000-0000-000000000000", key_id = "00000000-0000-0000-0000-000000000000" }
}
mock_resource "aws_appautoscaling_policy" {
  defaults = { arn = "arn:aws:autoscaling:ap-south-1:111111111111:scalingPolicy:00000000-0000-0000-0000-000000000000:resource/ecs/service/superpower-backend-prod/superpower-users-prod:policyName/test" }
}
mock_resource "aws_service_discovery_service" {
  defaults = { arn = "arn:aws:servicediscovery:ap-south-1:111111111111:service/srv-0123456789abcdef" }
}
mock_resource "aws_ecs_cluster" {
  defaults = { arn = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod", id = "arn:aws:ecs:ap-south-1:111111111111:cluster/superpower-backend-prod" }
}
mock_resource "aws_ecr_repository" {
  defaults = { repository_url = "111111111111.dkr.ecr.ap-south-1.amazonaws.com/superpower/prod/service" }
}
