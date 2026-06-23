# ---------------------------------------------------------------------------
# CloudFront — global CDN serving the React SPA and proxying the API
#
# Two origins:
#   s3-frontend  — static assets from S3 (default behaviour)
#   alb-backend  — FastAPI backend behind the ALB (/api/* behaviour)
#
# CloudFront→ALB uses HTTPS only to the internal ALB subdomain
# (e.g. buddy-internal-dev.learning-dev.com). End-user TLS is terminated
# at CloudFront. ALB→ECS is HTTP within the VPC.
# ---------------------------------------------------------------------------

locals {
  cache_policy_optimized                = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cache_policy_disabled                 = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  origin_request_cors_s3                = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
  origin_request_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}

resource "aws_cloudfront_distribution" "frontend" {
  #checkov:skip=CKV_AWS_86:CloudFront access logs not enabled — S3 logging bucket deferred; application-level logs go to CloudWatch
  #checkov:skip=CKV_AWS_310:Origin failover not configured — single-region deployment; a second origin requires a second ALB in another region which is not provisioned yet
  #checkov:skip=CKV_AWS_374:Geo restriction disabled intentionally — app serves a global audience; blocking regions would lock out legitimate users
  #checkov:skip=CKV2_AWS_47:Log4j AMR rule not added — the backend is Python, not Java; Log4Shell does not apply; Core Rule Set already covers OWASP Top 10
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.app_name} frontend (${var.environment})"
  default_root_object = "index.html"
  aliases             = [local.fqdn]
  web_acl_id          = aws_wafv2_web_acl.frontend.arn

  price_class = var.cloudfront_price_class

  # -- Origins -----------------------------------------------------------------

  origin {
    origin_id                = "s3-frontend"
    domain_name              = data.aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id                = "s3-backend-assets"
    domain_name              = data.aws_s3_bucket.backend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.backend_assets.id
  }

  origin {
    origin_id   = "alb-backend"
    domain_name = data.aws_ssm_parameter.alb_internal_fqdn.value

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # Must be >= LLM_TIMEOUT_SECONDS (default 60). CloudFront's default of 30 s
      # causes 504s on slow LLM responses before the backend can reply, which
      # triggers the rule-based fallback and, if the effect was already cancelled,
      # skips the personality PATCH entirely.
      origin_read_timeout = 60
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
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend_security.id
  }

  # -- /app-assets/* behaviour: static assets from backend S3 bucket ---
  # /app-assets/ covers all asset subfolders (e.g. child_activity_game/, and any added later).
  # Uses /app-assets/ prefix (not /assets/) to avoid conflicting with Vite build output
  # (index-*.js, index-*.css, fonts) which CloudFront serves from the frontend S3 bucket.

  ordered_cache_behavior {
    path_pattern           = "/app-assets/*"
    target_origin_id       = "s3-backend-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = local.cache_policy_optimized
    origin_request_policy_id   = local.origin_request_cors_s3
    response_headers_policy_id = aws_cloudfront_response_headers_policy.assets.id
  }

  # -- /api/* behaviour: proxy to ALB backend ---------------------------------

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "alb-backend"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false

    cache_policy_id          = local.cache_policy_disabled
    origin_request_policy_id = local.origin_request_all_viewer_except_host
    # api_security sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
    # HSTS, and X-XSS-Protection with override=true.  CORS headers (Access-Control-*)
    # are NOT in this policy — FastAPI's CORSMiddleware is the sole source for those
    # and they pass through unchanged, so no duplication occurs.
    response_headers_policy_id = aws_cloudfront_response_headers_policy.api_security.id

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.jwt_validator.qualified_arn
      include_body = false
    }
  }

  # -- SPA fallback: S3 returns 403 for missing objects -----------------------

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
