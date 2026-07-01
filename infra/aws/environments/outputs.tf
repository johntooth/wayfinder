output "url" {
  description = "Where this environment is served"
  value       = module.environment.url
}

output "database_name" {
  value = module.environment.database_name
}

output "documents_bucket" {
  value = module.environment.documents_bucket
}

output "operator_secrets" {
  description = "Secrets Manager ARNs the operator must populate before first boot"
  value       = module.environment.operator_secret_arns
}
