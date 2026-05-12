terraform {
  required_version = "~> 1.13.0"

  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
    # bucket and key are supplied at terraform init via -backend-config
    # key pattern: terraform-state-files/{app_name}/{env}/frontend/us-east-1/terraform.tfstate
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
  }
}

# Both providers are hardcoded to us-east-1 — every resource in this
# module (S3 bucket policy, SSM reads) lives in us-east-1. There is no
# aws_region variable; hardcoding prevents accidental cross-region drift.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Explicit alias used by ssm_read.tf — consistent with the SSM control-plane pattern.
provider "aws" {
  alias  = "ssm"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
