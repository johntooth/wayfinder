# One PostgreSQL 16 instance for wayfinder. RDS creates the wayfinder database;
# the first migration creates the pgvector extension, which the master user may.

# Ephemeral: generated during apply, written to RDS and Secrets Manager through
# write-only arguments, and never stored in state. Written on create and when
# var.secrets_version changes; bump it to rotate.
ephemeral "random_password" "master" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

# The app reads one connection string, so the master password is set here
# rather than kept in RDS's own secret, which holds only the password.
resource "aws_db_instance" "this" {
  identifier                 = var.name
  engine                     = "postgres"
  engine_version             = var.postgres_version
  instance_class             = var.db_instance_class
  allocated_storage          = var.db_storage_gb
  storage_encrypted          = true
  db_name                    = "wayfinder"
  username                   = "wayfinder"
  password_wo                = ephemeral.random_password.master.result
  password_wo_version        = var.secrets_version
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = [var.database_security_group_id]
  publicly_accessible        = false
  backup_retention_period    = 7
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${var.name}-final"
  auto_minor_version_upgrade = true
  tags                       = var.tags
}

# The full connection string is the secret value, so no password appears in a
# task definition. sslmode=require: RDS enforces TLS on PostgreSQL 16.
resource "aws_secretsmanager_secret" "database_url" {
  name_prefix = "${var.name}/database-url-"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id                = aws_secretsmanager_secret.database_url.id
  secret_string_wo         = "postgresql://wayfinder:${ephemeral.random_password.master.result}@${aws_db_instance.this.address}:5432/wayfinder?sslmode=require"
  secret_string_wo_version = var.secrets_version
}
