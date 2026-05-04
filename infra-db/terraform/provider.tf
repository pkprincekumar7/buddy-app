terraform {
  required_version = ">= 1.13.0"

  backend "s3" {
    bucket       = "person-deployment-bucket"
    region       = "us-east-1"
    use_lockfile = true
    # key is supplied at terraform init via -backend-config
    # Pattern: terraform-state-files/buddy360/{env}/db/{region}/terraform.tfstate
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
  }
}

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
