# ---------------------------------------------------------------------------
# WAF — WebACL for CloudFront
#
# MUST be provisioned in us-east-1 (scope = CLOUDFRONT).
# Uses the aws.us_east_1 provider alias defined in provider.tf.
#
# Rules (evaluated in priority order):
#   10 — AWS Managed: Core Rule Set (OWASP Top 10)
#   20 — AWS Managed: Known Bad Inputs
#   30 — AWS Managed: Amazon IP Reputation List (known malicious IPs)
#   40 — Rate limit: 1 000 requests / 5 min per IP (blocks sustained abusers)
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl" "frontend" {
  provider    = aws.us_east_1
  name        = "${var.app_name}-frontend-waf-${var.environment}"
  description = "WAF for ${var.app_name} CloudFront distribution (${var.environment})"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # -- AWS Managed Rules -------------------------------------------------------

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

  # -- Rate limiting -----------------------------------------------------------

  rule {
    name     = "RateLimitPerIP"
    priority = 40

    action {
      block {}
    }

    statement {
      rate_based_statement {
        # Max requests per IP in a 5-minute sliding window.
        # 1 000 / 5 min ≈ 3.3 req/s — sufficient for normal browsing; blocks scrapers.
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
