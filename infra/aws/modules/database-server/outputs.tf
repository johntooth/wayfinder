output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "security_group_id" {
  value = aws_security_group.database.id
}

output "master_secret_arn" {
  value = aws_secretsmanager_secret.master.arn
}
