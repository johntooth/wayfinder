# wayfinder on AWS: ECS Fargate, RDS, S3, Bedrock, CloudFront with a WAF.
# Its own VPC and state. See README.md for what is deployed and the deploy order.

provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}

# CloudFront-scope WAF ACLs exist only in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = var.tags
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = var.name
}

module "network" {
  source = "./modules/network"
  name   = local.name
  region = var.region
}

module "logging" {
  source = "./modules/logging"
  name   = local.name
}

module "data" {
  source                     = "./modules/data"
  name                       = local.name
  subnet_ids                 = module.network.private_subnet_ids
  database_security_group_id = module.network.database_security_group_id
  db_instance_class          = var.db_instance_class
}

module "storage" {
  source            = "./modules/storage"
  name              = local.name
  access_log_bucket = module.logging.s3_bucket
}

module "storage_user" {
  source = "./modules/service-user"
  name   = "${local.name}-storage"
  policy = module.storage.access_policy
}

# Anthropic models only, called directly or through this account's inference
# profiles. Which model the app uses is set in its admin settings, so the
# policy names the family rather than one model. A cross-region profile routes
# to other regions' foundation models, hence the wildcard region there.
module "bedrock_user" {
  source = "./modules/service-user"
  name   = "${local.name}-bedrock"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "InvokeAnthropic"
      Effect = "Allow"
      Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        "arn:aws:bedrock:${var.bedrock_region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
      ]
    }]
  })
}

module "waf" {
  source    = "./modules/waf"
  providers = { aws = aws.us_east_1 }
  name      = local.name
}

module "app" {
  source                            = "./modules/app"
  name                              = local.name
  region                            = var.region
  vpc_id                            = module.network.vpc_id
  private_subnet_ids                = module.network.private_subnet_ids
  alb_security_group_id             = module.network.alb_security_group_id
  web_security_group_id             = module.network.web_security_group_id
  api_security_group_id             = module.network.api_security_group_id
  access_log_bucket                 = module.logging.alb_bucket
  cloudfront_log_bucket_domain_name = module.logging.cloudfront_bucket_domain_name
  web_acl_arn                       = module.waf.arn
  database_url_secret_arn           = module.data.database_url_secret_arn
  documents_bucket                  = module.storage.bucket
  storage_key_secret_arn            = module.storage_user.secret_arn
  bedrock_key_secret_arn            = module.bedrock_user.secret_arn
  image                             = var.image
  run_migrations                    = var.run_migrations
  bedrock_region                    = var.bedrock_region
  admin_seed_email                  = var.admin_seed_email
}

# CloudFront reaches the internal ALB through a VPC origin. Its service-managed
# security group exists only once a VPC origin does, so the ALB's ingress rule
# is made here, and the name refers to the VPC origin id so the read waits for it.
data "aws_security_group" "cloudfront_vpc_origins" {
  name   = module.app.vpc_origin_id != "" ? "CloudFront-VPCOrigins-Service-SG" : ""
  vpc_id = module.network.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id            = module.network.alb_security_group_id
  referenced_security_group_id = data.aws_security_group.cloudfront_vpc_origins.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}
