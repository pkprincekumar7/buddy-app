terraform {
  required_version = ">= 1.13.0"

  backend "s3" {
    bucket         = "person-deployment-bucket"
    key            = "terraform-state-files/buddy/dev/ap-south-1/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "terraform-locks"
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
