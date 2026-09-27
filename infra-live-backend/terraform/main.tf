# All common tags are applied via default_tags in provider.tf.

locals {
  # Route 53 is a global namespace (unlike the ALB/ECS/CloudWatch/ECR resources
  # elsewhere in this module, which are region-scoped by AWS itself) — this name
  # must include aws_region or a second region's apply collides with the first
  # region's already-created record ("already exists" from Route53). Same
  # disambiguation already applied to every IAM role name in iam.tf.
  #
  # prod:     buddy-internal-ap-south-1.learning-dev.com
  # non-prod: buddy-internal-dev-ap-south-1.learning-dev.com
  #
  # Migration note: this renames the record for every environment's existing
  # ap-south-1 backend (previously buddy-internal[-env].learning-dev.com, no
  # region suffix). Before applying against a region that's already live:
  # check whether that region's ACM cert (var.acm_certificate_arn) is an exact-
  # match cert or a wildcard (e.g. *.learning-dev.com) — a wildcard already
  # covers the new hostname automatically (it's still one DNS label, hyphens
  # don't split it), no cert change needed. Only an exact-match cert needs a
  # new SAN added first (see docs/ci-cd.md's ACM_CERTIFICATE_ARN_* notes).
  # Either way, re-apply infra-live-edge right after this one — Route 53 has no
  # rename operation, so this apply destroys the old record before creating
  # the new one (default replace ordering); the old hostname stops resolving
  # partway through this same apply, not just after it. Minimize the gap
  # before infra-live-edge picks up the new name.
  alb_internal_fqdn = var.environment == "prod" ? "${var.subdomain_internal}-${var.aws_region}.${var.domain_name}" : "${var.subdomain_internal}-${var.environment}-${var.aws_region}.${var.domain_name}"
}
