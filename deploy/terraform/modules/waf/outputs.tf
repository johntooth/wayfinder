output "arn" { value = aws_wafv2_web_acl.this.arn }

# What the offline tests look at. Not for use by other modules.
output "settings" {
  value = {
    rules            = { for r in aws_wafv2_web_acl.this.rule : r.name => r }
    sign_up_prefixes = local.sign_up_prefixes
  }
}
