output "bucket_name" {
  value = aws_s3_bucket.documents.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.documents.arn
}

output "access_key_id_secret_arn" {
  value = aws_secretsmanager_secret.access_key_id.arn
}

output "secret_access_key_secret_arn" {
  value = aws_secretsmanager_secret.secret_access_key.arn
}
