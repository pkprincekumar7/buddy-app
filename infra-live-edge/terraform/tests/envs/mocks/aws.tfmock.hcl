# The AWS mock for the per-environment tests (tests/envs), used by both the default and
# the us_east_1 provider: lookups and the ARNs the provider's validation needs.

mock_data "aws_s3_bucket" {
  defaults = { bucket_regional_domain_name = "bucket.s3.us-east-1.amazonaws.com" }
}
mock_data "aws_ssm_parameter" {
  defaults = { value = "superpower-internal-test.example.com" }
}
mock_data "aws_caller_identity" {
  defaults = { account_id = "111111111111" }
}
mock_resource "aws_iam_role" {
  defaults = { arn = "arn:aws:iam::111111111111:role/test" }
}
mock_resource "aws_lambda_function" {
  defaults = { arn = "arn:aws:lambda:us-east-1:111111111111:function:jwt", qualified_arn = "arn:aws:lambda:us-east-1:111111111111:function:jwt:1" }
}
mock_resource "aws_cloudfront_function" {
  defaults = { arn = "arn:aws:cloudfront::111111111111:function/spa" }
}
mock_resource "aws_cloudfront_distribution" {
  defaults = { arn = "arn:aws:cloudfront::111111111111:distribution/E123", id = "E123", domain_name = "d123.cloudfront.net" }
}
mock_resource "aws_wafv2_web_acl" {
  defaults = { arn = "arn:aws:wafv2:us-east-1:111111111111:global/webacl/test/00000000" }
}
mock_resource "aws_kinesis_firehose_delivery_stream" {
  defaults = { arn = "arn:aws:firehose:us-east-1:111111111111:deliverystream/aws-waf-logs-test" }
}
mock_resource "aws_sns_topic" {
  defaults = { arn = "arn:aws:sns:us-east-1:111111111111:edge-alerts" }
}
