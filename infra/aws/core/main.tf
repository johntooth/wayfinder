# Applied once per AWS account/region: everything environments share.
# Stamping an environment is `../scripts/new-environment.sh <name>` (ADR-034).
module "network" {
  source = "../modules/network"

  project_name = var.project_name
  vpc_cidr     = var.vpc_cidr
}

module "database_server" {
  source = "../modules/database-server"

  project_name        = var.project_name
  vpc_id              = module.network.vpc_id
  private_subnet_ids  = module.network.private_subnet_ids
  instance_class      = var.db_instance_class
  allocated_storage   = var.db_allocated_storage
  skip_final_snapshot = var.db_skip_final_snapshot
}

module "cluster" {
  source = "../modules/cluster"

  project_name      = var.project_name
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  certificate_arn   = var.certificate_arn
}
