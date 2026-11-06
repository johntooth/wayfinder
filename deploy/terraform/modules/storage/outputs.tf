output "bucket" { value = aws_s3_bucket.this.id }
output "access_policy" { value = local.access_policy }

# What the offline tests look at. Not for use by other modules.
output "settings" {
  value = {
    public_access_block = aws_s3_bucket_public_access_block.this
    policy              = jsondecode(aws_s3_bucket_policy.this.policy)
    access_log_bucket   = aws_s3_bucket_logging.this.target_bucket
    bucket_arn          = aws_s3_bucket.this.arn
  }
}
