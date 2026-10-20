# ---------------------------------------------------------------------------
# ALB — backend services, HTTPS on 443 (../../modules/alb, TF-01)
#
# CloudFront terminates TLS for end users and proxies /api/* to this ALB using
# https-only to the internal subdomain (e.g. superpower-internal-dev-ap-south-1.learning-dev.com).
# var.acm_certificate_arn is this region's entry of the ACM_CERTIFICATE_ARNS
# variable (resolved by the workflow) and must cover the internal subdomain.
# Inbound is CloudFront's prefix list only, and only requests carrying the
# X-Origin-Verify secret are forwarded — everything else gets a fixed 403.
# ---------------------------------------------------------------------------

module "alb" {
  source = "../../modules/alb"

  app_name          = var.app_name
  environment       = var.environment
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  certificate_arn   = var.acm_certificate_arn

  # OR-matched: during an origin-verify rotation both the current secret and
  # origin_verify_secret_next are accepted; outside one compact() drops the
  # empty next value. See docs/infra-operations.md.
  origin_verify_values = distinct(compact([var.origin_verify_secret, var.origin_verify_secret_next]))

  # One target group + rule per HTTP service (services.tf): path-routed ones
  # first, the catch-all (no path_patterns) last.
  targets = {
    for k, s in local.http_services : k => {
      port          = s.http.port
      path_patterns = s.http.path_patterns
      priority      = s.http.priority
    }
  }

  # Independent of enable_cloudtrail — see enable_alb_access_logs's description.
  enable_access_logs = var.enable_alb_access_logs
  access_logs_bucket = var.regional_logging_bucket_name
}
