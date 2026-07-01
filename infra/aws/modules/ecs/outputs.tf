output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "namespace_arn" {
  value = aws_service_discovery_http_namespace.this.arn
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "web_ecr_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "operator_secret_arns" {
  value = {
    ai_provider_api_key = aws_secretsmanager_secret.ai_provider_key.arn
  }
}
