#!/usr/bin/env bash
# Creates an access key for one of the stack's service users and writes it to
# that user's secret, so the key never passes through Terraform state.
#
#   scripts/set-access-key.sh storage|bedrock
#
# Run from deploy/terraform after `terraform apply`, with AWS_PROFILE set. The
# key goes from one AWS call to the next through a pipe: it is never printed,
# written to disk, or put in a command-line argument (where `ps` would show it).
# A user that already has a key is refused; delete the old key first to rotate.
set -euo pipefail

which_user="${1:-}"
if [[ "$which_user" != "storage" && "$which_user" != "bedrock" ]]; then
  echo "usage: $0 storage|bedrock" >&2
  exit 2
fi

user_name="$(terraform output -json access_keys | jq -r --arg k "$which_user" '.[$k].user')"
secret_arn="$(terraform output -json access_keys | jq -r --arg k "$which_user" '.[$k].secret')"

existing="$(aws iam list-access-keys --user-name "$user_name" --query 'length(AccessKeyMetadata)' --output text)"
if [[ "$existing" != "0" ]]; then
  echo "$user_name already has $existing access key(s); delete them first to rotate." >&2
  exit 1
fi

aws iam create-access-key --user-name "$user_name" --output json \
  | jq '{access_key_id: .AccessKey.AccessKeyId, secret_access_key: .AccessKey.SecretAccessKey}' \
  | aws secretsmanager put-secret-value --secret-id "$secret_arn" --secret-string file:///dev/stdin \
      --query VersionId --output text >/dev/null

echo "Access key for $user_name written to its secret."
