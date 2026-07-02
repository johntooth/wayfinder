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

  # Partial backend configuration: the key is fixed here because environment
  # stamps read core outputs from exactly this key; bucket and region are
  # supplied at init time (`terraform init -backend-config=../backend.hcl`,
  # see ../README.md and ../backend.hcl.example).
  backend "s3" {
    key          = "core/terraform.tfstate"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Stack     = "core"
    }
  }
}
