terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state (one-time bootstrap, see README.md — the bucket cannot be
  # created by the configuration that uses it). Uncomment and fill in:
  #
  # backend "s3" {
  #   bucket       = "<your-terraform-state-bucket>"
  #   key          = "wayfinder/terraform.tfstate"
  #   region       = "<region>"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
