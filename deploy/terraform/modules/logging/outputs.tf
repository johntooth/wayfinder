output "alb_bucket" { value = aws_s3_bucket.this["alb"].id }
output "s3_bucket" { value = aws_s3_bucket.this["s3"].id }
output "cloudfront_bucket_domain_name" { value = aws_s3_bucket.this["cloudfront"].bucket_domain_name }

# What the offline tests look at. Not for use by other modules.
output "settings" {
  value = {
    policies  = { for k, p in aws_s3_bucket_policy.this : k => jsondecode(p.policy) }
    ownership = { for k, o in aws_s3_bucket_ownership_controls.this : k => one(o.rule).object_ownership }
  }
}
