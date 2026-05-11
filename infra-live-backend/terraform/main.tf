# All common tags are applied via default_tags in provider.tf.

locals {
  # prod:     buddy-internal.learning-dev.com
  # non-prod: buddy-internal-dev.learning-dev.com
  alb_internal_fqdn = var.environment == "prod" ? "${var.subdomain_internal}.${var.domain_name}" : "${var.subdomain_internal}-${var.environment}.${var.domain_name}"
}
