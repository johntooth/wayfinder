locals {
  # One terraform workspace per environment; the workspace name is the
  # environment name unless explicitly overridden.
  env_name = var.env_name != "" ? var.env_name : terraform.workspace

  core            = data.terraform_remote_state.core.outputs
  database_master = jsondecode(data.aws_secretsmanager_secret_version.database_master.secret_string)

  # null inherits core's zone; "" explicitly skips DNS for this environment.
  route53_zone_id = var.route53_zone_id == null ? local.core.route53_zone_id : var.route53_zone_id
}

data "terraform_remote_state" "core" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = var.core_state_key
    region = var.state_region != "" ? var.state_region : var.aws_region
  }
}

data "aws_secretsmanager_secret_version" "database_master" {
  secret_id = local.core.database_master_secret_arn
}

module "environment" {
  source = "../modules/environment"

  project_name = local.core.project_name
  env_name     = local.env_name
  aws_region   = var.aws_region

  vpc_id             = local.core.vpc_id
  private_subnet_ids = local.core.private_subnet_ids
  cluster_arn        = local.core.cluster_arn
  namespace_arn      = local.core.namespace_arn

  alb_security_group_id = local.core.alb_security_group_id
  alb_dns_name          = local.core.alb_dns_name
  alb_zone_id           = local.core.alb_zone_id
  https_listener_arn    = local.core.https_listener_arn
  base_domain           = local.core.base_domain
  route53_zone_id       = local.route53_zone_id

  database_host              = local.core.database_host
  database_port              = local.core.database_port
  database_security_group_id = local.core.database_security_group_id

  web_image         = "${local.core.web_ecr_repository_url}:${var.web_image_tag}"
  web_desired_count = var.web_desired_count
  web_cpu           = var.web_cpu
  web_memory        = var.web_memory

  ai_default_provider = var.ai_default_provider

  enable_semchunk = var.enable_semchunk
  semchunk_image  = "${local.core.semchunk_ecr_repository_url}:${var.semchunk_image_tag}"
  semchunk_cpu    = var.semchunk_cpu
  semchunk_memory = var.semchunk_memory
}
