locals {
  # prod:     superpower.learning-dev.com
  # non-prod: superpower-dev.learning-dev.com / superpower-stg.learning-dev.com
  fqdn = var.environment == "prod" ? "${var.subdomain}.${var.domain_name}" : "${var.subdomain}-${var.environment}.${var.domain_name}"
}
