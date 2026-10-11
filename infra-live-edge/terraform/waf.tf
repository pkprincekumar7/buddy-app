# ---------------------------------------------------------------------------
# WAF — WebACL for CloudFront
#
# MUST be provisioned in us-east-1 (scope = CLOUDFRONT).
#
# Rules (evaluated in priority order):
#    5 — Geo block: countries this business never serves (local.blocked_country_codes,
#        from shared/routing.json — see routing.tf)
#   10 — AWS Managed: Core Rule Set (OWASP Top 10)
#   20 — AWS Managed: Known Bad Inputs
#   30 — AWS Managed: Amazon IP Reputation List (known malicious IPs)
#   40 — Rate limit: 1 000 requests / 5 min per IP (blocks sustained abusers)
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl" "frontend" {
  #checkov:skip=CKV2_AWS_31:WAF logging is configured conditionally via aws_wafv2_web_acl_logging_configuration in waf_logging.tf (prod only; enable_waf_logging = true)
  count       = var.enable_waf ? 1 : 0
  provider    = aws.us_east_1
  name        = "${var.app_name}-frontend-waf-${var.environment}"
  description = "WAF for ${var.app_name} CloudFront distribution - ${var.environment}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Same shape as the backend's own 403 (detail.code = country_not_supported),
  # so API clients can handle both the same way.
  custom_response_body {
    key          = "country_not_supported"
    content_type = "APPLICATION_JSON"
    content      = jsonencode({ detail = { code = "country_not_supported", msg = "This service is not available in your country." } })
  }

  # Priority 5 — evaluated first, so blocked traffic is rejected before it
  # reaches the managed rule groups or the rate limit. Covers the whole
  # distribution (SPA, assets, uploads and /api/*), not just registration.
  rule {
    name     = "GeoBlockUnservedCountries"
    priority = 5

    action {
      block {
        custom_response {
          response_code            = 403
          custom_response_body_key = "country_not_supported"
        }
      }
    }

    statement {
      geo_match_statement {
        country_codes = local.blocked_country_codes
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-geo-block-${var.environment}"
      sampled_requests_enabled   = true
    }
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
