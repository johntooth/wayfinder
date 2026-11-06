output "url" { value = module.app.url }
output "documents_bucket" { value = module.storage.bucket }

# For scripts/set-access-key.sh and the migrate step in README.md.
output "access_keys" {
  value = {
    storage = { user = module.storage_user.user_name, secret = module.storage_user.secret_arn }
    bedrock = { user = module.bedrock_user.user_name, secret = module.bedrock_user.secret_arn }
  }
}

output "ecs" {
  value = {
    cluster        = module.app.cluster_name
    services       = module.app.service_names
    migrate_task   = module.app.migrate_task_definition_arn
    subnets        = module.network.private_subnet_ids
    security_group = module.network.api_security_group_id
    log_group      = module.app.log_group_name
  }
}
