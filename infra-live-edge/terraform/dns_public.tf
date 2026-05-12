# ---------------------------------------------------------------------------
# Route 53 — public A record pointing to the CloudFront distribution
#
# Z2FDTNDATAQYW2 is the AWS-constant hosted zone ID for all CloudFront
# distributions (same across every account and region).
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
