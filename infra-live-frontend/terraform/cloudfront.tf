# ---------------------------------------------------------------------------
# CloudFront — global CDN serving the React SPA
#
# Two origins:
#   s3-frontend  — static assets from S3 (default behaviour)
#   alb-backend  — FastAPI backend behind the ALB (/api/* behaviour)
#
# Because CloudFront proxies /api/* to the same domain, the React app can
# call /api/... without CORS — exactly the same pattern as the nginx proxy
# in the EC2-only setup.
#
# MIGRATION NOTE:
#   infra/terraform/alb.tf creates a Route 53 A-record for the same FQDN.
#   Before applying this module, remove (or comment out) that record from
#   infra/terraform/alb.tf and run `terraform apply` on the infra module.
#   Otherwise Route 53 will reject the duplicate A-record.
# ---------------------------------------------------------------------------

# AWS managed cache policy IDs (constant across all accounts/regions)
locals {
  # CachingOptimized — long TTL, compression, ideal for static assets
  cache_policy_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  # CachingDisabled — pass-through, no caching (API requests)
  cache_policy_disabled = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  # CORS-S3Origin — adds Origin header for S3 CORS (needed for fonts/assets)
  origin_request_cors_s3 = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
  # AllViewerExceptHostHeader — forwards everything except Host to the ALB origin.
  # Forwarding Host causes ALB to receive the viewer's domain instead of its own,
  # which breaks FastAPI URL construction and can cause 400 errors.
  origin_request_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  # SecurityHeadersPolicy — adds HSTS, X-Frame-Options, etc. at the CDN edge
  response_headers_security = "67f7725c-6f97-4210-82d7-5512b31e9d03"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.app_name} frontend (${var.environment})"
  default_root_object = "index.html"
  aliases             = [local.fqdn]
  web_acl_id          = aws_wafv2_web_acl.frontend.arn

  # PriceClass_200: US, Canada, Europe, Asia, Middle East, Africa.
  # Includes Mumbai and Singapore edge locations — optimal for Indian users.
  price_class = "PriceClass_200"

  # -- Origins -----------------------------------------------------------------

  origin {
    origin_id                = "s3-frontend"
    domain_name              = data.aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id   = "alb-backend"
    domain_name = data.terraform_remote_state.app.outputs.alb_dns_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      # http-only: CloudFront→ALB stays within AWS network; end-user HTTPS is
      # terminated at CloudFront. The ALB in infra-live-backend has no ACM cert
      # (HTTP only). If using the original infra ALB (which has HTTPS), change
      # this to "https-only".
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # -- Default behaviour: S3 static assets ------------------------------------

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = local.cache_policy_optimized
    origin_request_policy_id   = local.origin_request_cors_s3
    response_headers_policy_id = local.response_headers_security
  }

  # -- /api/* behaviour: proxy to ALB backend ---------------------------------
  # Caching is disabled — all API requests pass through to the ALB.
  # AllViewer forwards every header and cookie so auth tokens reach FastAPI.

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "alb-backend"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false

    cache_policy_id          = local.cache_policy_disabled
    origin_request_policy_id = local.origin_request_all_viewer_except_host
  }

  # -- SPA fallback ------------------------------------------------------------
  # S3 returns 403 (Access Denied) for paths that don't exist as objects.
  # Map both 403 and 404 → index.html so React Router handles client-side routes.

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn_us_east_1
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "${var.app_name}-frontend-cf-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# Route 53 — alias record pointing to the CloudFront distribution
#
# Z2FDTNDATAQYW2 is the hosted zone ID for ALL CloudFront distributions
# (AWS constant — same for every account and region).
# ---------------------------------------------------------------------------
resource "aws_route53_record" "frontend" {
  zone_id = var.hosted_zone_id
  name    = local.fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}
