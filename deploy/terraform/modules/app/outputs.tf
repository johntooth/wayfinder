output "url" { value = local.public_url }
output "vpc_origin_id" { value = aws_cloudfront_vpc_origin.this.id }
output "cluster_name" { value = aws_ecs_cluster.this.name }
output "log_group_name" { value = aws_cloudwatch_log_group.this.name }
output "migrate_task_definition_arn" { value = aws_ecs_task_definition.this["migrate"].arn }
output "service_names" { value = { web = aws_ecs_service.web.name, api = aws_ecs_service.api.name } }

# What the offline tests look at. Not for use by other modules.
output "settings" {
  value = {
    containers       = { for k, t in aws_ecs_task_definition.this : k => jsondecode(t.container_definitions)[0] }
    alb_internal     = aws_lb.this.internal
    access_logs      = aws_lb.this.access_logs
    default_action   = one(aws_lb_listener.http.default_action)
    health_path      = one(aws_lb_target_group.web.health_check).path
    origin           = one(aws_cloudfront_vpc_origin.this.vpc_origin_endpoint_config).origin_protocol_policy
    uses_vpc_origin  = one(one(aws_cloudfront_distribution.this.origin).vpc_origin_config) != null
    web_acl_id       = aws_cloudfront_distribution.this.web_acl_id
    viewer_functions = [for f in one(aws_cloudfront_distribution.this.default_cache_behavior).function_association : { event = f.event_type, code = aws_cloudfront_function.client_ip.code } if f.function_arn == aws_cloudfront_function.client_ip.arn]
    secrets_policy   = jsondecode(aws_iam_role_policy.read_secrets.policy)
  }
}
