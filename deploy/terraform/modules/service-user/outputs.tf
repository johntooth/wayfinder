output "user_name" { value = aws_iam_user.this.name }
output "secret_arn" { value = aws_secretsmanager_secret.this.arn }

# What the offline tests look at. Not for use by other modules.
output "settings" {
  value = { policy = jsondecode(aws_iam_user_policy.this.policy) }
}
