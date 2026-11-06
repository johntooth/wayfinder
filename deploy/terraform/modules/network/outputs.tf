output "vpc_id" { value = aws_vpc.this.id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "web_security_group_id" { value = aws_security_group.web.id }
output "api_security_group_id" { value = aws_security_group.api.id }
output "database_security_group_id" { value = aws_security_group.database.id }

# What the offline tests look at. Not for use by other modules.
output "rules" {
  value = {
    database_sources = { for k, r in aws_vpc_security_group_ingress_rule.database : k => r.referenced_security_group_id }
    web_sources      = [aws_vpc_security_group_ingress_rule.web_from_alb.referenced_security_group_id, aws_vpc_security_group_ingress_rule.web_from_api.referenced_security_group_id]
    alb_sg           = aws_security_group.alb.id
    api_sg           = aws_security_group.api.id
    web_sg           = aws_security_group.web.id
  }
}
