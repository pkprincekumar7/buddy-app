variable "aws_region" {
  description = "AWS region (for S3 bucket data source and SSM; WAF and CloudFront are always us-east-1 / global)"
  type        = string

  validation {
    condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
    error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
  }
}

variable "app_name" {
  description = "Application name used for resource naming and tagging"
  type        = string
  default     = "buddy360"
}

variable "environment" {
  description = "Deployment environment (dev, stg, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "environment must be one of: dev, stg, prod."
  }
}

variable "domain_name" {
  description = "Root domain name (e.g. learning-dev.com)"
  type        = string
}

variable "subdomain" {
  description = "Public subdomain prefix (e.g. 'buddy' → buddy.learning-dev.com in prod, buddy-dev.learning-dev.com in dev)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}

variable "acm_certificate_arn_us_east_1" {
  description = "ACM certificate ARN in us-east-1 covering the public frontend domain (CloudFront requires certs in us-east-1)"
  type        = string
}

variable "backend_region" {
  description = "AWS region where the backend (ALB) was deployed — used to read the correct ALB FQDN from SSM"
  type        = string

  validation {
    condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.backend_region)
    error_message = "backend_region must be one of: ap-south-1, eu-west-1, us-east-1."
  }
}
