# ---------------------------------------------------------------------------
# WAF — WebACL for CloudFront
#
# MUST be provisioned in us-east-1 (scope = CLOUDFRONT).
#
# Rules (evaluated in priority order):
#    5 — Geo block: countries this business never serves (local.blocked_country_codes,
#        from shared/routing.json — see routing.tf)
#   10 — AWS Managed: Core Rule Set (OWASP Top 10); its 8 KB body rule only counts
#   15 — Body size: 8 KB, except the routes that accept more (local.large_body_paths)
#   20 — AWS Managed: Known Bad Inputs
#   30 — AWS Managed: Amazon IP Reputation List (known malicious IPs)
#   40 — Rate limit: 3 000 API requests / 5 min per IP (blocks sustained abusers)
# ---------------------------------------------------------------------------

locals {
  # The routes whose valid bodies pass 8 KB (production-readiness review, WAF-01), each
  # capped by its service instead (common/body_limit.py and the route's own check):
  #   speech/transcriptions             a recording, up to 10 MB (shared)
  #   children/{id}/onboarding          seven answers, about 11 KB of text (onboarding)
  #   children/{id}/transform           the plan, 64 KB (transform)
  #   children/{id}/growth-areas/{area} an area, 64 KB (grow)
  # Anchored, so a route under one of these (…/generation, …/photos/presign) keeps the 8 KB limit.
  large_body_paths = "^/api/v1/(speech/transcriptions|children/[^/]+/(onboarding|transform|growth-areas/[^/]+))$"
  max_body_bytes   = 8192

  # RateLimitPerIP counts /api/ only (WAF-01). The web app's files (about 50 on a first
  # visit) aren't abuse and once counted too, so many people behind one address (a
  # mobile carrier's shared IPs, an office) could be blocked for loading the site. 3 000
  # in 5 minutes is 10 a second from one address, far above one person's use (job polls
  # back off to one per 5 s), and below what a scraper or flood sends. The services' own
  # per-route limits (common/limiter.py) stay the finer check.
  api_rate_limit_per_5_minutes = 3000
}

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

  # The services' own answer to an oversized body (common/body_limit.py).
  custom_response_body {
    key          = "body_too_large"
    content_type = "APPLICATION_JSON"
    content      = jsonencode({ detail = { code = "body_too_large", msg = "The request body is too large." } })
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

        # Its 8 KB body limit would block a recording, the onboarding answers, a plan or
        # a growth area (WAF-01). It only counts; BodySizeLimit (15) does the blocking,
        # with exceptions for those routes.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-common-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # A body over 8 KB is refused unless its route accepts more (local.large_body_paths).
  # CloudFront web ACLs inspect only the first 16 KB of a body; anything longer counts as
  # over the limit (oversize_handling = MATCH), so it's refused too.
  rule {
    name     = "BodySizeLimit"
    priority = 15

    action {
      block {
        custom_response {
          response_code            = 413
          custom_response_body_key = "body_too_large"
        }
      }
    }

    statement {
      and_statement {
        statement {
          size_constraint_statement {
            comparison_operator = "GT"
            size                = local.max_body_bytes
            field_to_match {
              body {
                oversize_handling = "MATCH"
              }
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
        statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = local.large_body_paths
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-waf-body-size-${var.environment}"
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
        limit                 = local.api_rate_limit_per_5_minutes
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300

        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
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
