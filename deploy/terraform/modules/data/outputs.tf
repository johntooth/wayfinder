# From the version, so nothing reads the secret before it has a value.
output "database_url_secret_arn" { value = aws_secretsmanager_secret_version.database_url.secret_arn }

# What the offline tests look at. Not for use by other modules.
output "settings" {
  value = {
    encrypted           = aws_db_instance.this.storage_encrypted
    publicly_accessible = aws_db_instance.this.publicly_accessible
    engine_version      = aws_db_instance.this.engine_version
  }
}
