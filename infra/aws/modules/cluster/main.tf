resource "aws_ecs_cluster" "this" {
  name = var.project_name
}

resource "aws_service_discovery_http_namespace" "this" {
  name        = var.project_name
  description = "Service Connect namespace shared by all stamped environments"
}

# Images are shared across environments; each stamp pins a tag.
resource "aws_ecr_repository" "web" {
  name = "${var.project_name}-web"
}

resource "aws_ecr_repository" "semchunk" {
  name = "${var.project_name}-semchunk"
}

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "Public entry point shared by all environments"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP (redirects to HTTPS)"
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
    description = "to environment web tasks"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-alb" }
}

resource "aws_lb" "this" {
  name               = var.project_name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

# Environments attach host-header rules; anything that matches no environment
# is a 404, never an accidental default backend (ADR-034 Decision 3).
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "No such environment."
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
