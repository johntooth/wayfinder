output "alb_dns_name" {
  description = "Public DNS name of the load balancer"
  value       = module.ecs.alb_dns_name
}

output "web_ecr_repository_url" {
  description = "Push the web image (built from Dockerfile.web) here"
  value       = module.ecs.web_ecr_repository_url
}

output "semchunk_ecr_repository_url" {
  description = "Push the semchunk image (built from services/semchunk) here"
  value       = var.enable_semchunk ? module.semchunk[0].ecr_repository_url : null
}

output "documents_bucket" {
  description = "S3 bucket holding uploaded documents"
  value       = module.storage.bucket_name
}

output "database_endpoint" {
  description = "RDS endpoint (private)"
  value       = module.database.endpoint
}

output "operator_secrets" {
  description = "Secrets Manager ARNs the operator must populate before first boot"
  value       = module.ecs.operator_secret_arns
}
