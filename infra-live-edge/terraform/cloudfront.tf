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

  # The region that actually serves the jwt_validator Lambda@Edge's
  # PUBLIC_PATHS (register, login, google, health, and refresh/logout when no
  # location-bearing session is found) — every one of those requests
  # genuinely lands here, unlike authenticated /api/* traffic, which is
  # always overridden. Deliberately derived from backend_regions rather than
  # its own separate variable, so there's one less thing to configure — it's
  # simply whichever region is first in whatever combination is selected.
  bootstrap_region = var.backend_regions[0]

  # Mirrors LOCATION_TO_REGION in ../functions/jwt-validator-lambda.js.tpl and
  # backend/app/routing.py's COUNTRY_TO_REGION groupings. S3 upload keys are
  # prefixed by location (build_upload_key in backend/app/services/s3_uploads.py),
  # not by AWS region, so the /uploads/* path-based routing below must match on
  # location, not on the 3 AWS regions directly. Must stay in sync with the
  # Lambda@Edge's own LOCATION_TO_REGION — a location mapped differently
  # between the two would mean a user's API calls and photo uploads land in
  # different regions.
  #
  # cn/ru are deliberately absent, same reasoning as the Lambda@Edge function:
  # mapping them to a region was considered and reverted on compliance grounds
  # (China needs AWS's separate China partition; Russia carries export-control
  # exposure this business isn't taking on). A location missing here falls
  # through to the default (SPA) behaviour for uploads — the Lambda@Edge's own
  # 503 is what actually blocks the API for these two, this is just kept
  # consistent with it rather than serving photos for an account that can't
  # reach the API at all.
  uploads_location_to_region = {
    eu   = "eu-west-1"
    us   = "us-east-1"
    br   = "us-east-1"
    in   = "ap-south-1"
    apac = "ap-south-1"
    me   = "ap-south-1"
    # cn = "us-east-1" -- intentionally disabled, see comment above
    # ru = "us-east-1" -- intentionally disabled, see comment above
  }

  # Only locations whose mapped region is actually deployed get a behaviour —
  # a location mapped to a region with no uploads bucket yet simply falls
  # through to the default (SPA) behaviour instead of erroring the apply.
  active_uploads_locations = {
    for loc, region in local.uploads_location_to_region : loc => region
    if contains(keys(local.regional_uploads_buckets), region)
  }
}

resource "aws_cloudfront_distribution" "frontend" {
  #checkov:skip=CKV_AWS_86:CloudFront access logs not enabled — S3 logging bucket deferred; application-level logs go to CloudWatch
  #checkov:skip=CKV_AWS_310:Origin failover (active/passive origin groups) not configured — each region's origin serves its own distinct location/path, not a failover pair for the same content
  #checkov:skip=CKV_AWS_374:Geo restriction disabled intentionally — app serves a global audience; blocking regions would lock out legitimate users
  #checkov:skip=CKV2_AWS_47:Log4j AMR rule not added — the backend is Python, not Java; Log4Shell does not apply; Core Rule Set already covers OWASP Top 10
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.app_name} frontend (${var.environment})"
  default_root_object = "index.html"
  aliases             = [local.fqdn]
  web_acl_id          = var.enable_waf ? aws_wafv2_web_acl.frontend[0].arn : null

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

  # One origin per active backend region's uploads bucket. Shared OAC across
  # all of them — OAC is a signing config, not tied to a specific bucket.
  dynamic "origin" {
    for_each = local.regional_uploads_buckets
    content {
      origin_id                = "s3-backend-uploads-${origin.key}"
      domain_name              = origin.value.bucket_regional_domain_name
      origin_access_control_id = aws_cloudfront_origin_access_control.backend_uploads.id
    }
  }

  origin {
    origin_id = "alb-backend"
    # This IS actually used at request time, unlike the uploads origins above:
    # the jwt_validator Lambda@Edge (see lambda_edge.tf) only overrides
    # request.origin for authenticated /api/* traffic it can resolve a
    # location for. Its PUBLIC_PATHS (register, login, google, health, and
    # refresh/logout when no location-bearing session is found) genuinely
    # land here, for every visitor worldwide, regardless of where they are —
    # see local.bootstrap_region above for which region that is.
    domain_name = local.regional_alb_fqdns[local.bootstrap_region]

    # Lets the ALB's listener rule (infra-live-backend's aws_lb_listener_rule.
    # from_cloudfront) tell requests that came through this distribution apart
    # from requests sent straight to the ALB's DNS name via some other
    # CloudFront distribution — both would otherwise pass the ALB security
    # group's CloudFront-prefix-list check equally.
    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }

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

  # -- /uploads/{location}/* behaviours: user-generated photos, one per location
  # group, routed to whichever region actually holds that location's bucket
  # (see local.active_uploads_locations above). No Lambda@Edge (no auth check
  # needed — photos are semi-public once uploaded). Same caching/CORS policy
  # as /app-assets/*. A location whose mapped region has no uploads bucket
  # deployed yet has no behaviour here and falls through to the default (SPA)
  # behaviour — not a clean 404, but that region doesn't serve uploads yet.

  dynamic "ordered_cache_behavior" {
    for_each = local.active_uploads_locations
    content {
      path_pattern           = "/uploads/${ordered_cache_behavior.key}/*"
      target_origin_id       = "s3-backend-uploads-${ordered_cache_behavior.value}"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id            = local.cache_policy_optimized
      origin_request_policy_id   = local.origin_request_cors_s3
      response_headers_policy_id = aws_cloudfront_response_headers_policy.assets.id
    }
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
    # HSTS, and X-XSS-Protection with override=true, and (via its cors_config)
    # is now also the authoritative source for CORS (Access-Control-*) headers
    # — see response_headers.tf for why. allowed_methods above includes OPTIONS,
    # which preflight requests need in order to reach the origin and come back
    # through this policy at all.
    response_headers_policy_id = aws_cloudfront_response_headers_policy.api_security.id

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.jwt_validator.qualified_arn
      include_body = false
    }
  }

  # -- SPA fallback: S3 returns 404 for missing objects -----------------------
  # s3:ListBucket is granted to CloudFront OAC (see infra-live-frontend s3_policy.tf)
  # so S3 returns 404 (not 403) for missing objects. Only 404 is caught here,
  # which means API 403 responses (e.g. "Registration is not open.") pass
  # through CloudFront untouched and reach the client correctly.

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

  # Ensures CloudFront is destroyed before time_sleep fires, which in turn waits
  # 10 min before Lambda@Edge is deleted — gives AWS time to remove edge replicas.
  # Apply order: Lambda → time_sleep (no-op) → CloudFront
  # Destroy order: CloudFront → time_sleep (600s wait) → Lambda
  depends_on = [time_sleep.wait_for_lambda_edge_replica_cleanup]
}
