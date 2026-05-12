locals {
  # prod:     buddy.learning-dev.com
  # non-prod: buddy-dev.learning-dev.com / buddy-stg.learning-dev.com
  fqdn = var.environment == "prod" ? "${var.subdomain}.${var.domain_name}" : "${var.subdomain}-${var.environment}.${var.domain_name}"
}
