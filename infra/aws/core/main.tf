# Applied once per AWS account/region: everything environments share.
# Stamping an environment is `../scripts/new-environment.sh <name>` (ADR-034);
# `../scripts/bootstrap.sh` drives the whole first-time setup (ADR-035).
locals {
  create_certificate = var.certificate_arn == ""
  certificate_arn    = local.create_certificate ? aws_acm_certificate_validation.wildcard[0].certificate_arn : var.certificate_arn
}

# Either bring a certificate or a hosted zone to issue one from (ADR-035
# Decision 2). Guarded here because variable validations cannot span inputs
# on the supported terraform range.
resource "terraform_data" "certificate_input_guard" {
  lifecycle {
    precondition {
      condition     = var.certificate_arn != "" || var.route53_zone_id != ""
      error_message = "Set certificate_arn (bring your own wildcard cert) or route53_zone_id (core issues *.<base_domain> via DNS validation) — see ADR-035."
    }
  }
}

module "network" {
  source = "../modules/network"

  project_name = var.project_name
  vpc_cidr     = var.vpc_cidr
}

module "database_server" {
  source = "../modules/database-server"

  project_name        = var.project_name
  vpc_id              = module.network.vpc_id
  private_subnet_ids  = module.network.private_subnet_ids
  instance_class      = var.db_instance_class
  allocated_storage   = var.db_allocated_storage
  skip_final_snapshot = var.db_skip_final_snapshot
}

module "cluster" {
  source = "../modules/cluster"

  project_name      = var.project_name
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  certificate_arn   = local.certificate_arn
}

# ── Wildcard certificate (only when no ARN is supplied) ──────────────────────

resource "aws_acm_certificate" "wildcard" {
  count = local.create_certificate ? 1 : 0

  domain_name               = "*.${var.base_domain}"
  subject_alternative_names = [var.base_domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = local.create_certificate ? {
    for option in aws_acm_certificate.wildcard[0].domain_validation_options :
    option.domain_name => option
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "wildcard" {
  count = local.create_certificate ? 1 : 0

  certificate_arn         = aws_acm_certificate.wildcard[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

# ── SSM bastion (ADR-035 Decision 3) ─────────────────────────────────────────
# No key pair, no inbound ports — reachable only through SSM. Exists so
# environment stamping (the postgresql provider) works from any laptop via
# scripts/db-tunnel.sh. Disable with enable_bastion = false.

data "aws_ssm_parameter" "bastion_ami" {
  count = var.enable_bastion ? 1 : 0

  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_security_group" "bastion" {
  count = var.enable_bastion ? 1 : 0

  name        = "${var.project_name}-bastion"
  description = "SSM bastion — egress only"
  vpc_id      = module.network.vpc_id

  egress {
    description = "SSM endpoints (via NAT) and RDS"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-bastion" }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_bastion" {
  count = var.enable_bastion ? 1 : 0

  security_group_id            = module.database_server.security_group_id
  referenced_security_group_id = aws_security_group.bastion[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "environment stamping via the SSM tunnel"
}

data "aws_iam_policy_document" "bastion_assume" {
  count = var.enable_bastion ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bastion" {
  count = var.enable_bastion ? 1 : 0

  name               = "${var.project_name}-bastion"
  assume_role_policy = data.aws_iam_policy_document.bastion_assume[0].json
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  count = var.enable_bastion ? 1 : 0

  role       = aws_iam_role.bastion[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  count = var.enable_bastion ? 1 : 0

  name = "${var.project_name}-bastion"
  role = aws_iam_role.bastion[0].name
}

resource "aws_instance" "bastion" {
  count = var.enable_bastion ? 1 : 0

  ami                    = data.aws_ssm_parameter.bastion_ami[0].value
  instance_type          = "t4g.nano"
  subnet_id              = module.network.private_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.bastion[0].id]
  iam_instance_profile   = aws_iam_instance_profile.bastion[0].name

  metadata_options {
    http_tokens = "required"
  }

  tags = { Name = "${var.project_name}-bastion" }
}
