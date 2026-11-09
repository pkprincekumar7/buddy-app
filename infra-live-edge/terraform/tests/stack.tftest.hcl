# The edge stack's security settings: the things that, if a refactor dropped them, would
# still plan and apply cleanly. Mock providers: no credentials, nothing is created.
# Run from infra-live-edge/terraform (check.sh and CI do): terraform test
#
# The per-environment tests (tests/envs) check each environment's tfvars; these check what
# every environment shares.

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

mock_provider "aws" {
  alias  = "us_east_1"
  source = "./tests/envs/mocks"
}

mock_provider "time" {}

variables {
  app_name                      = "superpower"
  environment                   = "stg"
  repository                    = "owner/buddy-app"
  domain_name                   = "example.com"
  subdomain                     = "superpower"
  hosted_zone_id                = "Z0000000000000"
  acm_certificate_arn_us_east_1 = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  spa_bucket_name               = "superpower-stg-spa"
  assets_bucket_name            = "superpower-stg-assets"
  uploads_bucket_names          = { "ap-south-1" = "superpower-stg-uploads-ap-south-1" }
  jwt_public_keys               = { "key-v1" = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----\n" }
  origin_verify_secret          = "current-secret"
  ops_email                     = "ops@example.com"
  backend_regions               = ["ap-south-1"]
  enable_waf                    = true
  cloudfront_price_class        = "PriceClass_100"
  enable_guardduty              = true
  enable_cloudtrail             = false
  enable_waf_logging            = false
  enable_alarms                 = true
}

run "distribution" {
  command = apply

  assert {
    condition     = aws_cloudfront_distribution.frontend.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021" && aws_cloudfront_distribution.frontend.viewer_certificate[0].ssl_support_method == "sni-only"
    error_message = "Viewers get TLS 1.2 or later, by SNI."
  }
  assert {
    condition     = aws_cloudfront_distribution.frontend.web_acl_id == aws_wafv2_web_acl.frontend[0].arn
    error_message = "The WAF web ACL is attached to the distribution."
  }
  assert {
    condition     = aws_cloudfront_distribution.frontend.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https" && alltrue([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : contains(["https-only", "redirect-to-https"], b.viewer_protocol_policy)])
    error_message = "No behaviour serves plain HTTP."
  }
  # EDGE-03: the SPA fallback is a viewer-request function on the default behaviour only,
  # never a distribution-wide error page that turns API 404s into 200 HTML.
  assert {
    condition     = one(aws_cloudfront_distribution.frontend.default_cache_behavior[0].function_association).function_arn == aws_cloudfront_function.spa_rewrite.arn && alltrue([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : length(b.function_association) == 0])
    error_message = "spa_rewrite runs on the default behaviour and nowhere else (EDGE-03)."
  }
  assert {
    condition     = alltrue([for e in aws_cloudfront_distribution.frontend.custom_error_response : e.response_page_path == null && e.response_code == null])
    error_message = "No custom error response rewrites a status or a page (EDGE-03)."
  }
}

run "api_behaviour" {
  command = apply

  assert {
    condition     = one([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b if b.path_pattern == "/api/*"]).viewer_protocol_policy == "https-only"
    error_message = "/api/* refuses plain HTTP instead of redirecting a request with a body."
  }
  assert {
    condition     = one([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b if b.path_pattern == "/api/*"]).cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    error_message = "/api/* uses the managed CachingDisabled policy: no response is cached at the edge."
  }
  assert {
    condition     = one(one([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b if b.path_pattern == "/api/*"]).lambda_function_association).event_type == "origin-request" && one(one([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b if b.path_pattern == "/api/*"]).lambda_function_association).lambda_arn == aws_lambda_function.jwt_validator.qualified_arn
    error_message = "The JWT check runs on /api/* at origin-request (the only event that can pick the origin), on a published version."
  }
  assert {
    condition     = one([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b if b.path_pattern == "/api/*"]).response_headers_policy_id == aws_cloudfront_response_headers_policy.api_security.id
    error_message = "/api/* answers carry the API security headers and CORS policy."
  }
}

run "origins" {
  command = apply

  assert {
    condition     = length(aws_cloudfront_distribution.frontend.origin) == 3 && alltrue([for o in aws_cloudfront_distribution.frontend.origin : !strcontains(o.origin_id, "uploads")])
    error_message = "Three origins (SPA, assets, ALB) and no uploads origin: child photos are presigned S3 URLs, never served through CloudFront (EDGE-05)."
  }
  assert {
    condition     = alltrue([for o in aws_cloudfront_distribution.frontend.origin : o.origin_access_control_id != "" if startswith(o.origin_id, "s3-")])
    error_message = "Every S3 origin is reached with origin access control."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.frontend.signing_behavior == "always" && aws_cloudfront_origin_access_control.backend_assets.signing_behavior == "always" && aws_cloudfront_origin_access_control.frontend.signing_protocol == "sigv4"
    error_message = "OAC always signs (SigV4), so the buckets can refuse unsigned requests."
  }
  assert {
    condition     = one([for o in aws_cloudfront_distribution.frontend.origin : o if o.origin_id == "alb-backend"]).custom_origin_config[0].origin_protocol_policy == "https-only" && jsonencode(one([for o in aws_cloudfront_distribution.frontend.origin : o if o.origin_id == "alb-backend"]).custom_origin_config[0].origin_ssl_protocols) == jsonencode(["TLSv1.2"])
    error_message = "CloudFront reaches the ALB over HTTPS with TLS 1.2 only."
  }
  assert {
    condition     = one(one([for o in aws_cloudfront_distribution.frontend.origin : o if o.origin_id == "alb-backend"]).custom_header).name == "X-Origin-Verify" && one(one([for o in aws_cloudfront_distribution.frontend.origin : o if o.origin_id == "alb-backend"]).custom_header).value == "current-secret"
    error_message = "The ALB origin carries X-Origin-Verify with the current secret (EDGE-02)."
  }
}

# EDGE-02 rotation: while a new secret is being rolled out, CloudFront sends it.
run "origin_secret_during_rotation" {
  command = apply

  variables {
    origin_verify_secret_next = "next-secret"
  }

  assert {
    condition     = one(one([for o in aws_cloudfront_distribution.frontend.origin : o if o.origin_id == "alb-backend"]).custom_header).value == "next-secret"
    error_message = "During a rotation CloudFront sends the incoming secret."
  }
}

run "security_headers" {
  command = apply

  assert {
    condition = alltrue([for p in [aws_cloudfront_response_headers_policy.frontend_security, aws_cloudfront_response_headers_policy.api_security] :
      p.security_headers_config[0].strict_transport_security[0].access_control_max_age_sec == 63072000
      && p.security_headers_config[0].strict_transport_security[0].include_subdomains
      && p.security_headers_config[0].strict_transport_security[0].override
      && p.security_headers_config[0].frame_options[0].frame_option == "DENY"
      && p.security_headers_config[0].content_type_options[0].override
    ])
    error_message = "The SPA and the API send HSTS (2 years, subdomains), X-Frame-Options DENY and nosniff, overriding the origin."
  }
  assert {
    condition     = strcontains(aws_cloudfront_response_headers_policy.frontend_security.security_headers_config[0].content_security_policy[0].content_security_policy, "default-src 'self'") && strcontains(aws_cloudfront_response_headers_policy.frontend_security.security_headers_config[0].content_security_policy[0].content_security_policy, "frame-ancestors 'none'") && strcontains(aws_cloudfront_response_headers_policy.frontend_security.security_headers_config[0].content_security_policy[0].content_security_policy, "object-src 'none'")
    error_message = "The SPA's CSP keeps default-src 'self', frame-ancestors 'none' and object-src 'none'."
  }
  assert {
    condition     = jsonencode(tolist(aws_cloudfront_response_headers_policy.api_security.cors_config[0].access_control_allow_origins[0].items)) == jsonencode(["https://superpower-stg.example.com"]) && aws_cloudfront_response_headers_policy.api_security.cors_config[0].access_control_allow_credentials
    error_message = "CORS with credentials allows the app's own origin only."
  }
}

run "waf_rules" {
  command = apply

  assert {
    condition     = length(aws_wafv2_web_acl.frontend[0].default_action[0].allow) == 1 && aws_wafv2_web_acl.frontend[0].scope == "CLOUDFRONT"
    error_message = "A CloudFront web ACL that allows what no rule blocks."
  }
  assert {
    condition     = toset([for r in aws_wafv2_web_acl.frontend[0].rule : r.name]) == toset(["GeoBlockUnservedCountries", "AWSManagedRulesCommonRuleSet", "BodySizeLimit", "AWSManagedRulesKnownBadInputsRuleSet", "AWSManagedRulesAmazonIpReputationList", "RateLimitPerIP"])
    error_message = "The six rules are all present (geo block, CRS, body size, bad inputs, IP reputation, rate limit)."
  }
  assert {
    condition     = one([for r in aws_wafv2_web_acl.frontend[0].rule : r.priority if r.name == "GeoBlockUnservedCountries"]) == min([for r in aws_wafv2_web_acl.frontend[0].rule : r.priority]...)
    error_message = "The geo block is evaluated first."
  }
  assert {
    condition     = one([for r in aws_wafv2_web_acl.frontend[0].rule : r if r.name == "BodySizeLimit"]).action[0].block[0].custom_response[0].response_code == 413
    error_message = "An oversized body gets the services' own 413 body_too_large."
  }
  assert {
    condition     = one([for r in aws_wafv2_web_acl.frontend[0].rule : r if r.name == "RateLimitPerIP"]).statement[0].rate_based_statement[0].scope_down_statement[0].byte_match_statement[0].search_string == "/api/" && length(one([for r in aws_wafv2_web_acl.frontend[0].rule : r if r.name == "RateLimitPerIP"]).action[0].block) == 1
    error_message = "The per-IP rate limit blocks, and counts /api/ requests only (WAF-01)."
  }
}

run "jwt_validator" {
  command = apply

  assert {
    condition     = aws_lambda_function.jwt_validator.publish && aws_lambda_function.jwt_validator.runtime == "nodejs22.x"
    error_message = "Lambda@Edge needs a published version, on a supported Node runtime."
  }
  assert {
    condition     = aws_iam_role_policy_attachment.jwt_validator_lambda_basic.policy_arn == "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    error_message = "The validator's role can only write its logs."
  }
}

# dev and sbx run without a WAF (cost); nothing else changes.
run "no_waf_when_disabled" {
  command = apply

  variables {
    enable_waf = false
  }

  assert {
    condition     = length(aws_wafv2_web_acl.frontend) == 0 && aws_cloudfront_distribution.frontend.web_acl_id == null
    error_message = "With enable_waf = false there is no web ACL and none attached."
  }
}

run "assets_bucket_and_the_validator_role" {
  command = apply

  assert {
    condition     = one([for s in jsondecode(aws_s3_bucket_policy.backend_assets_cf.policy).Statement : s if s.Effect == "Allow"]).Condition.StringEquals["AWS:SourceArn"] == aws_cloudfront_distribution.frontend.arn && one([for s in jsondecode(aws_s3_bucket_policy.backend_assets_cf.policy).Statement : s if s.Effect == "Allow"]).Action == "s3:GetObject" && one([for s in jsondecode(aws_s3_bucket_policy.backend_assets_cf.policy).Statement : s if s.Effect == "Allow"]).Resource == "arn:aws:s3:::superpower-stg-assets/app-assets/*"
    error_message = "Only this distribution may read the assets bucket, and only GetObject under app-assets/ (the APK and the game assets; SEC-10)."
  }
  assert {
    condition     = one([for s in jsondecode(aws_s3_bucket_policy.backend_assets_cf.policy).Statement : s if s.Effect == "Deny"]).Condition.Bool["aws:SecureTransport"] == "false" && one([for s in jsondecode(aws_s3_bucket_policy.backend_assets_cf.policy).Statement : s if s.Effect == "Deny"]).Action == "s3:*"
    error_message = "The assets bucket refuses every request not made over TLS (TF-05)."
  }
  assert {
    condition     = toset(jsondecode(aws_iam_role.jwt_validator_lambda.assume_role_policy).Statement[0].Principal.Service) == toset(["lambda.amazonaws.com", "edgelambda.amazonaws.com"]) && length(jsondecode(aws_iam_role.jwt_validator_lambda.assume_role_policy).Statement) == 1
    error_message = "Only Lambda and Lambda@Edge assume the validator's role."
  }
}

# prod: WAF logs go to the global logging bucket, without tokens or cookies (SEC-02).
run "waf_logging" {
  command = apply

  variables {
    environment                = "prod"
    spa_bucket_name            = "superpower-prod-spa"
    assets_bucket_name         = "superpower-prod-assets"
    uploads_bucket_names       = { "ap-south-1" = "superpower-prod-uploads-ap-south-1" }
    enable_waf_logging         = true
    enable_cloudtrail          = true
    global_logging_bucket_name = "superpower-global-logs"
  }

  assert {
    condition     = toset([for f in aws_wafv2_web_acl_logging_configuration.main[0].redacted_fields : one(f.single_header).name]) == toset(["authorization", "cookie"])
    error_message = "The Authorization and Cookie headers are redacted from WAF logs (SEC-02)."
  }
  assert {
    condition     = one(aws_wafv2_web_acl_logging_configuration.main[0].logging_filter).default_behavior == "DROP"
    error_message = "Only blocked and counted requests are logged (SEC-02)."
  }
  assert {
    condition     = jsondecode(aws_iam_role.firehose[0].assume_role_policy).Statement[0].Principal.Service == "firehose.amazonaws.com" && jsondecode(aws_iam_role.firehose[0].assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "111111111111"
    error_message = "Only this account's Firehose assumes the WAF-logs role."
  }
  assert {
    condition     = toset(flatten([for s in jsondecode(aws_iam_role_policy.firehose_s3[0].policy).Statement : s.Action])) == toset(["s3:GetBucketLocation", "s3:PutObject", "s3:AbortMultipartUpload"]) && alltrue([for s in jsondecode(aws_iam_role_policy.firehose_s3[0].policy).Statement : startswith(s.Resource, "arn:aws:s3:::superpower-global-logs")])
    error_message = "Firehose may only write objects into the global logging bucket."
  }
}
