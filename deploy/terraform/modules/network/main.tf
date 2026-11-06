# wayfinder's own VPC across two zones: public subnets for the NAT, private
# subnets for everything else, the internal ALB included. One NAT keeps cost
# down; it carries Bedrock, the MCP gateway and any other outbound calls.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs                 = slice(data.aws_availability_zones.available.names, 0, 2)
  interface_endpoints = toset(["secretsmanager", "logs", "ecr.api", "ecr.dkr"])
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = var.tags
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, count.index)
  availability_zone = local.azs[count.index]
  tags              = merge(var.tags, { Name = "${var.name}-public-${count.index}" })
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, count.index + 10)
  availability_zone = local.azs[count.index]
  tags              = merge(var.tags, { Name = "${var.name}-private-${count.index}" })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = var.tags
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = var.tags
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = var.tags
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }
  tags = var.tags
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Security groups. Rules are separate resources so the groups can refer to each other.

resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  vpc_id      = aws_vpc.this.id
  description = "Internal ALB: reached by the CloudFront VPC origin only (rule in the root module)"
  tags        = var.tags
  lifecycle { create_before_destroy = true }
}

# The ALB is internal and CloudFront reaches it through a VPC origin. The one
# ingress rule (CloudFront's service-managed group) is in the root module,
# because that group only exists once the VPC origin does.

resource "aws_vpc_security_group_egress_rule" "alb_to_web" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = var.web_port
  to_port                      = var.web_port
}

resource "aws_security_group" "web" {
  name_prefix = "${var.name}-web-"
  vpc_id      = aws_vpc.this.id
  description = "wayfinder web tasks"
  tags        = var.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.web_port
  to_port                      = var.web_port
}

# api's scheduler heartbeat POSTs web's internal tick endpoint over Service Connect.
resource "aws_vpc_security_group_ingress_rule" "web_from_api" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = var.web_port
  to_port                      = var.web_port
}

resource "aws_vpc_security_group_egress_rule" "web_all" {
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# api takes no inbound traffic at all.
resource "aws_security_group" "api" {
  name_prefix = "${var.name}-api-"
  vpc_id      = aws_vpc.this.id
  description = "wayfinder api tasks and the migrate task: no ingress"
  tags        = var.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "database" {
  name_prefix = "${var.name}-database-"
  vpc_id      = aws_vpc.this.id
  description = "PostgreSQL: wayfinder web, api and migrate only"
  tags        = var.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  for_each                     = { web = aws_security_group.web.id, api = aws_security_group.api.id }
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

# VPC endpoints, so image pulls, secrets and logs stay off the NAT. S3 is a
# gateway endpoint, so document storage does too.

resource "aws_security_group" "endpoints" {
  name_prefix = "${var.name}-endpoints-"
  vpc_id      = aws_vpc.this.id
  description = "Interface endpoints: HTTPS from inside the VPC"
  tags        = var.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "endpoints" {
  security_group_id = aws_security_group.endpoints.id
  cidr_ipv4         = var.cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = local.interface_endpoints
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  tags                = var.tags
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = var.tags
}
