# ---------------------------------------------------------------------------
# WAF — WebACL for CloudFront
#
# MUST be provisioned in us-east-1 (scope = CLOUDFRONT).
#
# Rules (evaluated in priority order):
#   10 — AWS Managed: Core Rule Set (OWASP Top 10)
#   20 — AWS Managed: Known Bad Inputs
#   30 — AWS Managed: Amazon IP Reputation List (known malicious IPs)
#   40 — Rate limit: 1 000 requests / 5 min per IP (blocks sustained abusers)
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl" "frontend" {
  #checkov:skip=CKV2_AWS_31:WAF logging is configured conditionally via aws_wafv2_web_acl_logging_configuration in waf_logging.tf (prod only; enable_waf_logging = true)
  provider    = aws.us_east_1
  name        = "${var.app_name}-frontend-waf-${var.environment}"
  description = "WAF for ${var.app_name} CloudFront distribution - ${var.environment}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-common-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-bad-inputs-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-ip-reputation-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimitPerIP"
    priority = 40

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = 1000
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-rate-limit-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.app_name}-frontend-waf-${var.environment}"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.app_name}-frontend-waf-${var.environment}"
  }
}
