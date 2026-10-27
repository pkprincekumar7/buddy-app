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

  # One target group per HTTP service (services.tf); the rules come from
  # shared/service-routes.json, the same list the local gateway is built from
  # (13.1). No catch-all: an unknown path gets the module's fixed 404. A rule for
  # a service that isn't built yet ("built": false, connect) is skipped.
  targets = { for k, s in local.http_services : k => { port = s.http.port } }
  routes = [
    for r in jsondecode(file("${path.module}/../../shared/service-routes.json")).rules : {
      priority      = r.priority
      target        = r.service
      path_patterns = r.paths
    } if lookup(r, "built", true)
  ]

  # During a rollout the ALB stops sending old tasks new requests and waits
  # up to this long for their in-flight ones to finish. The longest a request runs is an LLM call (LLM_TIMEOUT_SECONDS),
  # so that plus a margin, rather than AWS's 300 s default that every deploy
  # would otherwise wait through.
  deregistration_delay_seconds = var.llm_timeout_seconds + 30

  # Independent of enable_cloudtrail — see enable_alb_access_logs's description.
  enable_access_logs = var.enable_alb_access_logs
  access_logs_bucket = var.regional_logging_bucket_name
}
