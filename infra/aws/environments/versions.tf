terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.22"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Partial backend configuration — same bucket as core, supplied at init time
  # (`terraform init -backend-config=../backend.hcl`). Workspaces give every
  # environment its own state under env:/<workspace>/environments/….
  backend "s3" {
    key          = "environments/terraform.tfstate"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = data.terraform_remote_state.core.outputs.project_name
      ManagedBy   = "terraform"
      Stack       = "environment"
      Environment = local.env_name
    }
  }
}

# Creates each environment's role + database on the shared server. The
# terraform runner therefore needs a network path to RDS at plan/apply time —
# see ../README.md for the three supported options (ADR-034 Decision 2).
provider "postgresql" {
  host            = local.database_master.host
  port            = local.database_master.port
  username        = local.database_master.username
  password        = local.database_master.password
  database        = "postgres"
  sslmode         = "require"
  superuser       = false
  connect_timeout = 15
}
