# Per-environment semantic-chunking sidecar (ADR-030). Reachable only from the
# owning environment's web service — never from the load balancer or other
# environments.
resource "aws_security_group" "semchunk" {
  name        = var.service_name
  description = "Semantic chunking sidecar (${var.service_name})"
  vpc_id      = var.vpc_id

  egress {
    description = "image pull + AWS APIs via NAT"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = var.service_name }
}

resource "aws_vpc_security_group_ingress_rule" "from_web" {
  security_group_id            = aws_security_group.semchunk.id
  referenced_security_group_id = var.client_security_group_id
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
}

resource "aws_cloudwatch_log_group" "semchunk" {
  name              = "/ecs/${var.service_name}"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "semchunk" {
  family                   = var.service_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "semchunk"
      image     = var.image
      essential = true

      portMappings = [
        { name = "http", containerPort = 8000, protocol = "tcp" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.semchunk.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "semchunk"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "semchunk" {
  name            = var.service_name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.semchunk.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.semchunk.id]
  }

  # The alias is environment-scoped (semchunk-<env>) because the Service
  # Connect namespace is shared by every stamped environment (ADR-034).
  service_connect_configuration {
    enabled   = true
    namespace = var.namespace_arn

    service {
      port_name = "http"

      client_alias {
        port     = 8000
        dns_name = var.dns_alias
      }
    }
  }
}
