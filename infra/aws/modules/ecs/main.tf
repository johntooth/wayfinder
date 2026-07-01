locals {
  better_auth_url = var.public_url != "" ? var.public_url : "http://${aws_lb.this.dns_name}"

  # The app reads its AI key from a provider-specific variable; only the
  # configured default provider's secret is wired in.
  ai_key_env_var = {
    anthropic = "ANTHROPIC_API_KEY"
    openai    = "OPENAI_API_KEY"
    mistral   = "MISTRAL_API_KEY"
  }

  web_environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "APP_NAME", value = var.project_name },
      { name = "BETTER_AUTH_URL", value = local.better_auth_url },
      { name = "AI_DEFAULT_PROVIDER", value = var.ai_default_provider },
      { name = "MINIO_ENDPOINT", value = "s3.${var.aws_region}.amazonaws.com" },
      { name = "MINIO_PORT", value = "443" },
      { name = "MINIO_USE_SSL", value = "true" },
      { name = "MINIO_BUCKET", value = var.documents_bucket },
    ],
    var.semchunk_enabled ? [
      { name = "CHUNKER_PROVIDER", value = "semchunk" },
      { name = "SEMCHUNK_URL", value = var.semchunk_url },
    ] : [],
  )

  web_secrets = concat(
    [
      { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
      { name = "BETTER_AUTH_SECRET", valueFrom = aws_secretsmanager_secret.better_auth.arn },
      { name = "MINIO_ACCESS_KEY", valueFrom = var.storage_access_key_secret_arn },
      { name = "MINIO_SECRET_KEY", valueFrom = var.storage_secret_key_secret_arn },
    ],
    contains(keys(local.ai_key_env_var), var.ai_default_provider) ? [
      {
        name      = local.ai_key_env_var[var.ai_default_provider]
        valueFrom = aws_secretsmanager_secret.ai_provider_key.arn
      },
    ] : [],
  )
}

resource "aws_ecs_cluster" "this" {
  name = var.project_name
}

resource "aws_service_discovery_http_namespace" "this" {
  name        = var.project_name
  description = "Service Connect namespace for ${var.project_name}"
}

resource "aws_ecr_repository" "web" {
  name = "${var.project_name}-web"
}

# ── Load balancer ─────────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "Public entry point"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "to web tasks"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = var.web_security_group_id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_lb" "this" {
  name               = "${var.project_name}-web"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "web" {
  name        = "${var.project_name}-web"
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

resource "aws_lb_listener" "https" {
  count = var.certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # With a certificate the plain-HTTP listener only redirects; without one it
  # serves the app directly (dev environments only).
  dynamic "default_action" {
    for_each = var.certificate_arn != "" ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = var.certificate_arn == "" ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }
}

# ── Secrets ───────────────────────────────────────────────────────────────────

resource "random_password" "better_auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "better_auth" {
  name_prefix = "${var.project_name}/better-auth-secret-"
}

resource "aws_secretsmanager_secret_version" "better_auth" {
  secret_id     = aws_secretsmanager_secret.better_auth.id
  secret_string = random_password.better_auth.result
}

# Seeded with a placeholder; the operator sets the real key before first boot
# (README). ignore_changes keeps later applies from reverting it.
resource "aws_secretsmanager_secret" "ai_provider_key" {
  name_prefix = "${var.project_name}/ai-provider-api-key-"
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
  name               = "${var.project_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "${var.project_name}-read-app-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          var.database_url_secret_arn,
          var.storage_access_key_secret_arn,
          var.storage_secret_key_secret_arn,
          aws_secretsmanager_secret.better_auth.arn,
          aws_secretsmanager_secret.ai_provider_key.arn,
        ]
      },
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = "${var.project_name}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ── Web service ───────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project_name}-web"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project_name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.web_cpu)
  memory                   = tostring(var.web_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.web.repository_url}:${var.web_image_tag}"
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
  name            = "web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.web_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  # Client-side Service Connect so the task can resolve the semchunk sidecar's
  # alias when it is deployed (ADR-033 Decision 3).
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
  }

  depends_on = [aws_lb_listener.http]
}
