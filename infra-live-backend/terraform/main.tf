# All common tags are applied via default_tags in provider.tf.

locals {
  # Route 53 is a global namespace (unlike the ALB/ECS/CloudWatch/ECR resources
  # elsewhere in this module, which are region-scoped by AWS itself) — this name
  # must include aws_region or a second region's apply collides with the first
  # region's already-created record ("already exists" from Route53). Same
  # disambiguation already applied to every IAM role name in iam.tf.
  #
  # prod:     superpower-internal-ap-south-1.learning-dev.com
  # non-prod: superpower-internal-dev-ap-south-1.learning-dev.com
  #
  # The region's ACM cert (var.acm_certificate_arn) must cover this hostname: a
  # wildcard (e.g. *.learning-dev.com) already does — it's one DNS label, hyphens
  # don't split it — while an exact-match cert needs it as a SAN (see
  # docs/ci-cd.md's ACM_CERTIFICATE_ARN_* notes).
  alb_internal_fqdn = var.environment == "prod" ? "${var.subdomain_internal}-${var.aws_region}.${var.domain_name}" : "${var.subdomain_internal}-${var.environment}-${var.aws_region}.${var.domain_name}"
}
