# Everything an environment stamp needs — consumed via terraform_remote_state.
output "project_name" {
  value = var.project_name
}

output "aws_region" {
  value = var.aws_region
}

output "base_domain" {
  value = var.base_domain
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "cluster_arn" {
  value = module.cluster.cluster_arn
}

output "namespace_arn" {
  value = module.cluster.namespace_arn
}

output "alb_security_group_id" {
  value = module.cluster.alb_security_group_id
}

output "alb_dns_name" {
  value = module.cluster.alb_dns_name
}

output "alb_zone_id" {
  value = module.cluster.alb_zone_id
}

output "https_listener_arn" {
  value = module.cluster.https_listener_arn
}

output "web_ecr_repository_url" {
  value = module.cluster.web_ecr_repository_url
}

output "semchunk_ecr_repository_url" {
  value = module.cluster.semchunk_ecr_repository_url
}

output "database_host" {
  value = module.database_server.address
}

output "database_port" {
  value = module.database_server.port
}

output "database_security_group_id" {
  value = module.database_server.security_group_id
}

output "database_master_secret_arn" {
  value = module.database_server.master_secret_arn
}

output "route53_zone_id" {
  description = "Inherited by environment stamps for their DNS records; empty means none"
  value       = var.route53_zone_id
}

output "bastion_instance_id" {
  description = "Target for scripts/db-tunnel.sh; null when the bastion is disabled"
  value       = var.enable_bastion ? aws_instance.bastion[0].id : null
}
