locals {
  name_prefix = "${var.project_name}-${var.env_name}"
  hostname    = "${var.env_name}.${var.base_domain}"
  # Postgres identifiers cannot contain hyphens without quoting.
  database_name = replace(local.name_prefix, "-", "_")

  ai_key_env_var = {
    anthropic = "ANTHROPIC_API_KEY"
    openai    = "OPENAI_API_KEY"
    mistral   = "MISTRAL_API_KEY"
  }

  web_environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "APP_NAME", value = var.project_name },
      { name = "BETTER_AUTH_URL", value = "https://${local.hostname}" },
      { name = "AI_DEFAULT_PROVIDER", value = var.ai_default_provider },
      { name = "MINIO_ENDPOINT", value = "s3.${var.aws_region}.amazonaws.com" },
      { name = "MINIO_PORT", value = "443" },
      { name = "MINIO_USE_SSL", value = "true" },
      { name = "MINIO_BUCKET", value = aws_s3_bucket.documents.bucket },
    ],
    var.enable_semchunk ? [
      { name = "CHUNKER_PROVIDER", value = "semchunk" },
      { name = "SEMCHUNK_URL", value = "http://semchunk-${var.env_name}:8000" },
    ] : [],
  )

  web_secrets = concat(
    [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "BETTER_AUTH_SECRET", valueFrom = aws_secretsmanager_secret.better_auth.arn },
      { name = "MINIO_ACCESS_KEY", valueFrom = aws_secretsmanager_secret.storage_access_key_id.arn },
      { name = "MINIO_SECRET_KEY", valueFrom = aws_secretsmanager_secret.storage_secret_access_key.arn },
    ],
    contains(keys(local.ai_key_env_var), var.ai_default_provider) ? [
      {
        name      = local.ai_key_env_var[var.ai_default_provider]
        valueFrom = aws_secretsmanager_secret.ai_provider_key.arn
      },
    ] : [],
  )
}

# ── Database (on the shared server) ──────────────────────────────────────────

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "postgresql_role" "environment" {
  name     = local.database_name
  login    = true
  password = random_password.database.result
}

resource "postgresql_database" "environment" {
  name  = local.database_name
  owner = postgresql_role.environment.name
}

resource "aws_secretsmanager_secret" "database_url" {
  name_prefix = "${local.name_prefix}/database-url-"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s:%d/%s",
    postgresql_role.environment.name,
    random_password.database.result,
    var.database_host,
    var.database_port,
    postgresql_database.environment.name,
  )
}

# This environment's web tasks are the only application path to the shared
# server this stamp opens; the rule disappears with the environment.
resource "aws_vpc_security_group_ingress_rule" "database_from_web" {
  security_group_id            = var.database_security_group_id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "web tasks of ${var.env_name}"
}

# ── Object storage ────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "documents" {
  bucket_prefix = "${local.name_prefix}-documents-"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The app's storage adapter authenticates with static MinIO-style credentials,
# so each environment gets a dedicated IAM user scoped to its own bucket.
resource "aws_iam_user" "storage" {
  name = "${local.name_prefix}-document-storage"
}

resource "aws_iam_user_policy" "storage" {
  name = "${local.name_prefix}-documents-bucket"
  user = aws_iam_user.storage.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.documents.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.documents.arn}/*"
      },
    ]
  })
}

resource "aws_iam_access_key" "storage" {
  user = aws_iam_user.storage.name
}

resource "aws_secretsmanager_secret" "storage_access_key_id" {
  name_prefix = "${local.name_prefix}/storage-access-key-id-"
}

resource "aws_secretsmanager_secret_version" "storage_access_key_id" {
  secret_id     = aws_secretsmanager_secret.storage_access_key_id.id
  secret_string = aws_iam_access_key.storage.id
}

resource "aws_secretsmanager_secret" "storage_secret_access_key" {
  name_prefix = "${local.name_prefix}/storage-secret-access-key-"
}

resource "aws_secretsmanager_secret_version" "storage_secret_access_key" {
  secret_id     = aws_secretsmanager_secret.storage_secret_access_key.id
  secret_string = aws_iam_access_key.storage.secret
}

# ── App secrets ───────────────────────────────────────────────────────────────

resource "random_password" "better_auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "better_auth" {
  name_prefix = "${local.name_prefix}/better-auth-secret-"
}

resource "aws_secretsmanager_secret_version" "better_auth" {
  secret_id     = aws_secretsmanager_secret.better_auth.id
  secret_string = random_password.better_auth.result
}

# Seeded with a placeholder; the operator sets the real key before first boot.
# ignore_changes keeps later applies from reverting it.
resource "aws_secretsmanager_secret" "ai_provider_key" {
  name_prefix = "${local.name_prefix}/ai-provider-api-key-"
}

resource "aws_secretsmanager_secret_version" "ai_provider_key" {
  secret_id     = aws_secretsmanager_secret.ai_provider_key.id
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── IAM ───────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.name_prefix}-read-app-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.database_url.arn,
          aws_secretsmanager_secret.better_auth.arn,
          aws_secretsmanager_secret.storage_access_key_id.arn,
          aws_secretsmanager_secret.storage_secret_access_key.arn,
          aws_secretsmanager_secret.ai_provider_key.arn,
        ]
      },
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ── Web service ───────────────────────────────────────────────────────────────

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Web tasks of environment ${var.env_name}"
  vpc_id      = var.vpc_id

  egress {
    description = "all outbound (S3, Secrets Manager, ECR, AI providers, sidecar)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-web" }
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = var.alb_security_group_id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name_prefix}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path = "/"
    # Unauthenticated requests redirect to the login page — a 3xx is healthy.
    matcher = "200-399"
  }
}

# Priority is auto-assigned; host headers are disjoint per environment so rule
# order does not matter (ADR-034).
resource "aws_lb_listener_rule" "web" {
  listener_arn = var.https_listener_arn

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  condition {
    host_header {
      values = [local.hostname]
    }
  }
}

resource "aws_route53_record" "web" {
  count = var.route53_zone_id != "" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.hostname
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = false
  }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name_prefix}-web"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.web_cpu)
  memory                   = tostring(var.web_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = var.web_image
      essential = true

      portMappings = [
        { name = "web", containerPort = 3000, protocol = "tcp" },
      ]

      environment = local.web_environment
      secrets     = local.web_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.web.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "web"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "web" {
  name            = "${var.env_name}-web"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.web.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  # Client-side Service Connect so the task can resolve this environment's
  # semchunk alias when the sidecar is deployed (ADR-030 / ADR-034).
  service_connect_configuration {
    enabled   = true
    namespace = var.namespace_arn
  }

  depends_on = [aws_lb_listener_rule.web]
}

# ── Optional semantic-chunking sidecar (ADR-030) ─────────────────────────────

module "semchunk" {
  source = "../semchunk-service"
  count  = var.enable_semchunk ? 1 : 0

  service_name             = "${local.name_prefix}-semchunk"
  dns_alias                = "semchunk-${var.env_name}"
  aws_region               = var.aws_region
  vpc_id                   = var.vpc_id
  private_subnet_ids       = var.private_subnet_ids
  cluster_arn              = var.cluster_arn
  namespace_arn            = var.namespace_arn
  execution_role_arn       = aws_iam_role.execution.arn
  image                    = var.semchunk_image
  cpu                      = var.semchunk_cpu
  memory                   = var.semchunk_memory
  client_security_group_id = aws_security_group.web.id
}
