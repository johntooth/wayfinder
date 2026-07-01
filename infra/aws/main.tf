# The web service's security group lives in the network module so database,
# ecs, and semchunk can all reference it without a module dependency cycle.
module "network" {
  source = "./modules/network"

  project_name = var.project_name
  vpc_cidr     = var.vpc_cidr
}

module "storage" {
  source = "./modules/storage"

  project_name = var.project_name
}

module "database" {
  source = "./modules/database"

  project_name              = var.project_name
  vpc_id                    = module.network.vpc_id
  private_subnet_ids        = module.network.private_subnet_ids
  instance_class            = var.db_instance_class
  allocated_storage         = var.db_allocated_storage
  skip_final_snapshot       = var.db_skip_final_snapshot
  client_security_group_ids = [module.network.web_security_group_id]
}

module "ecs" {
  source = "./modules/ecs"

  project_name          = var.project_name
  aws_region            = var.aws_region
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  private_subnet_ids    = module.network.private_subnet_ids
  web_security_group_id = module.network.web_security_group_id
  certificate_arn       = var.certificate_arn
  public_url            = var.public_url
  web_image_tag         = var.web_image_tag
  web_desired_count     = var.web_desired_count
  web_cpu               = var.web_cpu
  web_memory            = var.web_memory
  ai_default_provider   = var.ai_default_provider

  database_url_secret_arn       = module.database.database_url_secret_arn
  documents_bucket              = module.storage.bucket_name
  storage_access_key_secret_arn = module.storage.access_key_id_secret_arn
  storage_secret_key_secret_arn = module.storage.secret_access_key_secret_arn

  # ADR-030 / ADR-033 Decision 3: with the sidecar enabled the web task gets
  # CHUNKER_PROVIDER=semchunk and the Service Connect DNS name; with it off no
  # semchunk configuration exists anywhere in the deployment.
  semchunk_enabled = var.enable_semchunk
  semchunk_url     = "http://semchunk:8000"
}

module "semchunk" {
  source = "./modules/semchunk"
  count  = var.enable_semchunk ? 1 : 0

  project_name             = var.project_name
  aws_region               = var.aws_region
  vpc_id                   = module.network.vpc_id
  private_subnet_ids       = module.network.private_subnet_ids
  cluster_arn              = module.ecs.cluster_arn
  namespace_arn            = module.ecs.namespace_arn
  execution_role_arn       = module.ecs.execution_role_arn
  image_tag                = var.semchunk_image_tag
  cpu                      = var.semchunk_cpu
  memory                   = var.semchunk_memory
  client_security_group_id = module.network.web_security_group_id
}
