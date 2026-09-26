# ---------------------------------------------------------------------------
# Route 53 — internal ALB subdomain
#
# CloudFront connects to the ALB via this record using HTTPS.
# The ACM certificate for this backend region (var.acm_certificate_arn,
# resolved per-region by the workflow) must cover this subdomain.
#
# prod:     buddy-internal.learning-dev.com
# non-prod: buddy-internal-dev.learning-dev.com
# ---------------------------------------------------------------------------

resource "aws_route53_record" "alb_internal" {
  zone_id = var.hosted_zone_id
  name    = local.alb_internal_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.backend.dns_name
    zone_id                = aws_lb.backend.zone_id
    evaluate_target_health = true
  }
}
