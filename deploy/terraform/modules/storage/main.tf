# Uploaded documents, templates and generated output. Private, encrypted,
# versioned so an overwrite or delete can be undone, and TLS only.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-documents-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_logging" "this" {
  bucket        = aws_s3_bucket.this.id
  target_bucket = var.access_log_bucket
  target_prefix = "${aws_s3_bucket.this.id}/"
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = var.noncurrent_version_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# jsonencode so the offline tests can read the policies.
locals {
  bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  # What wayfinder's storage adapter needs (docs/guides/setup-aws.md §4), on
  # this bucket only. The bucket is made here, so no s3:CreateBucket.
  access_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Bucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.this.arn]
      },
      {
        Sid      = "Objects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.this.arn}/*"]
      },
    ]
  })
}

resource "aws_s3_bucket_policy" "this" {
  bucket     = aws_s3_bucket.this.id
  policy     = local.bucket_policy
  depends_on = [aws_s3_bucket_public_access_block.this]
}
