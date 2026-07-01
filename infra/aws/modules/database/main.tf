resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "database" {
  name        = "${var.project_name}-database"
  description = "Postgres, reachable only from application tasks"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.project_name}-database" }
}

resource "aws_vpc_security_group_ingress_rule" "postgres_from_clients" {
  count = length(var.client_security_group_ids)

  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = var.client_security_group_ids[count.index]
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_instance" "this" {
  identifier     = "${var.project_name}-postgres"
  engine         = "postgres"
  engine_version = "16"

  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_encrypted = true

  db_name  = var.project_name
  username = "wayfinder"
  password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  backup_retention_period   = 7
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.project_name}-postgres-final"

  # pgvector: run `CREATE EXTENSION IF NOT EXISTS vector;` once after
  # provisioning (README) — RDS supports it but Terraform cannot run SQL.
}

resource "aws_secretsmanager_secret" "database_url" {
  name_prefix = "${var.project_name}/database-url-"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s/%s",
    aws_db_instance.this.username,
    random_password.database.result,
    aws_db_instance.this.endpoint,
    aws_db_instance.this.db_name,
  )
}
