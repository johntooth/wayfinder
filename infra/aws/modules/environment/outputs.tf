output "url" {
  value = "https://${var.env_name}.${var.base_domain}"
}

output "database_name" {
  value = postgresql_database.environment.name
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "operator_secret_arns" {
  value = {
    ai_provider_api_key = aws_secretsmanager_secret.ai_provider_key.arn
  }
}
