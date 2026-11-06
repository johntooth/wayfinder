# Declared so the root can hand this module its us-east-1 provider.
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}
