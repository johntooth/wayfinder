# Access-log buckets for the ALB, the CloudFront distribution and the documents
# bucket. Encrypted,
# closed to the public, and expired after var.retention_days.
#
# Two buckets because the two services deliver differently: ALB logs need a
# bucket policy for the regional ELB account and no ACLs; CloudFront's standard
# logging still writes with ACLs, so its bucket keeps them enabled.

data "aws_elb_service_account" "this" {}

data "aws_caller_identity" "current" {}

locals {
  buckets = {
    alb        = { suffix = "alb-logs", ownership = "BucketOwnerEnforced" }
    cloudfront = { suffix = "cloudfront-logs", ownership = "BucketOwnerPreferred" }
    s3         = { suffix = "s3-access-logs", ownership = "BucketOwnerEnforced" }
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = "${var.name}-${each.value.suffix}-${data.aws_caller_identity.current.account_id}"
  tags     = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule { object_ownership = local.buckets[each.key].ownership }
  depends_on = [aws_s3_bucket_public_access_block.this]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    # ELB log delivery supports SSE-S3 only.
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = var.retention_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# jsonencode so the offline tests can read the policies. Both buckets refuse
# plain HTTP; log delivery uses TLS, so the deny does not block it.
locals {
  bucket_policies = {
    for k, b in aws_s3_bucket.this : k => jsonencode({
      Version = "2012-10-17"
      Statement = concat(
        [{
          Sid       = "DenyInsecureTransport"
          Effect    = "Deny"
          Principal = "*"
          Action    = "s3:*"
          Resource  = [b.arn, "${b.arn}/*"]
          Condition = { Bool = { "aws:SecureTransport" = "false" } }
        }],
        # ap-southeast-2 predates August 2022, so ALB logs are delivered by the
        # regional ELB account rather than the log-delivery service principal.
        k == "alb" ? [{
          Sid       = "ElbLogDelivery"
          Effect    = "Allow"
          Principal = { AWS = data.aws_elb_service_account.this.arn }
          Action    = "s3:PutObject"
          Resource  = "${b.arn}/*"
        }] : [],
        # S3 server access logs for the documents bucket, from this account only.
        k == "s3" ? [{
          Sid       = "S3ServerAccessLogs"
          Effect    = "Allow"
          Principal = { Service = "logging.s3.amazonaws.com" }
          Action    = "s3:PutObject"
          Resource  = "${b.arn}/*"
          Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
        }] : [],
      )
    })
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each   = aws_s3_bucket.this
  bucket     = each.value.id
  policy     = local.bucket_policies[each.key]
  depends_on = [aws_s3_bucket_public_access_block.this]
}
