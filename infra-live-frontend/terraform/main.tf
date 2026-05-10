locals {
  # prod:     www.example.com
  # non-prod: www-dev.example.com / www-stg.example.com
  fqdn = var.environment == "prod" ? "${var.subdomain}.${var.domain_name}" : "${var.subdomain}-${var.environment}.${var.domain_name}"
}
