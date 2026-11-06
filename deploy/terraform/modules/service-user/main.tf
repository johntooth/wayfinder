# An IAM user for a wayfinder adapter that signs with a static key pair rather
# than the task role: the storage adapter and the Bedrock provider both do.
#
# Terraform makes the user and an empty secret. The key is created and written
# to the secret by deploy/terraform/scripts/set-access-key.sh, so it never
# passes through Terraform state. The secret holds JSON with access_key_id and
# secret_access_key; ECS picks each field out by its JSON key.

resource "aws_iam_user" "this" {
  name = var.name
  path = "/service/"
  tags = var.tags
}

resource "aws_iam_user_policy" "this" {
  name   = "access"
  user   = aws_iam_user.this.name
  policy = var.policy
}

resource "aws_secretsmanager_secret" "this" {
  name_prefix = "${var.name}/access-key-"
  description = "Access key for IAM user ${var.name}, set by scripts/set-access-key.sh"
  tags        = var.tags
}
