resource "aws_ecr_repository" "semchunk" {
  name = "${var.project_name}-semchunk"
}

# Reachable only from the web service's security group — the sidecar is an
# internal dependency and must never sit behind the public load balancer.
resource "aws_security_group" "semchunk" {
  name        = "${var.project_name}-semchunk"
  description = "Semantic chunking sidecar"
  vpc_id      = var.vpc_id

  egress {
    description = "image pull + AWS APIs via NAT"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-semchunk" }
}

resource "aws_vpc_security_group_ingress_rule" "from_web" {
  security_group_id            = aws_security_group.semchunk.id
  referenced_security_group_id = var.client_security_group_id
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
}

resource "aws_cloudwatch_log_group" "semchunk" {
  name              = "/ecs/${var.project_name}-semchunk"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "semchunk" {
  family                   = "${var.project_name}-semchunk"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "semchunk"
      image     = "${aws_ecr_repository.semchunk.repository_url}:${var.image_tag}"
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
  name            = "semchunk"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.semchunk.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.semchunk.id]
  }

  # Publishes the sidecar as http://semchunk:8000 inside the namespace — the
  # exact SEMCHUNK_URL the web task is given (ADR-033 Decision 3).
  service_connect_configuration {
    enabled   = true
    namespace = var.namespace_arn

    service {
      port_name = "http"

      client_alias {
        port     = 8000
        dns_name = "semchunk"
      }
    }
  }
}
