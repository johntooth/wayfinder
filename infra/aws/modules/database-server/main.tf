resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-db"
  subnet_ids = var.private_subnet_ids
}

# Ingress is intentionally empty here: every environment stamp adds its own
# rule for its web service (and the terraform runner needs its own path —
# see the README), so access dies with the environment that needed it.
resource "aws_security_group" "database" {
  name        = "${var.project_name}-database"
  description = "Shared Postgres server; per-environment ingress rules"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.project_name}-database" }
}

resource "random_password" "master" {
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

  # No initial application database — environment stamps create their own
  # (the default `postgres` maintenance database is all the provider needs).
  username = "wayfinder_master"
  password = random_password.master.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  backup_retention_period   = 7
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.project_name}-postgres-final"

  # pgvector: each environment database needs `CREATE EXTENSION IF NOT EXISTS
  # vector;` once — the environment stamp's docs cover it (RDS supports the
  # extension; Terraform cannot run SQL against it here).
}

# Consumed by environment stamps to configure the postgresql provider.
resource "aws_secretsmanager_secret" "master" {
  name_prefix = "${var.project_name}/database-master-"
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    username = aws_db_instance.this.username
    password = random_password.master.result
  })
}
