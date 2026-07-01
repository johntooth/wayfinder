resource "aws_s3_bucket" "documents" {
  bucket_prefix = "${var.project_name}-documents-"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The app's storage adapter authenticates with static MinIO-style credentials
# (MINIO_ACCESS_KEY/MINIO_SECRET_KEY), so it gets a dedicated IAM user scoped
# to this bucket rather than the task role. The key pair lands in Secrets
# Manager and is injected into the task; it never appears in tfvars.
resource "aws_iam_user" "storage" {
  name = "${var.project_name}-document-storage"
}

resource "aws_iam_user_policy" "storage" {
  name = "${var.project_name}-documents-bucket"
  user = aws_iam_user.storage.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.documents.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.documents.arn}/*"
      },
    ]
  })
}

resource "aws_iam_access_key" "storage" {
  user = aws_iam_user.storage.name
}

resource "aws_secretsmanager_secret" "access_key_id" {
  name_prefix = "${var.project_name}/storage-access-key-id-"
}

resource "aws_secretsmanager_secret_version" "access_key_id" {
  secret_id     = aws_secretsmanager_secret.access_key_id.id
  secret_string = aws_iam_access_key.storage.id
}

resource "aws_secretsmanager_secret" "secret_access_key" {
  name_prefix = "${var.project_name}/storage-secret-access-key-"
}

resource "aws_secretsmanager_secret_version" "secret_access_key" {
  secret_id     = aws_secretsmanager_secret.secret_access_key.id
  secret_string = aws_iam_access_key.storage.secret
}
