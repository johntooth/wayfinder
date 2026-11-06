# wayfinder on ECS Fargate (docs/guides/setup-aws.md): one image, run as `web`
# behind an internal ALB that CloudFront reaches through a VPC origin, as `api`
# with no ingress, and as a one-off `migrate` task. api reaches web for the
# scheduler heartbeat by its Service Connect name.

locals {
  generated_secrets = toset(["better-auth-secret", "settings-encryption-key", "scheduler-tick-secret"])
}

# Ephemeral: written through secret_string_wo, never stored in state. Written on
# create and when var.secrets_version changes.
#
# Digits only, 64 of them: SETTINGS_ENCRYPTION_KEY must be 64 hex characters
# (or base64 of 32 bytes), and random_password cannot be limited to a-f. A
# string of decimal digits is valid hex and still about 212 bits.
ephemeral "random_password" "generated" {
  for_each = local.generated_secrets
  length   = 64
  upper    = false
  lower    = false
  special  = false
}

resource "aws_secretsmanager_secret" "generated" {
  for_each    = local.generated_secrets
  name_prefix = "${var.name}/${each.key}-"
  description = each.key == "settings-encryption-key" ? "Encrypts the integration credentials wayfinder stores. Changing it makes them unreadable." : null
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each                 = local.generated_secrets
  secret_id                = aws_secretsmanager_secret.generated[each.key].id
  secret_string_wo         = ephemeral.random_password.generated[each.key].result
  secret_string_wo_version = var.secrets_version
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_ecs_cluster" "this" {
  name = var.name
  tags = var.tags
}

resource "aws_service_discovery_http_namespace" "this" {
  name = "${var.name}.internal"
  tags = var.tags
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# jsonencode rather than a policy-document data source, so the offline tests
# can read the policy itself (a mocked data source returns a fixed string).
locals {
  read_secrets_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "ReadSecrets"
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = concat(
        [for s in aws_secretsmanager_secret_version.generated : s.secret_arn],
        [var.database_url_secret_arn, var.storage_key_secret_arn, var.bedrock_key_secret_arn],
      )
    }]
  })
}

resource "aws_iam_role_policy" "read_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = local.read_secrets_policy
}

# The app holds no AWS permissions of its own: S3 and Bedrock are reached with
# the service users' keys. ECS Exec is off, so the role is empty.
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

locals {
  public_url = "https://${aws_cloudfront_distribution.this.domain_name}"

  # Object storage and the AI provider come from the environment rather than
  # the setup wizard, so their keys stay in Secrets Manager (setup-aws.md §6).
  common_environment = {
    NODE_ENV                       = "production"
    RUN_MIGRATIONS_ON_START        = "false"
    DATABASE_POOL_MAX              = tostring(var.database_pool_max)
    MINIO_ENDPOINT                 = "s3.${var.region}.amazonaws.com"
    MINIO_PORT                     = "443"
    MINIO_USE_SSL                  = "true"
    MINIO_REGION                   = var.region
    MINIO_PATH_STYLE               = "false"
    MINIO_BUCKET                   = var.documents_bucket
    AI_DEFAULT_PROVIDER            = "bedrock"
    AWS_BEDROCK_REGION             = var.bedrock_region
    EMBEDDINGS_ALLOW_REMOTE_MODELS = "false"
  }

  web_environment = merge(local.common_environment, {
    WEB_PORT         = tostring(var.web_port)
    BETTER_AUTH_URL  = local.public_url
    ADMIN_SEED_EMAIL = var.admin_seed_email
    # Written by the CloudFront viewer-request function below, which replaces
    # any value the viewer sent.
    TRUSTED_CLIENT_IP_HEADER = local.client_ip_header
  })

  api_environment = merge(local.common_environment, {
    API_PORT     = tostring(var.api_port)
    WEB_BASE_URL = "http://web:${var.web_port}"
  })

  # ECS picks a field out of a JSON secret with <arn>:<key>::.
  common_secrets = {
    DATABASE_URL                  = var.database_url_secret_arn
    SETTINGS_ENCRYPTION_KEY       = aws_secretsmanager_secret_version.generated["settings-encryption-key"].secret_arn
    SCHEDULER_TICK_SECRET         = aws_secretsmanager_secret_version.generated["scheduler-tick-secret"].secret_arn
    MINIO_ACCESS_KEY              = "${var.storage_key_secret_arn}:access_key_id::"
    MINIO_SECRET_KEY              = "${var.storage_key_secret_arn}:secret_access_key::"
    AWS_BEDROCK_ACCESS_KEY_ID     = "${var.bedrock_key_secret_arn}:access_key_id::"
    AWS_BEDROCK_SECRET_ACCESS_KEY = "${var.bedrock_key_secret_arn}:secret_access_key::"
  }

  web_secrets = merge(local.common_secrets, {
    BETTER_AUTH_SECRET = aws_secretsmanager_secret_version.generated["better-auth-secret"].secret_arn
  })

  roles = {
    web = {
      command     = "web"
      cpu         = var.web_cpu
      memory      = var.web_memory
      environment = local.web_environment
      secrets     = local.web_secrets
      port        = var.web_port
    }
    api = {
      command     = "api"
      cpu         = var.api_cpu
      memory      = var.api_memory
      environment = local.api_environment
      secrets     = local.common_secrets
      port        = var.api_port
    }
    # Run by hand before each rollout (README). It exits when the schema is current.
    migrate = {
      command     = "migrate"
      cpu         = var.api_cpu
      memory      = var.api_memory
      environment = local.api_environment
      secrets     = local.common_secrets
      port        = null
    }
  }
}

resource "aws_ecs_task_definition" "this" {
  for_each                 = local.roles
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  # The image is built for x86_64 (onnxruntime-node is glibc-linked).
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([merge(
    {
      name        = each.key
      image       = var.image
      essential   = true
      command     = [each.value.command]
      environment = [for k, v in each.value.environment : { name = k, value = v }]
      secrets     = [for k, v in each.value.secrets : { name = k, valueFrom = v }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = var.region
          awslogs-stream-prefix = each.key
        }
      }
    },
    each.value.port == null ? {} : {
      portMappings = [{ containerPort = each.value.port, name = "http", protocol = "tcp" }]
    },
  )])
  tags = var.tags
}

resource "aws_lb" "this" {
  name               = var.name
  load_balancer_type = "application"
  internal           = true
  # Chat streams over SSE with a keepalive every 25 s; 120 leaves room.
  idle_timeout = 120
  access_logs {
    bucket  = var.access_log_bucket
    prefix  = var.name
    enabled = true
  }
  subnets         = var.private_subnet_ids
  security_groups = [var.alb_security_group_id]
  tags            = var.tags
}

# web has no health route; / redirects to sign-in when signed out (setup-aws.md §8).
resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = var.web_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  # The default 300 s drain held every rollout for five minutes. 60 s lets a
  # chat turn in progress finish; a new task is in service after two checks.
  deregistration_delay = 60
  health_check {
    path              = "/"
    matcher           = "200-399"
    interval          = 10
    healthy_threshold = 2
  }
  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  # Internal ALB: no listener faces the internet. Anything without CloudFront's
  # secret header is refused as a second layer.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "random_password" "origin_header" {
  length  = 40
  special = false
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_header.result]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_ecs_service" "web" {
  name                              = "${var.name}-web"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.this["web"].arn
  desired_count                     = var.web_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 120

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.web_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = var.web_port
  }

  # Server: api reaches it as http://web:<port>.
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
    service {
      port_name      = "http"
      discovery_name = "web"
      client_alias {
        port     = var.web_port
        dns_name = "web"
      }
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront, terraform_data.migrate]
  tags       = var.tags
}

resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this["api"].arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.api_security_group_id]
  }

  # Client only.
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [terraform_data.migrate]
  tags       = var.tags
}

# Migrations run before web and api roll: whenever the migrate task definition
# changes (a new image, mostly), its task runs to completion here and the apply
# stops if it fails, so the services never start against an unmigrated schema.
# Runs the AWS CLI on the machine applying, with its credentials.
resource "terraform_data" "migrate" {
  count            = var.run_migrations ? 1 : 0
  triggers_replace = aws_ecs_task_definition.this["migrate"].arn

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    environment = {
      REGION   = var.region
      CLUSTER  = aws_ecs_cluster.this.name
      TASK_DEF = aws_ecs_task_definition.this["migrate"].arn
      SUBNETS  = join(",", var.private_subnet_ids)
      SG       = var.api_security_group_id
      LOGS     = aws_cloudwatch_log_group.this.name
    }
    command = <<-EOT
      set -euo pipefail
      task=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$TASK_DEF" --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG]}" \
        --query 'tasks[0].taskArn' --output text)
      echo "migrate: $task"
      aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$task"
      code=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$task" \
        --query 'tasks[0].containers[0].exitCode' --output text)
      [ "$code" = 0 ] || { echo "migrate exited $code: see log group $LOGS, stream prefix migrate" >&2; exit 1; }
      echo "migrate: done"
    EOT
  }
}

resource "aws_cloudfront_vpc_origin" "this" {
  vpc_origin_endpoint_config {
    name                   = var.name
    arn                    = aws_lb.this.arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"
    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
  tags = var.tags
}

# Better Auth rate-limits sign-in per client address. Behind CloudFront and the
# ALB, X-Forwarded-For carries several addresses and none is trusted, so every
# caller would share one bucket. This writes the viewer address to the header
# web is told to trust (TRUSTED_CLIENT_IP_HEADER), replacing any value the
# viewer sent. The ALB forwards only requests that came through CloudFront.
locals {
  client_ip_header = "x-wayfinder-client-ip"
}

resource "aws_cloudfront_function" "client_ip" {
  name    = "${var.name}-client-ip"
  runtime = "cloudfront-js-2.0"
  comment = "Sets ${local.client_ip_header} to the viewer address"
  publish = true
  code    = <<-JS
    function handler(event) {
      event.request.headers["${local.client_ip_header}"] = { value: event.viewer.ip };
      return event.request;
    }
  JS
}

resource "aws_cloudfront_distribution" "this" {
  enabled    = true
  comment    = var.name
  web_acl_id = var.web_acl_arn

  origin {
    origin_id   = "alb"
    domain_name = aws_lb.this.dns_name
    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.this.id
      # The most CloudFront allows without a quota increase. Above the SSE
      # keepalive, so a quiet stream stays open.
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_header.result
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.client_ip.arn
    }
  }

  logging_config {
    bucket = var.cloudfront_log_bucket_domain_name
    prefix = var.name
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  tags = var.tags
}
