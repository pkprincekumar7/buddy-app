locals {
  fqdn = var.environment == "prod" ? "${var.subdomain}.${var.domain_name}" : "${var.subdomain}-${var.environment}.${var.domain_name}"

  common_tags = {
    Project     = var.app_name
    Environment = var.environment
  }
}
