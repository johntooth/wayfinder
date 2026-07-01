output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "namespace_arn" {
  value = aws_service_discovery_http_namespace.this.arn
}

output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "web_ecr_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "semchunk_ecr_repository_url" {
  value = aws_ecr_repository.semchunk.repository_url
}
