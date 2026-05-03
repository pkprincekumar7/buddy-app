locals {
  fqdn = "${var.subdomain}.${var.domain_name}"

  common_tags = {
    Project     = var.app_name
    Environment = var.environment
  }
}
