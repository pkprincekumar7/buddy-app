terraform {
  required_version = "~> 1.13.0"

  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
    # bucket and key are supplied at terraform init via -backend-config
    # key pattern: terraform-state-files/{app_name}/{env}/scheduler/us-east-1/terraform.tfstate
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

data "aws_caller_identity" "current" {}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
